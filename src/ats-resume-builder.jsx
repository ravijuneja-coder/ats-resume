import { useState, useEffect, useRef, useMemo } from "react";
import mammoth from "mammoth";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { motion, useReducedMotion, useScroll, useSpring, useTransform, useMotionValue, AnimatePresence } from "framer-motion";
import { auth, db } from "./firebase";
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  getAdditionalUserInfo,
} from "firebase/auth";
import { doc, getDoc, setDoc, collection, getDocs, query, orderBy } from "firebase/firestore";

// ─── PDF EXPORT (client-side render, no browser print dialog) ────────────────
// Renders `el` to canvas and slices it into A4 pages, so the exported PDF has
// no browser-injected header/footer (URL, title, page numbers, date).
//
// A naive fixed-height slice can cut straight through a section (e.g. the
// Skills tag row), leaving half on one page and half on the next with a hard
// seam at the cut. To avoid that, we collect the top/bottom of every
// section-level block inside `el` and, whenever a page boundary would fall
// inside one of them, pull the boundary back to just before that block.
//
// Leaf nodes (a single bullet line) are always protected. But a leaf-only
// pass still lets a break land between a job entry's header (role/company)
// and its bullet list, or land right after the header — orphaning the
// header alone. Every template renders one job/education/project entry as
// its own small wrapper div (header + bullets), so we also protect any
// container whose height is a modest fraction of a page: small enough to be
// "one entry", too small to be a whole section. `pageContentHpx` (one page's
// worth of content height, same unit as the returned spans) sets that cutoff.
function collectBreakSafeBoundaries(el, canvasScale, pageContentHpx) {
  const rootTop = el.getBoundingClientRect().top;
  const blocks = el.querySelectorAll("*");
  const spans = [];
  const entryCutoffPx = pageContentHpx * 0.4;
  blocks.forEach(node => {
    const isLeaf = node.children.length === 0;
    const r = node.getBoundingClientRect();
    if (r.height <= 0) return;
    const heightPx = r.height * canvasScale;
    // Protect leaves outright, and also protect small containers (single
    // entries like one job's header+bullets) without protecting whole
    // sections, which would pull page breaks back too far.
    if (!isLeaf && !(pageContentHpx && heightPx <= entryCutoffPx)) return;
    spans.push({
      top: (r.top - rootTop) * canvasScale,
      bottom: (r.bottom - rootTop) * canvasScale,
    });
  });
  return spans;
}

// Walks up from `el` to find the first ancestor with a non-transparent
// background-color, so the exported PDF page can be filled edge-to-edge with
// it instead of leaving white margins around a colored template. Returns an
// [r, g, b] triplet since that's what jsPDF's setFillColor needs.
// `boundToSelf` stops the walk at `el` itself instead of climbing into real
// ancestors — needed when `el` is a template root rendered inline in the live
// app (not an isolated export copy), since its actual parent chain is app
// chrome (e.g. the page's own surface color), not more of the document.
// Templates with a genuinely transparent root (e.g. a colored accent strip
// next to a plain white content pane, with no background on the shared
// parent) should fall back to white, not inherit whatever UI happens to be
// behind them on screen.
function findEffectiveBackgroundColor(el, boundToSelf = false) {
  let node = el;
  while (node && node instanceof Element) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg && bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (m && (m[4] === undefined || parseFloat(m[4]) > 0)) {
      return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    }
    if (boundToSelf) break;
    node = node.parentElement;
  }
  return [255, 255, 255];
}

// Computes where page breaks fall inside `el` at 1:1 CSS-pixel scale (i.e.
// against `el.getBoundingClientRect()`, not a rasterized canvas), given the
// on-screen height of one A4 page's worth of content (`pageContentHpx`).
// Shared by the PDF export (which scales the result up to canvas pixels) and
// the live in-app preview overlay, so the on-screen page-break markers always
// match where the PDF will actually split.
function computePageBreaksPx(el, pageContentHpx) {
  const totalHpx = el.getBoundingClientRect().height;
  const blockSpans = collectBreakSafeBoundaries(el, 1, pageContentHpx);

  const findSafeBoundary = (y, sliceStartPx) => {
    const minY = sliceStartPx + pageContentHpx * 0.5;
    let safeY = y;
    for (const span of blockSpans) {
      if (span.top < y && span.bottom > y && span.top >= minY) {
        safeY = Math.min(safeY, span.top);
      }
    }
    return safeY;
  };

  const breaks = [];
  let renderedPx = 0;
  while (renderedPx < totalHpx) {
    const naiveEnd = Math.min(renderedPx + pageContentHpx, totalHpx);
    const sliceEnd = naiveEnd >= totalHpx ? naiveEnd : findSafeBoundary(naiveEnd, renderedPx);
    const sliceHpx = Math.max(1, sliceEnd - renderedPx);
    renderedPx += sliceHpx;
    if (renderedPx < totalHpx) breaks.push(renderedPx);
  }
  return breaks;
}

// Overlays dashed "Page N / Page N+1" break lines on top of `targetSelector`'s
// element at the exact spots where exportElementToPDF would split the PDF,
// so the live preview shows the same pagination the download will produce.
// Recomputes on resize and whenever `deps` changes (resume content, margins,
// template, etc. — anything that can shift the layout).
function PageBreakOverlay({ targetSelector, margins, deps, onPageCountChange, pageOverrides, highlightPage = -1 }) {
  const [breaks, setBreaks] = useState([]);
  const [elHeight, setElHeight] = useState(0);

  const rafRef = useRef(null);

  useEffect(() => {
    const recompute = () => {
      const el = document.querySelector(targetSelector);
      if (!el || el.getBoundingClientRect().width === 0) { setBreaks([]); onPageCountChange?.(1); return; }
      // Must match exportElementToPDF's math exactly (fixed 96 DPI, independent
      // of the element's on-screen width) or the preview's page height and the
      // PDF's page height diverge, and the two disagree on where breaks fall.
      const PAGE_W_MM = 210, PAGE_H_MM = 297, PX_PER_MM = 96 / 25.4;
      const { top = 40, bottom = 40, left = 48, right = 48 } = margins || {};
      const contentWmm = PAGE_W_MM - (left + right) / PX_PER_MM;
      const contentHmm = PAGE_H_MM - (top + bottom) / PX_PER_MM;
      const widthPx = el.getBoundingClientRect().width;
      const pxPerMm = widthPx / contentWmm;
      const pageContentHpx = contentHmm * pxPerMm;
      const newBreaks = computePageBreaksPx(el, pageContentHpx);
      setBreaks(newBreaks);
      setElHeight(el.getBoundingClientRect().height);
      onPageCountChange?.(newBreaks.length + 1);
    };

    rafRef.current = requestAnimationFrame(recompute);
    const el = document.querySelector(targetSelector);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    });
    if (el) ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSelector, margins?.top, margins?.bottom, margins?.left, margins?.right, deps]);

  // Slice boundaries for every page: [{ top, bottom }, ...] in the same
  // coordinate space as `breaks` (CSS px from the top of the target element).
  const pageSlices = [0, ...breaks, elHeight].slice(0, -1).map((top, i) => ({
    top, bottom: [...breaks, elHeight][i],
  }));

  const highlighted = highlightPage >= 0 ? pageSlices[highlightPage] : null;
  const highlightMargins = highlightPage >= 0 ? (pageOverrides?.[highlightPage] || margins) : null;

  if (breaks.length === 0 && !highlighted) return null;

  return (
    <>
      {breaks.map((y, i) => (
        <div key={i} style={{ position: "absolute", left: 0, right: 0, top: y, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ borderTop: "2px dashed #EF4444", position: "relative" }}>
            <span style={{
              position: "absolute", right: 8, top: -10,
              background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 700,
              padding: "1px 7px", borderRadius: 4, letterSpacing: "0.02em",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
            }}>
              Page {i + 1} ↓ Page {i + 2}
            </span>
          </div>
        </div>
      ))}
      {/* Highlighted page band + its own margin guide lines, so picking a
          page in the toolbar's page selector shows exactly where that
          page's (possibly overridden) margins fall within its slice. */}
      {highlighted && (
        <div style={{
          position: "absolute", left: 0, right: 0, top: highlighted.top, height: highlighted.bottom - highlighted.top,
          pointerEvents: "none", zIndex: 4, background: "rgba(59, 130, 246, 0.06)",
          border: "2px solid #3B82F6", boxSizing: "border-box",
        }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: highlightMargins.top, borderTop: "1.5px dashed #3B82F6" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: highlightMargins.bottom, borderBottom: "1.5px dashed #3B82F6" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: highlightMargins.left, borderLeft: "1.5px dashed #3B82F6" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, right: highlightMargins.right, borderRight: "1.5px dashed #3B82F6" }} />
          <span style={{
            position: "absolute", left: 8, top: 8,
            background: "#3B82F6", color: "#fff", fontSize: 10, fontWeight: 700,
            padding: "1px 7px", borderRadius: 4, letterSpacing: "0.02em",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          }}>
            Page {highlightPage + 1} margins
          </span>
        </div>
      )}
    </>
  );
}

// Renders `children` (a resume) as real, separately-padded page boxes
// stacked with a gap, so per-page margin overrides are actually visible on
// screen — not just an overlay drawn on top of unchanged content. Mirrors
// exportElementToPDF's canvas-slicing: break positions come from the same
// computePageBreaksPx logic (driven by the global default margins, same as
// the PDF — per-page overrides only resize that page's own padding/window,
// they don't reflow where breaks fall, matching the export's behavior).
// Works by rendering one full-height hidden copy to measure/find breaks,
// then one clipped `overflow: hidden` box per page, each showing a
// vertically-shifted view of a second full copy so the right slice of
// content appears in each box, padded with that page's own margins.
function PaginatedResumePreview({ margins, pageOverrides, onPageCountChange, highlightPage = -1, children }) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [breaks, setBreaks] = useState([]);
  const [totalHpx, setTotalHpx] = useState(0);
  const [pageWidthPx, setPageWidthPx] = useState(0);
  // The page box's own background, matched to the content's effective
  // background (same helper the PDF export uses) so a short colored-template
  // page doesn't expose a hardcoded white/grey box beneath its content —
  // e.g. a template with minHeight:700 that renders shorter than a full A4
  // page's worth of pixels at the current margins.
  const [pageBg, setPageBg] = useState("#fff");
  const rafRef = useRef(null);

  const { top: mTop = 40, bottom: mBottom = 40, left: mLeft = 48, right: mRight = 48 } = margins || {};

  useEffect(() => {
    const recompute = () => {
      // The hidden measurer's width must match what the visible page box
      // will actually render at (container width, capped at the 850px page
      // max) — .resume-preview is width:100% and has nothing else to
      // resolve its own width against.
      const containerWidthPx = Math.min(containerRef.current?.getBoundingClientRect().width || 0, 850);
      // Resume previews carry a .resume-preview class; cover letter preview
      // templates don't share a common class, so fall back to the measurer's
      // first rendered element (each template's own single root div).
      const el = measureRef.current?.querySelector(".resume-preview") || measureRef.current?.firstElementChild;
      if (!el || containerWidthPx === 0) { setBreaks([]); setTotalHpx(0); onPageCountChange?.(1); return; }
      setPageWidthPx(containerWidthPx);
      const [bgR, bgG, bgB] = findEffectiveBackgroundColor(el, true);
      setPageBg(`rgb(${bgR}, ${bgG}, ${bgB})`);
      const PAGE_W_MM = 210, PAGE_H_MM = 297, PX_PER_MM = 96 / 25.4;
      const contentWmm = PAGE_W_MM - (mLeft + mRight) / PX_PER_MM;
      const contentHmm = PAGE_H_MM - (mTop + mBottom) / PX_PER_MM;
      const pxPerMm = containerWidthPx / contentWmm;
      const pageContentHpx = contentHmm * pxPerMm;
      const newBreaks = computePageBreaksPx(el, pageContentHpx);
      setBreaks(newBreaks);
      setTotalHpx(el.getBoundingClientRect().height);
      onPageCountChange?.(newBreaks.length + 1);
    };
    rafRef.current = requestAnimationFrame(recompute);
    // Web fonts (Poppins) load async; if they swap in after this first
    // measurement, glyph metrics change and previously-computed break
    // points no longer match the text that actually renders — recompute
    // once fonts have settled so live preview and the export capture
    // (which also waits on document.fonts.ready) agree on the same layout.
    if (document.fonts && document.fonts.status !== "loaded") {
      document.fonts.ready.then(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(recompute);
      });
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recompute);
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mTop, mBottom, mLeft, mRight, children]);

  const slices = [0, ...breaks, totalHpx].slice(0, -1).map((top, i) => ({
    top, bottom: [...breaks, totalHpx][i],
  }));

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Off-screen full-height copy: the source of truth for break
          measurement AND the only element PDF export can render (html2canvas
          can't reliably rasterize a visibility:hidden node, so this must
          stay genuinely visible — just parked off-screen via fixed
          positioning so it never affects page layout or scroll). Marked
          data-export-source so exportElementToPDF can find it unambiguously
          instead of picking whichever .resume-preview happens to be first
          in the DOM (the visible per-page boxes below are clipped copies,
          not the full document, and are the wrong export source). */}
      <div style={{ position: "fixed", top: 0, left: -99999, pointerEvents: "none" }} aria-hidden="true" data-export-source="true">
        <div ref={measureRef} style={{ width: pageWidthPx || undefined }}>
          {children}
        </div>
      </div>
      {slices.length === 0 ? (
        <div style={{ padding: `${mTop}px ${mRight}px ${mBottom}px ${mLeft}px`, background: pageBg, boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 20px rgba(0,0,0,0.06)", maxWidth: 850, margin: "0 auto" }}>
          {children}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          {slices.map((slice, i) => {
            const o = pageOverrides?.[i];
            const pT = o?.top ?? mTop, pB = o?.bottom ?? mBottom, pL = o?.left ?? mLeft, pR = o?.right ?? mRight;
            const sliceH = slice.bottom - slice.top;
            const isHighlighted = highlightPage === i;
            return (
              <div key={i} style={{
                position: "relative", maxWidth: 850, width: "100%", margin: "0 auto",
                boxShadow: isHighlighted ? "0 0 0 3px #3B82F6, 0 1px 20px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.12), 0 1px 20px rgba(0,0,0,0.06)",
                borderRadius: isHighlighted ? 4 : 0,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px 4px" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isHighlighted ? "#3B82F6" : "var(--c-text3)" }}>Page {i + 1}</span>
                  {o && <span style={{ fontSize: 10, color: "var(--c-primary)", fontWeight: 600 }}>Custom margins</span>}
                </div>
                <div style={{
                  overflow: "hidden", background: pageBg,
                  height: sliceH + pT + pB,
                  padding: `${pT}px ${pR}px ${pB}px ${pL}px`,
                  boxSizing: "border-box",
                }}>
                  <div style={{ position: "relative", height: sliceH, overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: -slice.top, left: 0, right: 0 }}>
                      {children}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// `margins` is the default applied to every page. `pageOverrides` is an
// optional { [pageIndex]: { top, bottom, left, right } } map (0-based) for
// pages that should use different margins than the default — the override
// only changes that page's whitespace/inset, not where content breaks, since
// re-flowing slice boundaries off a per-page value would be circular (the
// page a given override applies to depends on where breaks fall, which would
// then depend on the override).
async function exportElementToPDF(el, filename, margins = {}, pageOverrides = {}) {
  const { top = 40, bottom = 40, left = 48, right = 48 } = margins;
  const PAGE_W_MM = 210, PAGE_H_MM = 297, PX_PER_MM = 96 / 25.4;
  const marginTmm = top / PX_PER_MM;
  const marginBmm = bottom / PX_PER_MM;
  const marginLmm = left / PX_PER_MM;
  const marginRmm = right / PX_PER_MM;
  const contentWmm = PAGE_W_MM - marginLmm - marginRmm;
  const contentHmm = PAGE_H_MM - marginTmm - marginBmm;

  // Wait for web fonts (Poppins) to finish loading before measuring
  // boundaries or rasterizing. If a font swaps in mid-capture, glyph
  // metrics shift after the safe-boundary spans were measured, so the
  // slice cut and the actually-rendered text disagree — producing
  // shifted/doubled-looking text near whichever page seam falls where
  // the reflow happened.
  if (document.fonts && document.fonts.status !== "loaded") {
    await document.fonts.ready;
  }

  const [bgR, bgG, bgB] = findEffectiveBackgroundColor(el);
  const scale = 2;
  const canvas = await html2canvas(el, { scale, useCORS: true, backgroundColor: `rgb(${bgR}, ${bgG}, ${bgB})` });
  const pxPerMm = canvas.width / contentWmm;
  const maxSliceHpx = Math.floor(contentHmm * pxPerMm);
  const blockSpans = collectBreakSafeBoundaries(el, scale, maxSliceHpx);

  // If a boundary at `y` would land inside some block, move it up to that
  // block's top. Only pull back within the same page's worth of content, so
  // one huge block can't collapse the slice to near-zero height.
  const findSafeBoundary = (y, sliceStartPx) => {
    const minY = sliceStartPx + maxSliceHpx * 0.5;
    let safeY = y;
    for (const span of blockSpans) {
      if (span.top < y && span.bottom > y && span.top >= minY) {
        safeY = Math.min(safeY, span.top);
      }
    }
    return safeY;
  };

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  let renderedPx = 0;
  let pageIndex = 0;
  while (renderedPx < canvas.height) {
    const naiveEnd = Math.min(renderedPx + maxSliceHpx, canvas.height);
    const sliceEnd = naiveEnd >= canvas.height ? naiveEnd : findSafeBoundary(naiveEnd, renderedPx);
    const sliceHpx = Math.max(1, Math.round(sliceEnd - renderedPx));
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHpx;
    const ctx = sliceCanvas.getContext("2d");
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);
    const imgData = sliceCanvas.toDataURL("image/png");
    if (pageIndex > 0) pdf.addPage();

    const o = pageOverrides[pageIndex] || {};
    const pT = (o.top ?? top) / PX_PER_MM;
    const pL = (o.left ?? left) / PX_PER_MM;
    const pR = (o.right ?? right) / PX_PER_MM;
    const defaultImgHmm = sliceHpx / pxPerMm;
    const imgWmm = PAGE_W_MM - pL - pR;
    const imgHmm = defaultImgHmm * (imgWmm / contentWmm); // scale height to match width so aspect ratio is preserved

    pdf.setFillColor(bgR, bgG, bgB);
    pdf.rect(0, 0, PAGE_W_MM, PAGE_H_MM, "F");
    pdf.addImage(imgData, "PNG", pL, pT, imgWmm, imgHmm);
    renderedPx += sliceHpx;
    pageIndex += 1;
  }
  pdf.save(filename);
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TEMPLATES = [
  { id: "apex",     name: "Apex",     tag: "Most Popular", accent: "#0EA5E9", bg: "#0F172A", photo: false },
  { id: "clarity",  name: "Clarity",  tag: "ATS #1",       accent: "#10B981", bg: "#F8FAFC", photo: false },
  { id: "axiom",    name: "Axiom",    tag: "Corporate",    accent: "#8B5CF6", bg: "#FAFAF9", photo: false },
  { id: "nova",     name: "Nova",     tag: "Creative",     accent: "#F59E0B", bg: "#0F0F0F", photo: false },
  { id: "echo",     name: "Echo",     tag: "Tech",         accent: "#06B6D4", bg: "#F0F9FF", photo: false },
  { id: "form",     name: "Form",     tag: "Executive",    accent: "#1E293B", bg: "#FFFFFF", photo: false },
  // ── Extended templates ──
  { id: "slate",    name: "Slate",    tag: "Minimal",      accent: "#64748B", bg: "#F8FAFC", photo: false },
  { id: "pure",     name: "Pure",     tag: "Minimal",      accent: "#0F172A", bg: "#FFFFFF", photo: false },
  { id: "edge",     name: "Edge",     tag: "Modern",       accent: "#6366F1", bg: "#0F0F23", photo: false },
  { id: "flow",     name: "Flow",     tag: "Modern",       accent: "#0891B2", bg: "#FFFFFF", photo: false },
  { id: "summit",   name: "Summit",   tag: "Corporate",    accent: "#1D4ED8", bg: "#EFF6FF", photo: false },
  { id: "prestige", name: "Prestige", tag: "Corporate",    accent: "#7C2D12", bg: "#FFFBF5", photo: false },
  { id: "spark",    name: "Spark",    tag: "Creative",     accent: "#EF4444", bg: "#0C0C0C", photo: false },
  { id: "bloom",    name: "Bloom",    tag: "Creative",     accent: "#D946EF", bg: "#FDF4FF", photo: false },
  // ── Photo templates ──
  { id: "portrait", name: "Portrait", tag: "With Photo",   accent: "#6366F1", bg: "#1E1B4B", photo: true },
  { id: "vista",    name: "Vista",    tag: "With Photo",   accent: "#EC4899", bg: "#FFF1F2", photo: true },
  { id: "pulse",    name: "Pulse",    tag: "With Photo",   accent: "#F97316", bg: "#0C0A09", photo: true },
  { id: "prism",    name: "Prism",    tag: "With Photo",   accent: "#8B5CF6", bg: "#F5F3FF", photo: true },
  { id: "lens",     name: "Lens",     tag: "With Photo",   accent: "#0EA5E9", bg: "#F0F9FF", photo: true },
  // ── Additional templates ──
  { id: "zen",      name: "Zen",      tag: "Minimal",      accent: "#374151", bg: "#FAFAFA",  photo: false },
  { id: "mono",     name: "Mono",     tag: "Minimal",      accent: "#3B82F6", bg: "#F9FAFB",  photo: false },
  { id: "nexus",    name: "Nexus",    tag: "Modern",       accent: "#10B981", bg: "#031D2E",  photo: false },
  { id: "vector",   name: "Vector",   tag: "Modern",       accent: "#6366F1", bg: "#0D1117",  photo: false },
  { id: "atlas",    name: "Atlas",    tag: "Corporate",    accent: "#C9A84C", bg: "#0F1B30",  photo: false },
  { id: "charter",  name: "Charter",  tag: "Corporate",    accent: "#2563EB", bg: "#F8FAFC",  photo: false },
  { id: "crimson",  name: "Crimson",  tag: "Creative",     accent: "#E11D48", bg: "#0D0407",  photo: false },
  { id: "halo",     name: "Halo",     tag: "Creative",     accent: "#A855F7", bg: "#FAF5FF",  photo: false },
  { id: "aura",     name: "Aura",     tag: "With Photo",   accent: "#8B5CF6", bg: "#F5F3FF",  photo: true },
  { id: "frame",    name: "Frame",    tag: "With Photo",   accent: "#F59E0B", bg: "#111827",  photo: true },
];

const SAMPLE_RESUME = {
  personal: {
    name: "Alex Morgan",
    title: "Senior Software Engineer",
    email: "alex.morgan@email.com",
    phone: "+1 (555) 234-5678",
    location: "San Francisco, CA",
    linkedin: "linkedin.com/in/alexmorgan",
    github: "github.com/alexmorgan",
    website: "alexmorgan.dev",
    photo: null,
  },
  summary: "Results-driven Software Engineer with 6+ years of experience building scalable distributed systems and leading cross-functional engineering teams. Proven track record of reducing system latency by 40% and shipping features that serve 10M+ users. Passionate about clean architecture, developer experience, and mentoring.",
  experience: [
    {
      id: 1, company: "Stripe", role: "Senior Software Engineer",
      start: "Jan 2021", end: "Present", location: "San Francisco, CA",
      bullets: [
        "Architected and led migration of legacy monolith to microservices, reducing p99 latency by 42% and improving deploy frequency 5×",
        "Built real-time fraud detection pipeline processing 2M+ events/day using Kafka and ML inference, preventing $8M in annual fraud",
        "Mentored 4 junior engineers, drove bi-weekly tech talks, and authored 12 internal RFCs adopted company-wide",
      ]
    },
    {
      id: 2, company: "Airbnb", role: "Software Engineer II",
      start: "Jun 2018", end: "Dec 2020", location: "San Francisco, CA",
      bullets: [
        "Delivered end-to-end redesign of search ranking system, increasing booking conversion by 18% ($240M ARR impact)",
        "Owned infrastructure for A/B testing platform serving 50M monthly users with <10ms p95 response time",
      ]
    },
  ],
  education: [
    { id: 1, school: "UC Berkeley", degree: "B.S. Computer Science", year: "2018", gpa: "3.9" }
  ],
  skills: ["TypeScript", "Go", "Python", "React", "Node.js", "PostgreSQL", "Redis", "Kafka", "Kubernetes", "AWS", "System Design", "CI/CD"],
  certifications: [{ id: 1, name: "AWS Solutions Architect", issuer: "Amazon", year: "2022" }],
  projects: [{ id: 1, name: "OpenTelemetry Contrib", url: "github.com/open-telemetry/opentelemetry-go", desc: "Contributor to CNCF project with 3k+ GitHub stars, added Go SDK instrumentation" }],
};

const RAVI_RESUME = {
  personal: {
    name: "Jordan Lee",
    title: "Senior Product Designer | UX/UI | Design Systems | Enterprise & SaaS",
    email: "jordan.lee@email.com",
    phone: "+1-555-0100",
    location: "San Francisco, CA",
    linkedin: "linkedin.com/in/jordan-lee",
    github: "",
    website: "portfolio.jordanlee.com",
    photo: null,
  },
  summary: "Senior Product Designer with 10+ years of experience in SaaS and enterprise products, focused on high-quality UI, scalable design systems, and AI-driven design solutions.",
  experience: [
    {
      id: 1, company: "Freelance / Self-Employed", role: "UX/UI & Product Design",
      start: "2025", end: "Present", location: "Remote",
      bullets: [
        "Designing end-to-end product experiences including user flows, wireframes, and high-fidelity UI for web and mobile applications",
        "Upskilling in AI-assisted UX workflows and modern design tooling",
        "Building scalable design systems and developing portfolio-ready case studies",
      ],
    },
    {
      id: 2, company: "TechCorp Inc.", role: "Senior UI/UX/Product Designer",
      start: "2019", end: "2025", location: "San Francisco, CA",
      bullets: [
        "Built WCAG-compliant design system powering 700+ screens, reducing UI support tickets by 67%",
        "Designed SaaS email marketing platform UX, boosting user engagement by 35%",
        "Streamlined UX flows reducing support workload by 60%",
      ],
    },
    {
      id: 3, company: "DesignStudio LLC", role: "Senior UI/Product Designer",
      start: "2018", end: "2019", location: "New York, NY",
      bullets: [
        "Designed high-fidelity UI for fintech product covering payments, validation, and transaction dashboards",
      ],
    },
  ],
  education: [
    { id: 1, school: "Human Factors International", degree: "Certified Usability Analyst (CUA)", year: "2020", gpa: "" },
  ],
  skills: [
    "User Interface Design (UI)", "Design Systems", "High-Fidelity UI Design", "Responsive Web & Mobile Design",
    "Accessibility (WCAG 2.1/2.2)", "UX Research", "User Flows & Journey Mapping", "Wireframing & Prototyping",
    "Figma", "Adobe XD", "Zeplin", "Axure", "Sketch",
    "AI-Assisted Design Workflows", "Agile/Scrum", "Stakeholder Management", "Team Leadership",
  ],
  certifications: [{ id: 1, name: "Certified Usability Analyst (CUA)", issuer: "HFI", year: "2020" }],
  projects: [
    { id: 1, name: "Healthcare Design System", url: "portfolio.jordanlee.com", desc: "700+ screens, WCAG-compliant, 67% reduction in UI support tickets via reusable components and token-driven design", start: "2021", end: "2024" },
    { id: 2, name: "SaaS Email Marketing Platform", url: "portfolio.jordanlee.com", desc: "Simplified automation workflows and boosted user engagement by 35% through intuitive UX flows", start: "2022", end: "2023" },
  ],
};

const PAGES = { HOME: "home", LOGIN: "login", REGISTER: "register", DASHBOARD: "dashboard", BUILDER: "builder", TEMPLATES: "templates", PRICING: "pricing", SUBSCRIPTION: "subscription", COVER_LETTER: "coverletter", PRIVACY: "privacy", TERMS: "terms", CONTACT: "contact", ABOUT: "about", ADMIN: "admin" };

const ADMIN_EMAILS = ["ravijuneja1986@gmail.com"];

// ─── SKILL SUGGESTIONS DB ────────────────────────────────────────────────────

const SKILL_DB = {
  design:     { kw: /\b(ui|ux|product designer|visual designer|figma|design system|hci|interaction design|graphic)\b/, skills: ["Figma","Adobe XD","Sketch","Illustrator","Photoshop","Framer","Zeplin","InVision","Design Systems","Component Libraries","High-Fidelity UI","Wireframing","Prototyping","Accessibility (WCAG)","Design Tokens","Miro","Principle","Framer Motion"] },
  ux:         { kw: /\b(ux|user experience|user research|usability|ux designer|product design)\b/, skills: ["User Research","Usability Testing","Journey Mapping","User Personas","Card Sorting","Heuristic Evaluation","A/B Testing","Information Architecture","Contextual Inquiry","UX Writing","Maze","Hotjar","UserTesting"] },
  frontend:   { kw: /\b(frontend|front.end|react|vue|angular|javascript|typescript|web developer|ui developer)\b/, skills: ["React","TypeScript","JavaScript","Vue.js","Angular","Next.js","HTML5","CSS3","Tailwind CSS","SASS/SCSS","Webpack","Vite","Storybook","Redux","GraphQL"] },
  backend:    { kw: /\b(backend|back.end|server|api|node|python|java|golang|ruby|php|django|spring|microservice)\b/, skills: ["Node.js","Python","Java","Go","Express.js","FastAPI","Django","REST APIs","gRPC","PostgreSQL","MongoDB","Redis","Docker","Kubernetes","AWS"] },
  fullstack:  { kw: /\b(full.stack|full stack|software engineer|software developer|swe)\b/, skills: ["React","Node.js","TypeScript","PostgreSQL","Docker","REST APIs","Git","CI/CD","AWS","System Design","Microservices"] },
  data:       { kw: /\b(data scientist|data analyst|machine learning|ml|ai|deep learning|nlp|analytics|data engineer)\b/, skills: ["Python","TensorFlow","PyTorch","Pandas","NumPy","Scikit-learn","SQL","Tableau","Power BI","Apache Spark","Machine Learning","Deep Learning","NLP","Jupyter","Hugging Face"] },
  devops:     { kw: /\b(devops|cloud|aws|gcp|azure|kubernetes|docker|infrastructure|sre|platform engineer|devsecops)\b/, skills: ["Docker","Kubernetes","Terraform","AWS","GCP","Azure","CI/CD","Jenkins","GitHub Actions","Ansible","Linux","Bash","Monitoring","Prometheus","Grafana"] },
  product:    { kw: /\b(product manager|pm |product management|program manager|product owner)\b/, skills: ["Product Strategy","Roadmapping","Agile","Scrum","JIRA","OKRs","User Stories","Stakeholder Management","A/B Testing","Data Analysis","SQL","Figma","Confluence","Go-to-Market","Prioritization"] },
  management: { kw: /\b(manager|director|lead|head of|vp |vice president|cto|cpo|engineering manager|team lead)\b/, skills: ["Team Leadership","Strategic Planning","Mentoring","Cross-functional Collaboration","Performance Management","Change Management","Budget Management","Hiring","Agile","OKRs","Stakeholder Management"] },
  marketing:  { kw: /\b(marketing|seo|content|growth|brand|digital marketing|copywriter|social media)\b/, skills: ["SEO","Google Analytics","Content Strategy","Social Media Marketing","Email Marketing","HubSpot","Copywriting","A/B Testing","PPC","Conversion Optimization","Canva","Mailchimp"] },
  sales:      { kw: /\b(sales|business development|account manager|crm|revenue|customer success)\b/, skills: ["Salesforce","CRM","Negotiation","Pipeline Management","HubSpot","Cold Outreach","Account Management","B2B Sales","Customer Success","Revenue Growth","Forecasting"] },
  finance:    { kw: /\b(finance|financial analyst|accountant|cfa|fintech|investment|banking|risk)\b/, skills: ["Financial Modeling","Excel","SQL","Python","Bloomberg","Tableau","Risk Management","Valuation","DCF Analysis","Regulatory Compliance","SAP","QuickBooks"] },
};

function getRecommendedSkills(title = "", summary = "", existing = []) {
  const text = (title + " " + summary).toLowerCase();
  const seen = new Set(existing.map(s => s.toLowerCase()));
  const suggestions = [];
  Object.values(SKILL_DB).forEach(({ kw, skills }) => {
    if (kw.test(text)) {
      skills.forEach(s => { if (!seen.has(s.toLowerCase()) && !suggestions.includes(s)) suggestions.push(s); });
    }
  });
  // Fallback: generic professional skills if nothing matched
  if (suggestions.length === 0) {
    ["Microsoft Office","Google Workspace","Project Management","Communication","Problem Solving","Team Collaboration","Time Management","Agile","Data Analysis","Presentation Skills"]
      .forEach(s => { if (!seen.has(s.toLowerCase())) suggestions.push(s); });
  }
  return suggestions.slice(0, 18);
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

const cn = (...classes) => classes.filter(Boolean).join(" ");

function useLocalStorage(key, initial) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, setVal];
}

// ─── ANALYTICS ──────────────────────────────────────────────────────────────

// Fires a GA4 custom event via the gtag.js loader in index.html. No-ops
// safely if gtag hasn't loaded (blocked by an ad-blocker, offline, etc.) so
// analytics can never break the feature it's attached to.
function trackEvent(name, params = {}) {
  try {
    window.gtag?.("event", name, params);
  } catch {}
}

// ─── API HELPER ───────────────────────────────────────────────────────────────

async function callClaude(prompt, systemPrompt = "") {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_tokens: 1000,
      system: systemPrompt || "You are an expert resume writer and career coach specializing in ATS optimization. Be concise, professional, and impactful. Return plain text only, no markdown formatting unless explicitly asked.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "AI features are temporarily unavailable. Please try again later.");
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ─── CV IMPORT ────────────────────────────────────────────────────────────────

const JSON_STRUCTURE = `{"personal":{"name":"","title":"","email":"","phone":"","location":"","linkedin":"","github":"","website":""},"summary":"","experience":[{"id":1,"company":"","role":"","start":"","end":"","location":"","bullets":[""]}],"education":[{"id":1,"school":"","degree":"","year":"","gpa":""}],"skills":[""],"certifications":[{"id":1,"name":"","issuer":"","year":""}],"projects":[{"id":1,"name":"","desc":"","start":"","end":"","url":""}]}`;

const PARSE_SYSTEM = "You are a resume parser. Output only raw valid JSON — no markdown, no code fences, no explanation. All string values on one line. No trailing commas.";

function repairAndParse(raw) {
  const match = raw.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return valid JSON. Please try again.");
  const fixed = match[0]
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\n\r\t]/g, " ");
  return JSON.parse(fixed);
}

async function parseResumeWithClaude(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  let messages;

  if (ext === "pdf") {
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result.split(",")[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    messages = [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: `Extract all resume data and return ONLY this JSON structure filled in:\n${JSON_STRUCTURE}` },
      ],
    }];
  } else {
    let text = "";
    if (ext === "txt") {
      text = await file.text();
    } else if (ext === "docx") {
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      text = result.value;
    } else {
      throw new Error(`Unsupported file type .${ext}. Use PDF, DOCX, or TXT.`);
    }
    const safeText = text.slice(0, 6000).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").replace(/\\/g, "").replace(/"/g, "'");
    messages = [{
      role: "user",
      content: `Parse this resume and return ONLY this JSON structure filled in:\n${JSON_STRUCTURE}\n\nResume:\n${safeText}`,
    }];
  }

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens: 2000, system: PARSE_SYSTEM, messages, betaHeader: "pdfs-2024-09-25" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "AI features are temporarily unavailable. Please try again later.");
  }
  const data = await res.json();
  const raw = data.content?.[0]?.text || "";

  let parsed;
  try {
    parsed = repairAndParse(raw);
  } catch (e) {
    console.error("JSON parse failed:", e.message, "\nRaw:\n", raw);
    throw new Error("Could not parse CV. Please try a .txt version of your resume.");
  }

  const stamp = (arr) => (arr || []).map((item, i) => ({ ...item, id: Date.now() + i }));
  return {
    personal: { photo: null, website: "", linkedin: "", github: "", ...parsed.personal },
    summary: parsed.summary || "",
    experience: stamp(parsed.experience),
    education: stamp(parsed.education),
    skills: parsed.skills || [],
    certifications: stamp(parsed.certifications),
    projects: stamp(parsed.projects),
  };
}

// Turns "Jan 2022" / "2022" / "Present" / "" into a comparable number (higher = more recent).
function dateSortValue(v) {
  if (!v) return -1;
  if (v === "Present") return Infinity;
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const parts = v.trim().split(" ");
  if (parts.length === 2 && MONTHS.includes(parts[0])) {
    return Number(parts[1]) * 12 + MONTHS.indexOf(parts[0]);
  }
  const year = Number(parts[parts.length - 1]);
  return Number.isFinite(year) ? year * 12 : -1;
}

function sortExperienceByDate(experience) {
  return [...experience].sort((a, b) => {
    const endDiff = dateSortValue(b.end) - dateSortValue(a.end);
    if (endDiff !== 0) return endDiff;
    return dateSortValue(b.start) - dateSortValue(a.start);
  });
}

// ─── RESUME STATS ─────────────────────────────────────────────────────────────

function computeWordCount(resume) {
  const texts = [
    resume.summary,
    ...resume.experience.flatMap(e => [...(e.bullets || []), e.role, e.company]),
    ...resume.education.map(e => e.degree + " " + e.school),
    ...resume.skills,
    ...(resume.certifications || []).map(c => c.name),
    ...(resume.projects || []).map(p => p.name + " " + p.desc),
  ].filter(Boolean);
  return texts.join(" ").split(/\s+/).filter(w => w.length > 0).length;
}

function computeSectionCount(resume) {
  return [
    resume.personal.name,
    resume.summary?.length > 0,
    resume.experience?.length > 0,
    resume.education?.length > 0,
    resume.skills?.length > 0,
    (resume.certifications?.length > 0),
    (resume.projects?.length > 0),
    resume.personal.linkedin || resume.personal.github,
  ].filter(Boolean).length;
}

function computeCompleteness(resume) {
  const checks = [
    !!resume.personal.name,
    !!resume.personal.email,
    !!resume.personal.phone,
    !!resume.personal.location,
    !!resume.personal.linkedin,
    (resume.summary?.length || 0) > 50,
    (resume.experience?.length || 0) > 0,
    (resume.education?.length || 0) > 0,
    (resume.skills?.length || 0) >= 5,
    (resume.certifications?.length || 0) > 0,
    (resume.projects?.length || 0) > 0,
    !!resume.personal.photo,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

// ─── ATS SCORER ──────────────────────────────────────────────────────────────

function computeATSScore(resume) {
  let score = 0;
  const checks = [];
  if (resume.personal.name) { score += 10; checks.push({ ok: true, label: "Full name present" }); }
  else checks.push({ ok: false, label: "Full name missing" });
  if (resume.personal.email) { score += 10; checks.push({ ok: true, label: "Email address" }); }
  else checks.push({ ok: false, label: "Email missing" });
  if (resume.personal.phone) { score += 5; checks.push({ ok: true, label: "Phone number" }); }
  else checks.push({ ok: false, label: "Phone missing" });
  if (resume.summary?.length > 80) { score += 15; checks.push({ ok: true, label: "Professional summary" }); }
  else checks.push({ ok: false, label: "Summary too short or missing" });
  if (resume.experience?.length > 0) { score += 20; checks.push({ ok: true, label: "Work experience section" }); }
  else checks.push({ ok: false, label: "No work experience" });
  if (resume.skills?.length >= 6) { score += 15; checks.push({ ok: true, label: `${resume.skills.length} skills listed` }); }
  else checks.push({ ok: false, label: "Add more skills (6+ recommended)" });
  if (resume.education?.length > 0) { score += 10; checks.push({ ok: true, label: "Education section" }); }
  else checks.push({ ok: false, label: "Education missing" });
  const allBullets = resume.experience?.flatMap(e => e.bullets) || [];
  const hasMetrics = allBullets.some(b => /\d+/.test(b));
  if (hasMetrics) { score += 10; checks.push({ ok: true, label: "Quantified achievements" }); }
  else checks.push({ ok: false, label: "Add numbers/metrics to bullets" });
  if (resume.personal.linkedin) { score += 5; checks.push({ ok: true, label: "LinkedIn URL" }); }
  else checks.push({ ok: false, label: "LinkedIn profile missing" });
  return { score: Math.min(score, 100), checks };
}

// ─── ICONS ────────────────────────────────────────────────────────────────────

const Icon = {
  Sparkles: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
      <path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z"/>
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
    </svg>
  ),
  Eye: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  User: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Briefcase: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>
    </svg>
  ),
  GraduationCap: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
    </svg>
  ),
  Zap: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Check: ({ size = "4" } = {}) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: size * 4, height: size * 4, flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/>
    </svg>
  ),
  GripVertical: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
      <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
    </svg>
  ),
  Moon: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  ),
  Sun: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  ArrowRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  Menu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20, flexShrink: 0 }}>
      <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  Award: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
    </svg>
  ),
  Star: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  LayoutTemplate: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
  ),
  FileText: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
  Link: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, flexShrink: 0 }}>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  Target: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  TrendingUp: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  LogOut: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Upload: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
};

// ─── MOTION PRIMITIVES ──────────────────────────────────────────────────────
// Shared, reusable animation building blocks so every section uses the same
// timing/easing instead of one-off values. All translate/opacity based (GPU
// friendly) and every entrance trigger is `viewport={{ once: true }}` so
// nothing re-animates on scroll-back. Framer Motion's own `useReducedMotion`
// already collapses these to instant/no-op under prefers-reduced-motion, and
// the CSS-driven ambient effects (blobs, floating hero) are separately gated
// by the `@media (prefers-reduced-motion: reduce)` rule in `styles`.

const EASE_OUT = [0.16, 1, 0.3, 1];

const fadeUpVariants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
};

const staggerContainerVariants = (stagger = 0.08, delayChildren = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

// Scroll-triggered fade+slide-up wrapper. Wrap a section (or a grid of
// cards) in this; pass `stagger` to also stagger direct motion children.
function Reveal({ children, as: Tag = motion.div, className, style, stagger, delay = 0, once = true, amount = 0.2, ...rest }) {
  const variants = stagger
    ? { hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }
    : { hidden: { opacity: 0, y: 40 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT, delay } } };
  return (
    <Tag
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      variants={variants}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Individual staggered child — use inside a <Reveal stagger> container.
function RevealItem({ children, className, style, as: Tag = motion.div, ...rest }) {
  return (
    <Tag className={className} style={style} variants={fadeUpVariants} {...rest}>
      {children}
    </Tag>
  );
}

// Counts a number up from 0 once it scrolls into view. `decimals` controls
// rounding (e.g. 1 for "4.9"). Returns a formatted string via `format`.
function useCountUp(target, { duration = 1200, decimals = 0, trigger = true } = {}) {
  const [value, setValue] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!trigger) return;
    if (reduceMotion) { setValue(target); return; }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, target, duration, reduceMotion]);
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value);
}

// Small glassy floating badge for the hero mockup. Enters with a fade+scale
// (staggered via `delay`), then drifts on its own gentle float loop (offset
// via `floatDelay`/`floatDuration` so multiple badges never move in sync),
// with a fixed slight rotation for a hand-placed, non-mechanical feel.
function HeroFloatBadge({ children, className, style, reduceMotion, delay = 0, floatDelay = 0, floatDuration = 6, rotate = 0 }) {
  return (
    <motion.div
      className={className}
      style={{
        position: "absolute", zIndex: 10,
        display: "inline-flex", alignItems: "center", gap: 7,
        background: "var(--c-glass)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        border: "1px solid var(--c-glass-border)",
        borderRadius: 999, padding: "8px 14px",
        boxShadow: "0 8px 24px var(--c-shadow), 0 0 0 1px rgba(0,0,0,0.02)",
        whiteSpace: "nowrap",
        ...style,
      }}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.8, rotate: 0 }}
      animate={reduceMotion
        ? { opacity: 1, rotate }
        : { opacity: 1, scale: 1, rotate, y: [0, -8, 0] }
      }
      transition={reduceMotion
        ? { duration: 0.4, delay }
        : {
            opacity: { duration: 0.5, delay, ease: EASE_OUT },
            scale: { duration: 0.5, delay, ease: EASE_OUT },
            rotate: { duration: 0.5, delay, ease: EASE_OUT },
            y: { duration: floatDuration, delay: delay + floatDelay, repeat: Infinity, ease: "easeInOut" },
          }
      }
    >
      {children}
    </motion.div>
  );
}

// The hero's "browser window" mockup — the resume + AI-assistant preview
// shown under the ATS Passed banner. Wired up with three "alive" touches so
// the product reads as active rather than a static screenshot:
//  - a gentle 3D tilt that tracks the mouse (desktop only, disabled for
//    reduced motion / touch since there's no persistent pointer)
//  - the AI suggestion cards revealing one-by-one instead of all at once
//  - the mini ATS-score ring/number counting up to 94 instead of starting there
// Runs once on mount (not on a loop) so it reads as "the AI just finished
// analyzing this resume" rather than a distracting repeating gimmick.
function HeroBrowserWindow({ reduceMotion }) {
  const wrapRef = useRef(null);
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRotateX = useSpring(rotateX, { stiffness: 150, damping: 20 });
  const springRotateY = useSpring(rotateY, { stiffness: 150, damping: 20 });

  const handleMouseMove = (e) => {
    if (reduceMotion || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(px * 6);
    rotateX.set(py * -6);
  };
  const handleMouseLeave = () => { rotateX.set(0); rotateY.set(0); };

  const suggestions = [
    { text: "Add metrics to bullet #3", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
    { text: "Include 'TypeScript' in skills", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
    { text: "Summary could be stronger", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
    { text: "Consider adding a project section", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
  ];
  const scoreValue = useCountUp(94, { duration: 1600, trigger: true });
  const scoreFrac = scoreValue / 100;

  return (
    <motion.div
      ref={wrapRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "relative", zIndex: 1,
        borderRadius: 16, overflow: "hidden",
        border: "1px solid var(--c-border)",
        boxShadow: "0 2px 0 rgba(255,255,255,0.8) inset, 0 32px 80px rgba(15,14,12,0.14), 0 8px 24px rgba(26,86,219,0.08)",
        background: "var(--c-surface)",
        rotateX: reduceMotion ? 0 : springRotateX,
        rotateY: reduceMotion ? 0 : springRotateY,
        transformPerspective: 1200,
        willChange: "transform",
      }}
    >
      {/* Browser chrome */}
      <div style={{
        background: "var(--c-surface2)",
        borderBottom: "1px solid var(--c-border)",
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["#FF5F57","#FEBC2E","#28C840"].map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />
          ))}
        </div>
        {/* URL bar */}
        <div style={{
          flex: 1, maxWidth: 340, margin: "0 auto",
          background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 7, padding: "4px 12px",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          <span style={{ fontSize: 12, color: "var(--c-text2)", fontWeight: 500 }}>atsresumepilot.com/dashboard</span>
        </div>
        {/* Right status pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "#ECFDF5", border: "1px solid #A7F3D0",
          borderRadius: 99, padding: "4px 12px",
          fontSize: 12, fontWeight: 700, color: "#059669",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669", display: "inline-block", animation: "ats-ring 1.6s ease-out infinite" }} />
          ATS Score: 94
        </div>
      </div>

      {/* Main content grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", maxHeight: 420, overflow: "hidden" }}>

        {/* Resume preview pane */}
        <div style={{ borderRight: "1px solid var(--c-border)", overflow: "hidden", position: "relative", background: "#F9FAFB" }}>
          {/* ATS badge overlay on resume */}
          <div style={{
            position: "absolute", top: 14, right: 14, zIndex: 10,
            background: "linear-gradient(135deg,#059669,#047857)",
            color: "#fff", fontSize: 10, fontWeight: 700,
            padding: "5px 11px", borderRadius: 99,
            display: "flex", alignItems: "center", gap: 5,
            boxShadow: "0 4px 12px rgba(5,150,105,0.35)",
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
            ATS Optimized
          </div>
          <div style={{ transform: "scale(0.57)", transformOrigin: "top left", width: "175%", pointerEvents: "none" }}>
            <ResumePreview resume={SAMPLE_RESUME} />
          </div>
          {/* Blinking text cursor at the end of the summary line — suggests the
              resume is being actively written/edited, not a frozen screenshot. */}
          <motion.span
            aria-hidden="true"
            animate={reduceMotion ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
            transition={reduceMotion ? undefined : { duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
            style={{
              position: "absolute", top: 108, left: 168, width: 1.5, height: 12,
              background: "var(--c-accent)", pointerEvents: "none",
            }}
          />
          {/* Bottom gradient fade */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(transparent, #F9FAFB)", pointerEvents: "none" }} />
        </div>

        {/* AI Panel */}
        <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", background: "var(--c-surface)" }}>

          {/* AI Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 9,
              background: "linear-gradient(135deg, #1A56DB, #7C3AED)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <Icon.Sparkles />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)" }}>AI Assistant</div>
              <div style={{ fontSize: 11, color: "var(--c-accent2)", fontWeight: 500 }}>● Active</div>
            </div>
          </div>

          {/* Score ring row — ring fill + number count up together on mount */}
          <div style={{
            background: "linear-gradient(135deg,#ECFDF5,#D1FAE5)",
            border: "1px solid #A7F3D0",
            borderRadius: 12, padding: "12px 14px",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ position: "relative", width: 46, height: 46, flexShrink: 0 }}>
              <svg width="46" height="46" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="23" cy="23" r="18" fill="none" stroke="#A7F3D0" strokeWidth="4"/>
                <circle cx="23" cy="23" r="18" fill="none" stroke="#059669" strokeWidth="4"
                  strokeDasharray={`${2*Math.PI*18}`}
                  strokeDashoffset={`${2*Math.PI*18*(1-scoreFrac)}`}
                  strokeLinecap="round"/>
              </svg>
              <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center", fontWeight:800,fontSize:11,color:"#059669" }}>{scoreValue}</div>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#065F46" }}>ATS Passed ✓</div>
              <div style={{ fontSize: 11, color: "#059669" }}>Top 5% of resumes</div>
            </div>
          </div>

          {/* Suggestions label */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Suggestions
          </div>

          {/* Suggestion cards — reveal one by one instead of all appearing at once */}
          <motion.div
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
            initial="hidden"
            animate="show"
            variants={staggerContainerVariants(reduceMotion ? 0 : 0.35, 0.5)}
          >
            {suggestions.map((s, i) => (
              <motion.div key={i}
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } } }}
                style={{
                  padding: "9px 11px", borderRadius: 10, fontSize: 12, fontWeight: 500,
                  display: "flex", gap: 9, alignItems: "center",
                  background: s.bg, border: `1px solid ${s.border}`,
                }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚡</span>
                <span style={{ color: "#78350F", lineHeight: 1.4 }}>{s.text}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

// Thin animated bar pinned to the top of the viewport, filling with scroll
// progress. Purely transform-based (scaleX) so it stays off the main thread
// cost of layout properties.
function ScrollProgressBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden="true"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 1000,
        background: "linear-gradient(90deg, var(--c-accent), var(--c-accent2))",
        transformOrigin: "0% 50%", scaleX,
      }}
    />
  );
}

// Floating circular "back to top" button, shown after 500px of scroll.
function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="back-to-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          whileHover={{ scale: 1.08, y: -2 }}
          whileTap={{ scale: 0.94 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 900,
            width: 44, height: 44, borderRadius: "50%", border: "1px solid var(--c-border)",
            background: "var(--c-surface)", color: "var(--c-text)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 8px 24px var(--c-shadow)",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: 18, height: 18 }}>
            <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

// Fixed, low-opacity floating gradient blobs for ambient depth. Pure CSS
// animation (not Framer Motion) since it's purely decorative and always
// running — keeping it off React's render loop. Respects reduced-motion via
// the `.bg-blob` rule in `styles`.
function AmbientBackground() {
  return (
    <div className="bg-blobs" aria-hidden="true">
      <div className="bg-blob" style={{ width: 420, height: 420, top: "-8%", left: "-6%", background: "var(--c-accent)" }} />
      <div className="bg-blob" style={{ width: 380, height: 380, top: "35%", right: "-8%", background: "var(--c-accent2)", animationDelay: "-7s" }} />
      <div className="bg-blob" style={{ width: 300, height: 300, bottom: "-6%", left: "30%", background: "var(--c-amber)", animationDelay: "-14s" }} />
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&display=swap');

  *, *::before, *::after { box-sizing: border-box; }

  :root {
    --font-display: 'Poppins', sans-serif;
    --font-body: 'Poppins', sans-serif;
    --c-bg: #F8F7F4;
    --c-surface: #FFFFFF;
    --c-surface2: #F1F0ED;
    --c-border: #E5E4E0;
    --c-text: #0F0E0C;
    --c-text2: #5C5A55;
    --c-text3: #9C9A94;
    --c-accent: #1A56DB;
    --c-accent-light: #EEF2FF;
    --c-accent2: #059669;
    --c-accent2-light: #ECFDF5;
    --c-amber: #D97706;
    --c-amber-light: #FFFBEB;
    --c-danger: #DC2626;
    --c-shadow: rgba(15,14,12,0.06);
    --c-glow: rgba(26,86,219,0.12);
    --c-glass: rgba(255,255,255,0.72);
    --c-glass-border: rgba(255,255,255,0.6);
  }

  .dark {
    --c-bg: #0C0C0A;
    --c-surface: #161614;
    --c-surface2: #1F1F1C;
    --c-border: #2A2A27;
    --c-glass: rgba(22,22,20,0.72);
    --c-glass-border: rgba(255,255,255,0.1);
    --c-text: #F5F4F1;
    --c-text2: #9C9A94;
    --c-text3: #5C5A55;
    --c-accent: #4F8EF7;
    --c-accent-light: #1A1F30;
    --c-accent2: #10B981;
    --c-accent2-light: #0D1F1A;
    --c-amber: #F59E0B;
    --c-amber-light: #1F1A0D;
    --c-shadow: rgba(0,0,0,0.3);
    --c-glow: rgba(79,142,247,0.15);
  }

  body { margin: 0; font-family: var(--font-body); background: var(--c-bg); color: var(--c-text); }

  /* ── Motion: focus ring, button press, reduced-motion ── */
  :focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
    border-radius: 4px;
    transition: outline-offset 0.15s ease;
  }
  .btn { will-change: transform; }
  .btn:active { transform: scale(0.97); }
  .btn-primary:active { transform: scale(0.97); }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
  }

  /* ── Ambient background blobs ── */
  .bg-blobs { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
  .bg-blob {
    position: absolute; border-radius: 50%;
    filter: blur(90px); opacity: 0.06;
    animation: blobFloat 26s ease-in-out infinite;
    will-change: transform;
  }
  .dark .bg-blob { opacity: 0.05; }
  @keyframes blobFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(30px, -24px) scale(1.06); }
    66% { transform: translate(-24px, 18px) scale(0.96); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bg-blob { animation: none !important; }
  }

  /* ── Nav link underline ── */
  .nav-link { position: relative; }
  .nav-link::after {
    content: ''; position: absolute; left: 10px; right: 10px; bottom: 2px;
    height: 2px; border-radius: 2px; background: var(--c-accent);
    transform: scaleX(0); transform-origin: center;
    transition: transform 0.25s ease;
  }
  .nav-link:hover::after, .nav-link.active::after { transform: scaleX(1); }
  .nav-link.active { color: var(--c-text) !important; }

  /* ── Footer link underline ── */
  .footer-anim-link { position: relative; display: inline-block; }
  .footer-anim-link::after {
    content: ''; position: absolute; left: 0; bottom: -2px; width: 100%; height: 1px;
    background: var(--c-accent); transform: scaleX(0); transform-origin: left;
    transition: transform 0.2s ease;
  }
  .footer-anim-link:hover::after { transform: scaleX(1); }

  .font-display { font-family: var(--font-display); }

  .app-bg { background: var(--c-bg); }
  .app-surface { background: var(--c-surface); }
  .app-surface2 { background: var(--c-surface2); }
  .app-border { border-color: var(--c-border); }
  .app-text { color: var(--c-text); }
  .app-text2 { color: var(--c-text2); }
  .app-text3 { color: var(--c-text3); }
  .app-accent { color: var(--c-accent); }
  .app-accent-bg { background: var(--c-accent); }
  .app-accent-light { background: var(--c-accent-light); }
  .app-accent2 { color: var(--c-accent2); }
  .app-accent2-bg { background: var(--c-accent2); }
  .app-accent2-light { background: var(--c-accent2-light); }
  .app-amber { color: var(--c-amber); }
  .app-amber-light { background: var(--c-amber-light); }
  .app-danger { color: var(--c-danger); }

  .card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 12px;
  }

  .card-hover {
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .card-hover:hover {
    box-shadow: 0 8px 32px var(--c-shadow), 0 0 0 1px rgba(26,86,219,0.1);
    transform: translateY(-2px);
  }

  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 9px 18px; border-radius: 8px;
    font-family: var(--font-body); font-size: 14px; font-weight: 500;
    border: none; cursor: pointer; transition: all 0.15s ease;
    text-decoration: none; white-space: nowrap;
  }
  .btn-primary {
    background: var(--c-accent); color: #fff;
    box-shadow: 0 1px 3px rgba(26,86,219,0.3);
  }
  .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .btn-secondary {
    background: var(--c-surface2); color: var(--c-text);
    border: 1px solid var(--c-border);
  }
  .btn-secondary:hover { background: var(--c-border); }
  .btn-ghost {
    background: transparent; color: var(--c-text2);
    border: 1px solid transparent;
  }
  .btn-ghost:hover { background: var(--c-surface2); color: var(--c-text); }
  .logo-btn:hover { background: transparent; }
  .btn-danger { background: #FEF2F2; color: var(--c-danger); border: 1px solid #FECACA; }
  .btn-danger:hover { background: #FEE2E2; }
  .btn-export-highlight {
    background: var(--c-accent); color: #fff; border: none;
    box-shadow: 0 0 0 0 var(--c-glow);
    animation: export-pulse 2.2s ease-in-out infinite;
  }
  .btn-export-highlight:hover { filter: brightness(1.1); transform: translateY(-1px); animation-play-state: paused; }
  .btn-export-highlight:disabled { animation: none; opacity: 0.7; cursor: default; }
  @keyframes export-pulse {
    0%, 100% { box-shadow: 0 0 0 0 var(--c-glow); }
    50% { box-shadow: 0 0 0 6px transparent; }
  }
  .btn-sm { padding: 6px 12px; font-size: 13px; }
  .btn-lg { padding: 12px 28px; font-size: 15px; border-radius: 10px; }
  .btn-xl { padding: 15px 36px; font-size: 16px; border-radius: 12px; font-weight: 600; }

  .input {
    width: 100%;
    background: var(--c-surface2);
    border: 1px solid var(--c-border);
    border-radius: 8px;
    padding: 9px 12px;
    font-family: var(--font-body); font-size: 14px;
    color: var(--c-text);
    outline: none;
    transition: all 0.15s ease;
  }
  .input:focus { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-glow); }
  .input::placeholder { color: var(--c-text3); }
  textarea.input { resize: vertical; min-height: 80px; }

  .label {
    display: block; font-size: 13px; font-weight: 500;
    color: var(--c-text2); margin-bottom: 5px;
  }

  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 500;
  }
  .badge-blue { background: var(--c-accent-light); color: var(--c-accent); }
  .badge-green { background: var(--c-accent2-light); color: var(--c-accent2); }
  .badge-amber { background: var(--c-amber-light); color: var(--c-amber); }
  .badge-gray { background: var(--c-surface2); color: var(--c-text2); border: 1px solid var(--c-border); }

  .divider { height: 1px; background: var(--c-border); }

  /* Navbar */
  .navbar {
    position: sticky; top: var(--banner-h, 0px); z-index: 50;
    background: rgba(248,247,244,0.92);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--c-border);
    transition: background 0.2s;
  }
  .dark .navbar { background: rgba(12,12,10,0.92); }

  /* Hero gradient */
  .hero-grad {
    position: relative;
    background: radial-gradient(ellipse 90% 65% at 50% -15%, rgba(26,86,219,0.14) 0%, transparent 68%),
                radial-gradient(ellipse 45% 45% at 82% 55%, rgba(5,150,105,0.08) 0%, transparent 60%),
                radial-gradient(ellipse 35% 35% at 8% 70%, rgba(139,92,246,0.06) 0%, transparent 60%),
                var(--c-bg);
    overflow: hidden;
  }
  .hero-grad::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--c-border) 1px, transparent 1px),
      linear-gradient(to bottom, var(--c-border) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(ellipse 65% 55% at 50% 0%, #000 0%, transparent 75%);
    mask-image: radial-gradient(ellipse 65% 55% at 50% 0%, #000 0%, transparent 75%);
    opacity: 0.35;
    pointer-events: none;
    z-index: 0;
  }
  .hero-grad > * { position: relative; z-index: 1; }

  /* Score ring */
  .score-ring {
    width: 80px; height: 80px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display); font-size: 22px; font-weight: 700;
    position: relative;
  }

  /* Animated gradient text */
  @keyframes gradShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .grad-text {
    background: linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 50%, var(--c-accent2) 100%);
    background-size: 200% 200%;
    animation: gradShift 4s ease infinite;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* Pulse dot */
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }
  .pulse-dot { animation: pulse-dot 1.5s ease infinite; }

  /* Fade in */
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeInUp 0.4s ease forwards; }
  .fade-in-delay-1 { animation: fadeInUp 0.4s ease 0.1s both; }
  .fade-in-delay-2 { animation: fadeInUp 0.4s ease 0.2s both; }
  .fade-in-delay-3 { animation: fadeInUp 0.4s ease 0.3s both; }

  /* Resume preview */
  .resume-preview {
    font-family: 'Poppins', sans-serif;
    background: #ffffff;
    color: #111111;
    padding: 32px 36px;
    line-height: 1.5;
    font-size: 11px;
    width: 100%;
    min-height: 700px;
    transform-origin: top left;
    text-align: left;
  }
  .resume-preview h1 { font-family: 'Poppins', sans-serif; font-size: 22px; font-weight: 700; margin: 0 0 2px; color: #0F0F0F; }
  .resume-preview h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #1A56DB; margin: 16px 0 6px; border-bottom: 1.5px solid #1A56DB; padding-bottom: 4px; }
  .resume-preview h3 { font-size: 11px; font-weight: 600; margin: 0; color: #0F0F0F; }
  .resume-preview .subtitle { font-size: 12px; color: #555; margin: 0; }
  .resume-preview .meta { font-size: 10px; color: #888; display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
  .resume-preview .exp-item { margin-bottom: 10px; }
  .resume-preview .exp-header { display: flex; justify-content: space-between; align-items: flex-start; }
  .resume-preview ul { margin: 4px 0; padding-left: 14px; }
  .resume-preview ul li { margin-bottom: 2px; color: #333; }
  .resume-preview .skill-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .resume-preview .skill-tag { background: #EEF2FF; color: #1A56DB; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; }
  .resume-preview .section { margin-bottom: 12px; }

  /* Sidebar */
  .sidebar-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: 8px;
    font-size: 14px; font-weight: 500; cursor: pointer;
    color: var(--c-text2); transition: all 0.15s;
    border: none; background: none; width: 100%; text-align: left;
  }
  .sidebar-item:hover { background: var(--c-surface2); color: var(--c-text); }
  .sidebar-item.active { background: var(--c-accent-light); color: var(--c-accent); }

  /* Progress bar */
  .progress-bar {
    height: 4px; background: var(--c-surface2); border-radius: 99px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; background: var(--c-accent); border-radius: 99px;
    transition: width 0.4s ease;
  }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--c-text3); }

  /* Template card */
  .template-card {
    border-radius: 12px;
    overflow: hidden;
    border: 2px solid var(--c-border);
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .template-card:hover, .template-card.selected {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 1px var(--c-accent), 0 12px 40px var(--c-shadow);
  }

  /* Stat card */
  .stat-card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: 12px;
    padding: 20px;
  }

  /* AI panel */
  .ai-panel {
    background: linear-gradient(135deg, var(--c-accent-light) 0%, var(--c-surface) 100%);
    border: 1px solid rgba(26,86,219,0.2);
    border-radius: 12px;
    padding: 16px;
  }

  /* Tooltip */
  .tooltip { position: relative; }
  .tooltip-content {
    display: none; position: absolute; bottom: calc(100% + 8px); left: 50%;
    transform: translateX(-50%);
    background: var(--c-text); color: var(--c-bg);
    font-size: 12px; padding: 4px 10px; border-radius: 6px;
    white-space: nowrap; pointer-events: none; z-index: 100;
  }
  .tooltip:hover .tooltip-content { display: block; }

  /* Mobile overlay */
  @media (max-width: 768px) {
    .desktop-only { display: none !important; }
  }
  @media (min-width: 769px) {
    .mobile-only { display: none !important; }
  }

  /* ── Responsive ── */
  @media (max-width: 1024px) and (min-width: 769px) {
    /* Features grid: 2 col on tablet */
    .features-grid { grid-template-columns: repeat(2, 1fr) !important; }
  }
  @media (max-width: 768px) {
    /* Features grid: 1 col on mobile */
    .features-grid { grid-template-columns: 1fr !important; }

    /* Dashboard grid: stack */
    .dashboard-main { grid-template-columns: 1fr !important; }
    .dashboard-stats { grid-template-columns: repeat(2, 1fr) !important; }

    /* Builder: hide sidebar + editor, show full preview or tabs */
    .builder-layout { flex-direction: column !important; height: auto !important; }
    .builder-sidebar { width: 100% !important; flex-direction: row !important; overflow-x: auto !important; padding: 8px 12px !important; border-right: none !important; border-bottom: 1px solid var(--c-border) !important; }
    .builder-editor { flex: none !important; width: 100% !important; max-height: 50vh !important; }
    .builder-preview-wrap { min-height: 60vh !important; }

    /* Hero floating chips: hide on mobile */
    .hero-chip { display: none !important; }

    /* Hero mockup: simplified on mobile */
    .hero-mockup { display: none !important; }
  }

  @media (max-width: 480px) {
    .dashboard-stats { grid-template-columns: 1fr !important; }
  }

  /* Shine effect on cards */
  .shine {
    position: relative; overflow: hidden;
  }
  .shine::after {
    content: ''; position: absolute; top: 0; left: -100%;
    width: 60%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
    transition: left 0.5s ease;
  }
  .shine:hover::after { left: 150%; }

  /* Step indicator */
  .step-dot {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600; transition: all 0.2s;
    border: 2px solid var(--c-border);
    background: var(--c-surface); color: var(--c-text3);
  }
  .step-dot.active { border-color: var(--c-accent); background: var(--c-accent); color: #fff; }
  .step-dot.done { border-color: var(--c-accent2); background: var(--c-accent2); color: #fff; }

  .backdrop-blur-sm { backdrop-filter: blur(4px); }

  /* Typing cursor */
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  .cursor { animation: blink 1s step-start infinite; }

  /* Free badge */
  @keyframes freePop {
    0%   { transform: scale(1) rotate(-2deg); }
    50%  { transform: scale(1.03) rotate(0deg); }
    100% { transform: scale(1) rotate(-2deg); }
  }
  @keyframes freeGlow {
    0%, 100% { box-shadow: 0 0 14px 2px rgba(16,185,129,0.3), 0 3px 16px rgba(5,150,105,0.2); }
    50%       { box-shadow: 0 0 22px 5px rgba(16,185,129,0.42), 0 5px 20px rgba(5,150,105,0.28); }
  }
  .free-badge {
    animation: freePop 2.8s ease-in-out infinite, freeGlow 2.8s ease-in-out infinite;
  }

  /* Print / PDF export */
  @page {
    margin: 40px 48px;
    size: A4;
  }
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .no-print { display: none !important; }
    .navbar { display: none !important; }
    .builder-sidebar { display: none !important; }
    .builder-editor { display: none !important; }
    html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; }
    .builder-layout { display: block !important; height: auto !important; overflow: visible !important; }
    .builder-preview-wrap {
      position: static !important;
      width: 100% !important;
      height: auto !important;
      overflow: visible !important;
      background: white !important;
      padding: 0 !important;
      display: block !important;
      box-shadow: none !important;
    }
    .builder-preview-wrap > div { height: auto !important; overflow: visible !important; box-shadow: none !important; border-radius: 0 !important; }
    .resume-preview {
      transform: none !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      padding: 0 !important;
      font-size: 11pt !important;
      box-shadow: none !important;
      margin: 0 !important;
    }
  }
`;

// ─── RESUME PREVIEW COMPONENT ─────────────────────────────────────────────────

// Shared body sections (summary, experience, skills, education, certs, projects)
function ResumeSections({ r, accent, text, muted, skillBg, entrySpacing = null }) {
  const sh = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 3, marginBottom: 8 };
  // Each entry type hardcodes its own default gap; only override when the
  // user has explicitly moved the spacing slider.
  const es = (v) => entrySpacing ?? v;
  return (
    <>
      {r.summary && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Professional Summary</div>
          <p style={{ margin: 0, color: muted, lineHeight: 1.6 }}>{r.summary}</p>
        </div>
      )}
      {r.experience?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Work Experience</div>
          {r.experience.map(exp => (
            <div key={exp.id} style={{ marginBottom: es(10) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 11, color: text }}>{exp.role}</div>
                  <span style={{ color: accent, fontSize: 10, fontWeight: 600 }}>{exp.company}</span>
                  {exp.location && <span style={{ color: muted, fontSize: 10 }}> · {exp.location}</span>}
                </div>
                <span style={{ color: muted, fontSize: 10, whiteSpace: "nowrap" }}>{exp.start}{exp.end ? ` – ${exp.end}` : ""}</span>
              </div>
              {exp.bullets?.filter(Boolean).length > 0 && (
                <ul style={{ margin: "4px 0", paddingLeft: 14 }}>
                  {exp.bullets.filter(Boolean).map((b, i) => <li key={i} style={{ color: muted, marginBottom: 2 }}>{b}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {r.skills?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Skills</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {r.skills.map((s, i) => <span key={i} style={{ background: skillBg || "#EEF2FF", color: accent, padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 500 }}>{s}</span>)}
          </div>
        </div>
      )}
      {r.education?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Education</div>
          {r.education.map(edu => (
            <div key={edu.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: es(6) }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 11, color: text }}>{edu.degree}</div>
                <span style={{ color: accent, fontSize: 10, fontWeight: 600 }}>{edu.school}</span>
                {edu.gpa && <span style={{ color: muted, fontSize: 10 }}> · GPA: {edu.gpa}</span>}
              </div>
              <span style={{ color: muted, fontSize: 10 }}>{edu.year}</span>
            </div>
          ))}
        </div>
      )}
      {r.certifications?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Certifications</div>
          {r.certifications.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: text }}>{c.name} <span style={{ color: accent, fontWeight: 400 }}>· {c.issuer}</span></span>
              <span style={{ color: muted, fontSize: 10 }}>{c.year}</span>
            </div>
          ))}
        </div>
      )}
      {r.projects?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Projects</div>
          {r.projects.map(p => (
            <div key={p.id} style={{ marginBottom: es(8) }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: text }}>{p.name}</div>
                {(p.start || p.end) && <span style={{ color: muted, fontSize: 10 }}>{p.start}{p.end ? ` – ${p.end}` : ""}</span>}
              </div>
              {p.url && <div style={{ color: accent, fontSize: 10 }}>{p.url}</div>}
              {p.desc && <p style={{ margin: "2px 0", color: muted }}>{p.desc}</p>}
            </div>
          ))}
        </div>
      )}
      {(r.personal?.website || r.personal?.linkedin || r.personal?.github) && (
        <div style={{ marginBottom: 14 }}>
          <div style={sh}>Portfolio & Links</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {r.personal.website && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: muted }}>🌐</span>
                <span style={{ color: accent, fontSize: 10 }}>{r.personal.website}</span>
              </div>
            )}
            {r.personal.linkedin && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: muted }}>in</span>
                <span style={{ color: accent, fontSize: 10 }}>{r.personal.linkedin}</span>
              </div>
            )}
            {r.personal.github && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: muted }}>⌥</span>
                <span style={{ color: accent, fontSize: 10 }}>{r.personal.github}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ResumePreview({ resume, scale = 1, templateId = "clarity", customAccent = "", customBg = "", customText = "", customHeaderBg = "", customMuted = "", customNameColor = "", entrySpacing = null }) {
  const r = resume;
  // Each template hardcodes its own default entry gap (10-14px); only override
  // it when the user has explicitly moved the spacing slider.
  const es = (v) => entrySpacing ?? v;
  const tpl = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[1];
  const accent = customAccent || tpl.accent;
  const wrap = { transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" };
  const font = "'Poppins', sans-serif";
  const contacts = [
    r.personal.email && `✉ ${r.personal.email}`,
    r.personal.phone && `📱 ${r.personal.phone}`,
    r.personal.location && `📍 ${r.personal.location}`,
    r.personal.linkedin && `in ${r.personal.linkedin}`,
    r.personal.github && `⚡ ${r.personal.github}`,
    r.personal.website && `🌐 ${r.personal.website}`,
  ].filter(Boolean);

  // ── SIDEBAR TEMPLATES (two-column) ──────────────────────────────────────────
  if (["axiom", "portrait", "prism", "frame"].includes(templateId)) {
    const isDarkSide = ["portrait", "prism", "frame"].includes(templateId);
    const sideBg = customHeaderBg || (templateId === "axiom" ? "#4C1D95" : templateId === "prism" ? "#5B21B6" : templateId === "frame" ? "#0D1117" : "#13113A");
    const sideText = "#EDE9FE";
    const sideAccent = templateId === "axiom" ? "#A78BFA" : accent;
    const contentBg = customBg || (templateId === "axiom" ? "#FAFAF9" : templateId === "prism" ? "#F5F3FF" : "#1E1B4B");
    const contentText = customText || (isDarkSide ? "#E0E7FF" : "#111827");
    const contentMuted = customMuted || (isDarkSide ? "#A5B4FC" : "#4B5563");
    return (
      <div className="resume-preview" style={{ ...wrap, background: contentBg, color: contentText, padding: 0, display: "flex", minHeight: 700 }}>
        {/* Sidebar */}
        <div style={{ width: "34%", background: sideBg, padding: "28px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          {tpl.photo && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              {r.personal.photo
                ? <img src={r.personal.photo} alt={r.personal.name} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", border: `3px solid ${sideAccent}` }} />
                : <div style={{ width: 80, height: 80, borderRadius: "50%", background: sideAccent + "44", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: sideAccent }}>
                    {r.personal.name?.[0] || "?"}
                  </div>
              }
            </div>
          )}
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: customNameColor || "#fff", lineHeight: 1.2 }}>{r.personal.name || "Your Name"}</div>
            <div style={{ fontSize: 11, color: sideAccent, marginTop: 4 }}>{r.personal.title || "Professional Title"}</div>
          </div>
          <div style={{ borderTop: `1px solid ${sideAccent}44`, paddingTop: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: sideAccent, marginBottom: 6, letterSpacing: "0.08em" }}>Contact</div>
            {contacts.map((c, i) => <div key={i} style={{ fontSize: 9, color: sideText, marginBottom: 4, wordBreak: "break-all" }}>{c}</div>)}
          </div>
          {r.skills?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: sideAccent, marginBottom: 6, letterSpacing: "0.08em" }}>Skills</div>
              {r.skills.map((sk, i) => (
                <div key={i} style={{ marginBottom: 5 }}>
                  <div style={{ fontSize: 10, color: sideText, marginBottom: 2 }}>{sk}</div>
                  <div style={{ height: 3, background: sideAccent + "33", borderRadius: 99 }}>
                    <div style={{ height: "100%", background: sideAccent, borderRadius: 99, width: `${65 + (i * 5) % 35}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {r.education?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: sideAccent, marginBottom: 6, letterSpacing: "0.08em" }}>Education</div>
              {r.education.map(e => (
                <div key={e.id} style={{ marginBottom: es(6) }}>
                  <div style={{ fontWeight: 700, fontSize: 10, color: "#fff" }}>{e.degree}</div>
                  <div style={{ fontSize: 9, color: sideText }}>{e.school}{e.year ? ` · ${e.year}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Content */}
        <div style={{ flex: 1, padding: "28px 24px", fontFamily: font, fontSize: 11, lineHeight: 1.5 }}>
          <ResumeSections r={r} accent={sideAccent} text={contentText} muted={contentMuted} skillBg={sideAccent + "22"} entrySpacing={entrySpacing} />
        </div>
      </div>
    );
  }

  // ── PHOTO TOP-RIGHT (pulse) ──────────────────────────────────────────────────
  if (templateId === "pulse") {
    const bg = customBg || "#0C0A09"; const text = customText || "#FAFAF9"; const muted = customMuted || "#A8A29E";
    return (
      <div className="resume-preview" style={{ ...wrap, background: bg, color: text }}>
        <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 14, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ color: customNameColor || text, margin: "0 0 2px" }}>{r.personal.name || "Your Name"}</h1>
            <div style={{ fontSize: 12, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{r.personal.title || "Professional Title"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: muted }}>{c}</span>)}
            </div>
          </div>
          {r.personal.photo
            ? <img src={r.personal.photo} alt={r.personal.name} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", border: `2px solid ${accent}`, flexShrink: 0 }} />
            : <div style={{ width: 72, height: 72, borderRadius: 10, background: accent + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: accent, flexShrink: 0 }}>{r.personal.name?.[0] || "?"}</div>
          }
        </div>
        <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg="#1C1917" entrySpacing={entrySpacing} />
      </div>
    );
  }

  // ── PHOTO HEADER BAND (vista, lens) ─────────────────────────────────────────
  if (["vista", "lens", "aura"].includes(templateId)) {
    const isVista = templateId === "vista";
    const isAura = templateId === "aura";
    const grad = isVista ? "linear-gradient(135deg,#EC4899,#BE185D)" : isAura ? "linear-gradient(180deg,#7C3AED,#A855F7)" : "linear-gradient(135deg,#0EA5E9,#0369A1)";
    const headerText = "#fff"; const headerMuted = isVista ? "#FBCFE8" : "#BAE6FD";
    const bg = customBg || (isVista ? "#FFF1F2" : isAura ? "#F5F3FF" : "#F0F9FF"); const text = customText || "#1F2937"; const muted = customMuted || "#6B7280";
    return (
      <div className="resume-preview" style={{ ...wrap, background: bg, color: text, padding: 0 }}>
        <div style={{ background: customHeaderBg || grad, padding: "24px 32px 20px", display: "flex", alignItems: "center", gap: 20, marginBottom: 0 }}>
          {r.personal.photo
            ? <img src={r.personal.photo} alt={r.personal.name} style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,0.6)", flexShrink: 0 }} />
            : <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{r.personal.name?.[0] || "?"}</div>
          }
          <div style={{ flex: 1 }}>
            <h1 style={{ color: customNameColor || headerText, margin: "0 0 2px", fontSize: 22 }}>{r.personal.name || "Your Name"}</h1>
            <div style={{ fontSize: 12, color: headerMuted, marginBottom: 6 }}>{r.personal.title || "Professional Title"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: headerMuted }}>{c}</span>)}
            </div>
          </div>
        </div>
        <div style={{ padding: "24px 32px" }}>
          <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={isVista ? "#FCE7F3" : "#E0F2FE"} entrySpacing={entrySpacing} />
        </div>
      </div>
    );
  }

  // ── COLORED HEADER BAND (echo, flow, summit, bloom) ─────────────────────────
  if (["echo", "flow", "summit", "bloom", "charter", "halo"].includes(templateId)) {
    const grads = {
      echo: accent, flow: accent,
      summit: "linear-gradient(135deg,#1D4ED8,#1E40AF)",
      bloom: "linear-gradient(135deg,#D946EF,#9333EA)",
      charter: "linear-gradient(135deg,#1D4ED8,#2563EB)",
      halo: "linear-gradient(135deg,#7C3AED,#A855F7)",
    };
    const bgs = { echo: "#F0F9FF", flow: "#FFFFFF", summit: "#EFF6FF", bloom: "#FDF4FF", charter: "#EFF6FF", halo: "#FAF5FF" };
    const headerBg = customHeaderBg || grads[templateId] || accent;
    const contentBg = customBg || bgs[templateId] || "#fff";
    const text = customText || "#0F172A"; const muted = customMuted || "#475569";
    return (
      <div className="resume-preview" style={{ ...wrap, background: contentBg, color: text, padding: 0 }}>
        <div style={{ background: headerBg, padding: "24px 32px 20px", marginBottom: 0 }}>
          <h1 style={{ color: customNameColor || "#fff", margin: "0 0 2px", fontSize: 22 }}>{r.personal.name || "Your Name"}</h1>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>{r.personal.title || "Professional Title"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.75)" }}>{c}</span>)}
          </div>
        </div>
        <div style={{ padding: "24px 32px" }}>
          <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "22"} entrySpacing={entrySpacing} />
        </div>
      </div>
    );
  }

  // ── DARK TEMPLATES (apex, nova, edge, spark) ─────────────────────────────────
  if (["apex", "nova", "edge", "spark", "nexus", "vector", "crimson", "atlas"].includes(templateId)) {
    const bg = customBg || tpl.bg; const text = customText || "#E2E8F0"; const muted = customMuted || "#94A3B8";
    const leftStrip = templateId === "edge";
    return (
      <div className="resume-preview" style={{ ...wrap, background: bg, color: text, padding: 0, display: "flex" }}>
        {leftStrip && <div style={{ width: 5, background: accent, flexShrink: 0 }} />}
        <div style={{ flex: 1, padding: "32px 36px" }}>
          <div style={{ borderBottom: `1.5px solid ${accent}`, paddingBottom: 14, marginBottom: 14 }}>
            <h1 style={{ color: customNameColor || "#fff", margin: "0 0 2px" }}>{r.personal.name || "Your Name"}</h1>
            <div style={{ fontSize: 12, color: accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{r.personal.title || "Professional Title"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: muted }}>{c}</span>)}
            </div>
          </div>
          <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "22"} entrySpacing={entrySpacing} />
        </div>
      </div>
    );
  }

  // ── EXECUTIVE / FORM ────────────────────────────────────────────────────────
  if (templateId === "form") {
    const text = customText || "#0F172A"; const muted = customMuted || "#475569"; const rule = "#CBD5E1";
    return (
      <div className="resume-preview" style={{ ...wrap, background: customBg || "#FFFFFF", color: text }}>
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ color: customNameColor || "#0F172A", margin: "0 0 2px", fontSize: 26, letterSpacing: "-0.025em" }}>{r.personal.name || "Your Name"}</h1>
          <div style={{ fontSize: 13, color: muted, marginBottom: 6 }}>{r.personal.title || "Professional Title"}</div>
          <div style={{ height: 2, background: "#0F172A", margin: "8px 0 6px" }} />
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 4 }}>
            {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: muted }}>{c}</span>)}
          </div>
        </div>
        <ResumeSections r={r} accent="#1E293B" text={text} muted={muted} skillBg="#F1F5F9" entrySpacing={entrySpacing} />
      </div>
    );
  }

  // ── PRESTIGE (warm ivory, centered header) ───────────────────────────────────
  if (templateId === "prestige") {
    const text = customText || "#1C0A00"; const muted = customMuted || "#6B5747";
    return (
      <div className="resume-preview" style={{ ...wrap, background: customBg || "#FFFBF5", color: text }}>
        <div style={{ textAlign: "center", borderBottom: `2px solid ${accent}`, paddingBottom: 12, marginBottom: 14 }}>
          <h1 style={{ color: customNameColor || text, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.personal.name || "Your Name"}</h1>
          <div style={{ fontSize: 12, color: accent, marginBottom: 6 }}>{r.personal.title || "Professional Title"}</div>
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
            {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: muted }}>{c}</span>)}
          </div>
        </div>
        <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "18"} entrySpacing={entrySpacing} />
      </div>
    );
  }

  // ── CHRONICLE: two-column executive (left sidebar + right content) ────────────
  if (templateId === "chronicle") {
    const bg = customBg || "#FFFFFF";
    const text = customText || "#111827";
    const muted = customMuted || "#4B5563";
    const sh = { fontSize: 10, fontWeight: 800, color: customNameColor || accent, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `1.5px solid ${accent}`, paddingBottom: 3, marginBottom: 8 };
    return (
      <div className="resume-preview" style={{ ...wrap, background: bg, color: text, padding: 0, display: "flex", minHeight: 700 }}>
        {/* ── Left sidebar ── */}
        <div style={{ width: "30%", padding: "28px 16px", borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 16, flexShrink: 0 }}>
          {/* Contact */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Contact</div>
            {contacts.map((c, i) => <div key={i} style={{ fontSize: 9, color: muted, marginBottom: 5, wordBreak: "break-all" }}>{c}</div>)}
          </div>
          {/* Skills */}
          {r.skills?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Skills</div>
              {r.skills.map((sk, i) => (
                <div key={i} style={{ fontSize: 9, color: muted, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ color: accent, fontSize: 8, flexShrink: 0 }}>•</span>{sk}
                </div>
              ))}
            </div>
          )}
          {/* Certifications */}
          {r.certifications?.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Certification</div>
              {r.certifications.map(c => (
                <div key={c.id} style={{ fontSize: 9, color: muted, marginBottom: 5 }}>
                  <div style={{ fontWeight: 700, color: text }}>{c.name}</div>
                  <div>{c.issuer}{c.year ? ` · ${c.year}` : ""}</div>
                </div>
              ))}
            </div>
          )}
          {/* Portfolio */}
          {(r.personal.website || r.personal.github || r.personal.linkedin) && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Portfolio</div>
              {r.personal.website && <div style={{ fontSize: 9, color: accent, marginBottom: 3, wordBreak: "break-all" }}>🌐 {r.personal.website}</div>}
              {r.personal.github && <div style={{ fontSize: 9, color: accent, marginBottom: 3, wordBreak: "break-all" }}>⚡ {r.personal.github}</div>}
              {r.personal.linkedin && <div style={{ fontSize: 9, color: accent, wordBreak: "break-all" }}>in {r.personal.linkedin}</div>}
            </div>
          )}
        </div>
        {/* ── Right content ── */}
        <div style={{ flex: 1, padding: "28px 28px" }}>
          {/* Name header with photo on right */}
          <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid #E5E7EB`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ color: customNameColor || text, margin: "0 0 3px", fontSize: 26, fontWeight: 900, letterSpacing: "-0.02em" }}>{r.personal.name || "Your Name"}</h1>
              <div style={{ fontSize: 12, color: accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{r.personal.title || "Professional Title"}</div>
              <div style={{ fontSize: 10, color: muted, marginTop: 4 }}>{r.personal.location}</div>
            </div>
            {/* Photo — top right */}
            {r.personal.photo ? (
              <img src={r.personal.photo} alt={r.personal.name}
                style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", border: `3px solid ${accent}`, flexShrink: 0 }} />
            ) : (
              <div style={{ width: 88, height: 88, borderRadius: "50%", background: accent + "18", border: `2px dashed ${accent}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: accent, flexShrink: 0 }}>
                {r.personal.name?.[0] || "?"}
              </div>
            )}
          </div>
          {/* Summary */}
          {r.summary && (
            <div style={{ marginBottom: 14 }}>
              <div style={sh}>Summary</div>
              <p style={{ margin: 0, color: muted, lineHeight: 1.65, fontSize: 11 }}>{r.summary}</p>
            </div>
          )}
          {/* Experience */}
          {r.experience?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={sh}>Work Experience</div>
              {r.experience.map(exp => (
                <div key={exp.id} style={{ marginBottom: es(12) }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: text }}>{exp.role}</div>
                    <span style={{ color: muted, fontSize: 10, whiteSpace: "nowrap" }}>{exp.start}{exp.end ? ` – ${exp.end}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 10, color: accent, fontWeight: 600, marginBottom: 4 }}>{exp.company}{exp.location ? ` · ${exp.location}` : ""}</div>
                  {exp.bullets?.filter(Boolean).length > 0 && (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 14 }}>
                      {exp.bullets.filter(Boolean).map((b, i) => <li key={i} style={{ color: muted, marginBottom: 3, fontSize: 10, lineHeight: 1.5 }}>{b}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Education */}
          {r.education?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={sh}>Education</div>
              {r.education.map(edu => (
                <div key={edu.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: es(6) }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 11, color: text }}>{edu.degree}</div>
                    <span style={{ color: accent, fontSize: 10, fontWeight: 600 }}>{edu.school}</span>
                    {edu.gpa && <span style={{ color: muted, fontSize: 10 }}> · GPA: {edu.gpa}</span>}
                  </div>
                  <span style={{ color: muted, fontSize: 10 }}>{edu.year}</span>
                </div>
              ))}
            </div>
          )}
          {/* Projects */}
          {r.projects?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={sh}>Projects</div>
              {r.projects.map(p => (
                <div key={p.id} style={{ marginBottom: es(8) }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontWeight: 700, fontSize: 11, color: text }}>{p.name}</div>
                    {(p.start || p.end) && <span style={{ color: muted, fontSize: 10 }}>{p.start}{p.end ? ` – ${p.end}` : ""}</span>}
                  </div>
                  {p.url && <div style={{ color: accent, fontSize: 10 }}>{p.url}</div>}
                  {p.desc && <p style={{ margin: "2px 0 0", color: muted, fontSize: 10, lineHeight: 1.5 }}>{p.desc}</p>}
                </div>
              ))}
            </div>
          )}
          {/* Portfolio links */}
          {(r.personal.website || r.personal.linkedin || r.personal.github) && (
            <div>
              <div style={sh}>Portfolio & Links</div>
              {r.personal.website && <div style={{ color: accent, fontSize: 10, marginBottom: 3 }}>🌐 {r.personal.website}</div>}
              {r.personal.linkedin && <div style={{ color: accent, fontSize: 10, marginBottom: 3 }}>in {r.personal.linkedin}</div>}
              {r.personal.github && <div style={{ color: accent, fontSize: 10 }}>⚡ {r.personal.github}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── DEFAULT (clarity, slate, pure, edge, summit, bloom, spark, etc.) ─────────
  const isLight = !["apex","nova","pulse","portrait","edge","spark","prism"].includes(templateId);
  const bg = customBg || (isLight ? (tpl.bg || "#ffffff") : tpl.bg);
  const text = customText || (isLight ? "#111111" : "#E2E8F0");
  const muted = customMuted || (isLight ? "#555555" : "#94A3B8");
  return (
    <div className="resume-preview" style={{ ...wrap, background: bg, color: text }}>
      <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 12, marginBottom: 14 }}>
        <h1 style={{ color: customNameColor || text, margin: "0 0 2px" }}>{r.personal.name || "Your Name"}</h1>
        <p style={{ margin: "0 0 6px", fontSize: 12, color: muted }}>{r.personal.title || "Professional Title"}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {contacts.map((c, i) => <span key={i} style={{ fontSize: 10, color: muted }}>{c}</span>)}
        </div>
      </div>
      <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "22"} entrySpacing={entrySpacing} />
    </div>
  );
}

// ─── MONTH/YEAR DATE PICKER ──────────────────────────────────────────────────

function MonthYearPicker({ value = "", onChange, allowPresent = false, placeholder = "Jan 2022" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const CY = new Date().getFullYear();
  const YEARS = Array.from({ length: 51 }, (_, i) => String(CY - i));

  // Parse incoming value into month + year
  const parse = v => {
    if (!v || v === "Present") return { m: "", y: "" };
    const p = v.trim().split(" ");
    if (p.length === 2 && MONTHS.includes(p[0])) return { m: p[0], y: p[1] };
    if (/^\d{4}$/.test(v)) return { m: "", y: v };
    return { m: "", y: v };
  };
  const { m: initM, y: initY } = parse(value);
  const [selMonth, setSelMonth] = useState(initM);
  const [selYear, setSelYear] = useState(initY);

  // Sync when value changes externally
  useEffect(() => {
    const { m, y } = parse(value);
    setSelMonth(m); setSelYear(y);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const apply = (m, y) => {
    if (m && y) onChange(`${m} ${y}`);
    else if (y) onChange(y);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div className="input" onClick={() => setOpen(o => !o)}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", userSelect: "none" }}>
        <span style={{ color: value ? "var(--c-text)" : "var(--c-text3)" }}>{value || placeholder}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--c-text3)", flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
          background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 12, padding: 14, boxShadow: "0 12px 40px var(--c-shadow)",
          minWidth: 240,
        }}>
          {allowPresent && (
            <button onClick={() => { onChange("Present"); setOpen(false); }}
              style={{ width: "100%", marginBottom: 10, padding: "7px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)", border: value === "Present" ? "1.5px solid var(--c-accent)" : "1px solid var(--c-border)", background: value === "Present" ? "var(--c-accent-light)" : "var(--c-surface2)", color: value === "Present" ? "var(--c-accent)" : "var(--c-text2)" }}>
              Present (Current)
            </button>
          )}

          {/* Month grid */}
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Month</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 10 }}>
            {MONTHS.map(m => (
              <button key={m} onClick={() => { setSelMonth(m); if (selYear) apply(m, selYear); }}
                style={{ padding: "5px 2px", borderRadius: 6, border: selMonth === m ? "1.5px solid var(--c-accent)" : "1px solid var(--c-border)", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)", background: selMonth === m ? "var(--c-accent-light)" : "var(--c-surface2)", color: selMonth === m ? "var(--c-accent)" : "var(--c-text2)", transition: "all 0.1s" }}>
                {m}
              </button>
            ))}
          </div>

          {/* Year selector */}
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Year</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <select value={selYear} onChange={e => { setSelYear(e.target.value); if (e.target.value) apply(selMonth, e.target.value); }}
              className="input" style={{ fontSize: 13, flex: 1 }}>
              <option value="">Select year</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <button onClick={() => { onChange(""); setSelMonth(""); setSelYear(""); setOpen(false); }}
            style={{ width: "100%", padding: "5px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-body)", background: "var(--c-surface2)", color: "var(--c-text3)" }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ATS SCORE PANEL ─────────────────────────────────────────────────────────

function ATSPanel({ resume }) {
  const { score, checks } = computeATSScore(resume);
  const color = score >= 80 ? "#059669" : score >= 60 ? "#D97706" : "#DC2626";
  const label = score >= 80 ? "Strong" : score >= 60 ? "Good" : "Needs Work";
  const circumference = 2 * Math.PI * 32;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="card" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
        <div style={{ position: "relative", width: 80, height: 80 }}>
          <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--c-surface2)" strokeWidth="6" />
            <circle cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="6"
              strokeDasharray={circumference} strokeDashoffset={dashOffset}
              strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color }}>{score}</span>
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "16px", fontWeight: 700 }}>ATS Score</div>
          <div className="badge" style={{ marginTop: 4, background: color + "22", color }}>{label}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {checks.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: c.ok ? "#ECFDF5" : "#FEF2F2", color: c.ok ? "#059669" : "#DC2626", flexShrink: 0 }}>
              {c.ok ? <Icon.Check size="3" /> : <Icon.X />}
            </div>
            <span style={{ color: c.ok ? "var(--c-text2)" : "var(--c-danger)" }}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NAVBAR ───────────────────────────────────────────────────────────────────

function UserMenu({ user, setUser, setPage }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      {/* Avatar trigger */}
      <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}>
        {user.picture
          ? <img src={user.picture} alt={user.name}
              style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--c-border)", display: "block" }} />
          : <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 600 }}>
              {user.name?.[0] || "U"}
            </div>
        }
      </div>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 99,
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            borderRadius: 12, padding: 8, minWidth: 200,
            boxShadow: "0 8px 32px var(--c-shadow)",
          }}>
            {/* User info + plan badge */}
            <div style={{ padding: "10px 12px 12px", borderBottom: "1px solid var(--c-border)", marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{user.name}</div>
              <div className="app-text3" style={{ fontSize: 12, marginBottom: 8 }}>{user.email}</div>
              {/* Plan badge */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "linear-gradient(135deg, #F59E0B, #D97706)",
                color: "#fff", fontSize: 11, fontWeight: 700,
                padding: "3px 10px", borderRadius: 99, letterSpacing: "0.03em",
              }}>
                ⭐ Premium Plan
              </div>
            </div>
            {[
              { label: "Dashboard", icon: <Icon.LayoutTemplate />, action: () => { setPage(PAGES.DASHBOARD); setOpen(false); } },
              { label: "Open Builder", icon: <Icon.Zap />, action: () => { setPage(PAGES.BUILDER); setOpen(false); } },
              { label: "Templates", icon: <Icon.FileText />, action: () => { setPage(PAGES.TEMPLATES); setOpen(false); } },
              ...(ADMIN_EMAILS.includes(user.email) ? [{ label: "Feedback (Admin)", icon: <Icon.Star />, action: () => { setPage(PAGES.ADMIN); setOpen(false); } }] : []),
            ].map((item, i) => (
              <button key={i} onClick={item.action} className="sidebar-item" style={{ width: "100%", fontSize: 14 }}>
                {item.icon} {item.label}
              </button>
            ))}
            <div style={{ borderTop: "1px solid var(--c-border)", marginTop: 4, paddingTop: 4 }}>
              <button onClick={() => { setUser(null); setPage(PAGES.HOME); setOpen(false); }}
                className="sidebar-item" style={{ width: "100%", fontSize: 14, color: "var(--c-danger)" }}>
                <Icon.LogOut /> Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BetaBanner({ setPage }) {
  const ref = useRef(null);
  const [dismissed, setDismissed] = useLocalStorage("ats-beta-banner-dismissed", false);

  useEffect(() => {
    if (dismissed) {
      document.documentElement.style.setProperty("--banner-h", "0px");
      return;
    }
    const setHeight = () => {
      const h = ref.current?.getBoundingClientRect().height || 0;
      document.documentElement.style.setProperty("--banner-h", `${h}px`);
    };
    setHeight();
    window.addEventListener("resize", setHeight);
    return () => {
      window.removeEventListener("resize", setHeight);
      document.documentElement.style.setProperty("--banner-h", "0px");
    };
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div ref={ref} style={{
      position: "sticky", top: 0, zIndex: 60,
      background: "linear-gradient(90deg, #2563EB, #1E40AF)", color: "#fff",
      padding: "9px 40px", textAlign: "center", fontSize: 13.5, fontWeight: 500,
      lineHeight: 1.5,
    }}>
      🚀 We're in Beta! ATS Resume Pilot is currently under testing. If you experience any issues or have
      suggestions, please{" "}
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); setPage(PAGES.CONTACT); }}
        style={{ color: "#fff", fontWeight: 700, textDecoration: "underline" }}
      >
        Contact Us
      </a>
      . Thank you for helping us improve.
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss beta banner"
        style={{
          position: "absolute", top: "50%", right: 12, transform: "translateY(-50%)",
          background: "none", border: "none", cursor: "pointer",
          color: "#fff", opacity: 0.8, padding: 4, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = 1}
        onMouseLeave={e => e.currentTarget.style.opacity = 0.8}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

function Navbar({ page, setPage, dark, setDark, user, setUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isBuilder = page === PAGES.BUILDER || page === PAGES.DASHBOARD;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      className="navbar"
      initial={reduceMotion ? false : { opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <div style={{
        padding: "0 24px", display: "flex", alignItems: "center",
        height: scrolled ? 50 : 58, transition: "height 0.25s ease",
      }}>
        {/* Logo */}
        <button onClick={() => setPage(PAGES.HOME)} className="btn btn-ghost logo-btn" style={{ padding: "6px 8px", gap: 8 }}>
          <img src="/logo.svg" alt="ATS Resume Pilot" style={{ height: 88, width: "auto", display: "block" }} />
        </button>

        <div style={{ flex: 1 }} />

        {/* Desktop nav */}
        <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {!isBuilder && (
            <button className={cn("btn btn-ghost btn-sm nav-link", page === PAGES.TEMPLATES && "active")} onClick={() => setPage(PAGES.TEMPLATES)}>Templates</button>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => setDark(!dark)}>
            {dark ? <Icon.Sun /> : <Icon.Moon />}
          </button>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.DASHBOARD)}>
                <Icon.LayoutTemplate /> Dashboard
              </button>
              <UserMenu user={user} setUser={setUser} setPage={setPage} />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.LOGIN)}>Sign in</button>
              <button className="btn btn-primary btn-sm" onClick={() => setPage(PAGES.REGISTER)}>Get Started</button>
            </div>
          )}
        </div>

        {/* Mobile */}
        <div className="mobile-only" style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDark(!dark)}>{dark ? <Icon.Sun /> : <Icon.Moon />}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(!mobileOpen)}><Icon.Menu /></button>
        </div>
      </div>

      {mobileOpen && (
        <div style={{ borderTop: "1px solid var(--c-border)", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
          <button className="sidebar-item" onClick={() => { setPage(PAGES.TEMPLATES); setMobileOpen(false); }}>Templates</button>
          {user ? (
            <>
              <button className="sidebar-item" onClick={() => { setPage(PAGES.DASHBOARD); setMobileOpen(false); }}>Dashboard</button>
              {ADMIN_EMAILS.includes(user.email) && (
                <button className="sidebar-item" onClick={() => { setPage(PAGES.ADMIN); setMobileOpen(false); }}>Feedback (Admin)</button>
              )}
              <button className="sidebar-item" onClick={() => { setUser(null); setPage(PAGES.HOME); setMobileOpen(false); }}>Sign out</button>
            </>
          ) : (
            <>
              <button className="sidebar-item" onClick={() => { setPage(PAGES.LOGIN); setMobileOpen(false); }}>Sign in</button>
              <button className="btn btn-primary btn-sm" onClick={() => { setPage(PAGES.REGISTER); setMobileOpen(false); }}>Get Started</button>
            </>
          )}
        </div>
      )}
    </motion.nav>
  );
}

// Horizontal connecting line behind the "How It Works" 3-step grid that
// draws itself left-to-right as the section scrolls into view. Desktop-only
// (matches the row's 3-column layout; hidden when it collapses to 1 column).
function HowItWorksConnector() {
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "start 0.3"] });
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  return (
    <motion.div
      ref={ref}
      className="how-it-works-connector"
      aria-hidden="true"
      style={{
        position: "absolute", top: 28, left: "16.5%", right: "16.5%", height: 2,
        background: "linear-gradient(90deg, var(--c-accent), var(--c-accent2))",
        transformOrigin: "0% 50%", scaleX: reduceMotion ? 1 : scaleX, zIndex: 0,
        display: "none",
      }}
    />
  );
}

// ─── ATS SCORE DEMO ───────────────────────────────────────────────────────────
// Before/after resume-score comparison. The score counts up once the section
// scrolls into view (IntersectionObserver), matching the "animate the score
// increasing" behavior without re-triggering on every re-render.
function AtsScoreDemo() {
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [beforeScore, setBeforeScore] = useState(0);
  const [afterScore, setAfterScore] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const duration = 1200;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setBeforeScore(Math.round(58 * ease));
      setAfterScore(Math.round(92 * ease));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const ScoreRing = ({ score, color, trackColor }) => (
    <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
      <svg width="96" height="96" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="48" cy="48" r="40" fill="none" stroke={trackColor} strokeWidth="8" />
        <circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${2 * Math.PI * 40}`}
          strokeDashoffset={`${2 * Math.PI * 40 * (1 - score / 100)}`}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.1s linear" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22, color, fontFamily: "var(--font-display)" }}>
        {score}
      </div>
    </div>
  );

  const weakPoints = ["Missing Important Keywords", "Weak Action Verbs", "Inconsistent Formatting", "Grammar & Spelling Issues", "Low ATS Compatibility"];
  const improvements = ["Strong ATS Keyword Match", "Powerful Action Verbs", "Professional Formatting", "Grammar & Spelling Fixed", "High ATS Compatibility"];
  const processSteps = [
    { icon: <Icon.Target />, title: "ATS Analysis", desc: "Scanning content and structure" },
    { icon: <Icon.Sparkles />, title: "Keyword Optimization", desc: "Adding relevant industry keywords" },
    { icon: <Icon.FileText />, title: "Grammar & Spelling Check", desc: "Fixing errors and improving clarity" },
    { icon: <Icon.LayoutTemplate />, title: "Formatting Enhancement", desc: "Improving structure and readability" },
  ];

  const ConnectorDot = ({ delay, rotate }) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={visible ? { opacity: 1, scale: 1 } : {}}
      transition={{ duration: 0.4, delay, ease: EASE_OUT }}
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 6px 16px var(--c-shadow)", flexShrink: 0,
        color: "#fff",
      }}
    >
      <span style={{ display: "flex", transform: rotate ? `rotate(${rotate}deg)` : "none" }}><Icon.ArrowRight /></span>
    </motion.div>
  );

  const ConnectorArrow = ({ delay }) => (
    <>
      <div className="ats-connector-h" style={{ display: "flex", justifyContent: "center" }}>
        <ConnectorDot delay={delay} />
      </div>
      <div className="ats-connector-v" style={{ display: "none", justifyContent: "center" }}>
        <ConnectorDot delay={delay} rotate={90} />
      </div>
    </>
  );

  const ResumeSnippet = ({ tone }) => (
    <div style={{
      background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: 10,
      padding: "14px 16px", marginTop: 20, textAlign: "left",
    }}>
      <div className="font-display" style={{ fontSize: 13, fontWeight: 800, color: "var(--c-text)" }}>JOHN DOE</div>
      <div style={{ fontSize: 11, color: "var(--c-text3)", marginBottom: 8 }}>Web Developer</div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: tone === "after" ? "var(--c-accent2)" : "var(--c-text3)", marginBottom: 4 }}>
        Professional Summary
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--c-text3)" }}>
        {tone === "after"
          ? "Results-driven Web Developer with 4+ years of experience building scalable web applications using JavaScript, React, and Node.js."
          : "Experienced developer with a passion for building web applications. Worked on various projects using different technologies."}
      </div>
    </div>
  );

  return (
    <section ref={ref} style={{ padding: "80px 24px" }}>
      <Reveal style={{ textAlign: "center", marginBottom: 48 }}>
        <div className="badge badge-blue" style={{ marginBottom: 16, fontSize: 12, display: "inline-flex" }}>
          <Icon.Sparkles /> AI-Powered Resume Optimization
        </div>
        <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, margin: "0 0 12px" }}>
          See How <span className="grad-text">AI Improves</span> Your Resume
        </h2>
        <p className="app-text2" style={{ fontSize: 17, maxWidth: 560, margin: "0 auto 8px" }}>
          Our AI analyzes your resume against real ATS rules and optimizes it to help you pass screening and get more interview calls.
        </p>
      </Reveal>

      <Reveal stagger={0.12} className="ats-demo-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", alignItems: "center", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
        {/* Before */}
        <RevealItem className="card ats-before-card" style={{ padding: 24, position: "relative" }}>
          <div className="badge" style={{ marginBottom: 16, fontSize: 12, background: "#FEE2E2", color: "#B91C1C" }}>Before Optimization</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <ScoreRing score={beforeScore} color="#DC2626" trackColor="#FEE2E2" />
            <div>
              <div style={{ fontSize: 12, color: "var(--c-text3)" }}>ATS Score</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#DC2626" }}>Needs Work</div>
              <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Low match rate</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18, textAlign: "left" }}>
            {weakPoints.map(item => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--c-text3)" }}>
                <span style={{ color: "#DC2626", flexShrink: 0 }}><Icon.X /></span>
                {item}
              </div>
            ))}
          </div>
          <ResumeSnippet tone="before" />
        </RevealItem>

        <ConnectorArrow delay={0.5} />

        {/* AI Process */}
        <RevealItem className="card ats-process-card" style={{ padding: 24, textAlign: "center" }}>
          <div className="font-display" style={{ fontSize: 15, fontWeight: 800, marginBottom: 18, color: "var(--c-text)" }}>
            AI Optimization Process
          </div>
          <motion.div
            style={{
              width: 68, height: 68, borderRadius: "50%", margin: "0 auto 18px",
              background: "linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 10px 28px var(--c-shadow)",
            }}
            animate={visible && !reduceMotion ? { scale: [1, 1.06, 1] } : {}}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <span style={{ color: "#fff", transform: "scale(1.6)" }}><Icon.Sparkles /></span>
          </motion.div>
          <motion.div
            style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}
            initial="hidden"
            animate={visible ? "show" : "hidden"}
            variants={staggerContainerVariants(0.12, 0.3)}
          >
            {processSteps.map((step, i) => (
              <motion.div key={step.title} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE_OUT } } }}
                style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "var(--c-accent-light)", color: "var(--c-accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {step.icon}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)" }}>{step.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--c-text3)" }}>{step.desc}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
          <div className="badge badge-blue" style={{ marginTop: 18, fontSize: 12, width: "100%", justifyContent: "center" }}>
            <Icon.Sparkles /> Optimization Complete
          </div>
        </RevealItem>

        <ConnectorArrow delay={0.9} />

        {/* After */}
        <RevealItem className="card ats-after-card" style={{ padding: 24, border: "1.5px solid var(--c-accent2)", position: "relative" }}>
          <div className="badge badge-green" style={{ marginBottom: 16, fontSize: 12 }}>After AI Optimization</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <ScoreRing score={afterScore} color="#059669" trackColor="#D1FAE5" />
            <div>
              <div style={{ fontSize: 12, color: "var(--c-text3)" }}>ATS Score</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-accent2)" }}>Excellent</div>
              <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Top 5% Resume</div>
            </div>
            <span style={{ marginLeft: "auto", color: "var(--c-amber, #D97706)" }}><Icon.Award /></span>
          </div>
          <motion.div
            style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18, textAlign: "left" }}
            initial="hidden"
            animate={visible ? "show" : "hidden"}
            variants={staggerContainerVariants(0.1, 0.7)}
          >
            {improvements.map(item => (
              <motion.div key={item} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE_OUT } } }}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--c-text2)" }}>
                <span style={{ color: "var(--c-accent2)", flexShrink: 0 }}><Icon.Check size="3.5" /></span>
                {item}
              </motion.div>
            ))}
          </motion.div>
          <ResumeSnippet tone="after" />
        </RevealItem>
      </Reveal>

      <style>{`
        .ats-before-card { background: linear-gradient(180deg, rgba(220,38,38,0.04) 0%, transparent 40%); }
        .ats-process-card { background: linear-gradient(180deg, rgba(26,86,219,0.05) 0%, transparent 40%); }
        .ats-after-card { background: linear-gradient(180deg, rgba(5,150,105,0.05) 0%, transparent 40%); }
        .ats-connector-v { display: none; }
        @media (max-width: 1024px) {
          .ats-demo-grid { grid-template-columns: 1fr !important; }
          .ats-connector-h { display: none !important; }
          .ats-connector-v { display: flex !important; margin: 0 auto; }
        }
      `}</style>
    </section>
  );
}

// ─── FAQ SECTION ──────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
  { q: "Is it free?", a: "Yes. Every feature — unlimited resumes, all templates, AI suggestions, and PDF export — is completely free, no credit card required." },
  { q: "Are the templates ATS-friendly?", a: "Every template is built on a single-column, parser-safe layout so applicant tracking systems can read your name, dates, and bullets correctly." },
  { q: "Can AI write my resume for me?", a: "AI can generate a professional summary, rewrite weak bullet points into strong action-verb statements, and suggest keywords from a job description — you stay in control of every word." },
  { q: "Can I download my resume as a PDF?", a: "Yes. One click exports a pixel-perfect, print-ready PDF that matches exactly what you see in the live preview." },
  { q: "Can I create multiple resumes?", a: "Yes. You can create and save as many resumes and cover letters as you like, so you can tailor a version for every application." },
];

function FaqSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section style={{ padding: "80px 24px" }} aria-labelledby="faq-heading">
      <Reveal style={{ textAlign: "center", marginBottom: 40 }}>
        <h2 id="faq-heading" className="font-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, margin: "0 0 12px" }}>
          Frequently asked questions
        </h2>
        <p className="app-text2" style={{ fontSize: 17, maxWidth: 480, margin: "0 auto" }}>
          Everything you need to know before you get started.
        </p>
      </Reveal>
      <Reveal stagger={0.06} style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = openIndex === i;
          const panelId = `faq-panel-${i}`;
          const buttonId = `faq-button-${i}`;
          return (
            <RevealItem key={item.q} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <button
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? -1 : i)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 16, padding: "18px 22px", background: "transparent", border: "none", cursor: "pointer",
                  textAlign: "left", fontFamily: "var(--font-body)",
                }}
              >
                <span className="font-display" style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text)" }}>{item.q}</span>
                <motion.span
                  style={{ color: "var(--c-text3)", flexShrink: 0 }}
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                >
                  <Icon.ChevronDown />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: EASE_OUT }}
                    style={{ overflow: "hidden" }}
                  >
                    <p className="app-text2" style={{ margin: 0, padding: "0 22px 20px", fontSize: 14, lineHeight: 1.65 }}>
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </RevealItem>
          );
        })}
      </Reveal>
    </section>
  );
}

// ─── LAUNCH OFFER MODAL ─────────────────────────────────────────────────────────

const LAUNCH_OFFER_SEEN_KEY = "launchOfferSeen";

const LAUNCH_OFFER_BENEFITS = [
  "Premium ATS Resume Templates",
  "AI Resume Optimization",
  "ATS Score Checker",
  "Unlimited Resume Downloads",
  "Premium Features Included",
];

function LaunchOfferModal({ setPage }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem(LAUNCH_OFFER_SEEN_KEY) === "1"; } catch { seen = false; }
    if (!seen) {
      const t = setTimeout(() => setOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(LAUNCH_OFFER_SEEN_KEY, "1"); } catch {}
  };

  const claim = () => {
    dismiss();
    setPage(PAGES.REGISTER);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="launch-offer-title"
          onClick={dismiss}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            style={{
              position: "relative", width: "100%", maxWidth: 440,
              background: "#fff", borderRadius: 20, boxShadow: "0 24px 64px rgba(15, 23, 42, 0.35)",
              padding: "32px 28px 28px", maxHeight: "92vh", overflowY: "auto",
            }}
          >
            {/* Limited offer badge */}
            <div style={{
              position: "absolute", top: 16, right: 16,
              background: "#FEF3C7", color: "#B45309", fontSize: 11, fontWeight: 700,
              padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap",
            }}>
              🔥 Limited Launch Offer
            </div>

            {/* Close button */}
            <button
              onClick={dismiss}
              aria-label="Close"
              style={{
                position: "absolute", top: 16, left: 16, width: 28, height: 28, borderRadius: "50%",
                border: "none", background: "#F1F5F9", color: "#334155", fontSize: 16, lineHeight: 1,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ×
            </button>

            <div style={{ textAlign: "center", marginTop: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
              <h2 id="launch-offer-title" className="font-display" style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: "0 0 12px" }}>
                Welcome to ATS Resume Pilot!
              </h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#475569", margin: "0 0 20px" }}>
                As part of our launch celebration, Premium is automatically activated <strong>FREE</strong> for our first 1,000 users.
                Join now and enjoy every premium feature at no cost.
              </p>
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: 14, padding: "16px 18px", marginBottom: 22 }}>
              {LAUNCH_OFFER_BENEFITS.map((b) => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 14, color: "#1E293B" }}>
                  <span style={{ color: "#16A34A", flexShrink: 0, display: "flex" }}><Icon.Check size="3.5" /></span>
                  {b}
                </div>
              ))}
            </div>

            <button
              onClick={claim}
              className="launch-offer-cta"
              style={{
                width: "100%", border: "none", borderRadius: 12, padding: "13px 20px",
                fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer",
                background: "linear-gradient(135deg, #2563EB, #1E40AF)",
                boxShadow: "0 8px 20px rgba(37, 99, 235, 0.35)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              Claim Free Premium
            </button>

            <p style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", margin: "14px 0 0" }}>
              Offer valid for the first 1,000 registered users only.
            </p>

            <style>{`
              .launch-offer-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(37, 99, 235, 0.45); }
              .launch-offer-cta:active { transform: translateY(0); }
            `}</style>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── FEEDBACK MODAL ─────────────────────────────────────────────────────────────

const FEEDBACK_RATINGS = [
  { value: 1, label: "Very Poor" },
  { value: 2, label: "Poor" },
  { value: 3, label: "Good" },
  { value: 4, label: "Very Good" },
  { value: 5, label: "Excellent" },
];

function FeedbackModal({ open, onClose, user, docType }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) { setRating(0); setHoverRating(0); setSubmitting(false); setSubmitted(false); }
  }, [open]);

  const submit = async () => {
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      const ref = doc(collection(db, "feedback"));
      await setDoc(ref, {
        uid: user?.uid || null,
        email: user?.email || null,
        docType: docType || "resume",
        rating,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Non-critical — don't block the user's flow on a feedback-write failure.
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  const activeRating = hoverRating || rating;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            style={{
              position: "relative", width: "100%", maxWidth: 420,
              background: "#fff", borderRadius: 20, boxShadow: "0 24px 64px rgba(15, 23, 42, 0.35)",
              padding: "32px 28px 28px", textAlign: "center",
            }}
          >
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                position: "absolute", top: 16, right: 16, width: 28, height: 28, borderRadius: "50%",
                border: "none", background: "#F1F5F9", color: "#334155", fontSize: 16, lineHeight: 1,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ×
            </button>

            {submitted ? (
              <div style={{ padding: "12px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🙌</div>
                <h2 className="font-display" style={{ fontSize: 20, fontWeight: 800, color: "#0F172A", margin: "0 0 8px" }}>
                  Thanks for the feedback!
                </h2>
                <p style={{ fontSize: 14, color: "#475569", margin: 0 }}>
                  It helps us keep improving ATS Resume Pilot.
                </p>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🎉</div>
                <h2 id="feedback-title" className="font-display" style={{ fontSize: 20, fontWeight: 800, color: "#0F172A", margin: "0 0 8px" }}>
                  Thank you for using ATS Resume Pilot
                </h2>
                <p style={{ fontSize: 14.5, color: "#475569", margin: "0 0 20px" }}>
                  How would you rate the quality of your generated {docType === "cover letter" ? "cover letter" : "resume"}?
                </p>

                <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 10 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHoverRating(n)}
                      onMouseLeave={() => setHoverRating(0)}
                      aria-label={FEEDBACK_RATINGS[n - 1].label}
                      style={{
                        border: "none", background: "transparent", cursor: "pointer", padding: 2,
                        color: n <= activeRating ? "#F59E0B" : "#E2E8F0",
                        transition: "color 0.15s ease, transform 0.15s ease",
                        transform: n <= activeRating ? "scale(1.08)" : "scale(1)",
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 32, height: 32 }}>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    </button>
                  ))}
                </div>

                <div style={{ height: 20, marginBottom: 20 }}>
                  {activeRating > 0 && (
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#334155" }}>
                      {FEEDBACK_RATINGS[activeRating - 1].label}
                    </span>
                  )}
                </div>

                <button
                  onClick={submit}
                  disabled={!rating || submitting}
                  className="feedback-cta"
                  style={{
                    width: "100%", border: "none", borderRadius: 12, padding: "12px 20px",
                    fontSize: 15, fontWeight: 700, color: "#fff",
                    cursor: rating ? "pointer" : "not-allowed",
                    background: rating ? "linear-gradient(135deg, #2563EB, #1E40AF)" : "#CBD5E1",
                    boxShadow: rating ? "0 8px 20px rgba(37, 99, 235, 0.35)" : "none",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  }}
                >
                  {submitting ? "Submitting…" : "Submit Feedback"}
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────

const HOME_TEMPLATE_CAP = 12;

function HomePage({ setPage, user }) {
  const [homeFilter, setHomeFilter] = useState("all");
  const [homeDocType, setHomeDocType] = useState("resume");
  const [homeTemplatesExpanded, setHomeTemplatesExpanded] = useState(false);
  const features = [
    { icon: <Icon.Target />, title: "ATS Optimization", desc: "Real-time scoring against the ATS rules recruiters actually screen with", featured: true },
    { icon: <Icon.Sparkles />, title: "AI-Powered Writing", desc: "Generate professional summaries, rewrite bullets, and get keyword suggestions instantly", featured: true },
    { icon: <Icon.Eye />, title: "Live Preview", desc: "See exactly how your resume looks as you type — no refresh, no surprises" },
    { icon: <Icon.Download />, title: "One-Click Export", desc: "Download ATS-safe PDF or DOCX in seconds, print-ready and perfectly formatted" },
    { icon: <Icon.LayoutTemplate />, title: "Pro Templates", desc: "Dozens of recruiter-approved templates designed by HR professionals" },
    { icon: <Icon.TrendingUp />, title: "Job Match Score", desc: "Paste any job description and get an instant compatibility score with fix suggestions" },
  ];

  const reduceMotion = useReducedMotion();
  const heroRef = useRef(null);
  const { scrollYProgress: heroScrollProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroParallaxY = useTransform(heroScrollProgress, [0, 1], [0, reduceMotion ? 0 : 60]);

  return (
    <div className="app-bg">
      <LaunchOfferModal setPage={setPage} />
      {/* Hero */}
      <section ref={heroRef} className="hero-grad" style={{ padding: "72px 20px 40px", textAlign: "center" }}>
        <motion.div
          style={{ maxWidth: 760, margin: "0 auto" }}
          initial="hidden"
          animate="show"
          variants={staggerContainerVariants(0.12)}
        >
          <RevealItem className="badge badge-blue" style={{ marginBottom: 20, fontSize: 13, display: "inline-flex" }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-accent)", display: "inline-block" }}></span>
            AI-powered · ATS-optimized · Free to start
          </RevealItem>

          <motion.h1
            className="font-display" style={{ fontSize: "clamp(40px, 6vw, 72px)", fontWeight: 800, lineHeight: 1.1, margin: "0 0 20px" }}
            variants={{ hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } } }}
          >
            <span style={{ whiteSpace: "normal" }}>
              Create an{" "}
              <span className="free-badge" style={{
                display: "inline-block",
                background: "linear-gradient(135deg, #34D399 0%, #059669 50%, #047857 100%)",
                color: "#fff",
                fontSize: "clamp(22px, 3.4vw, 46px)",
                fontWeight: 400,
                padding: "1px 16px 4px",
                borderRadius: 12,
                lineHeight: 1.2,
                letterSpacing: "-0.03em",
                verticalAlign: "middle",
                transform: "rotate(-2deg)",
                position: "relative",
                border: "3px solid rgba(255,255,255,0.25)",
              }}>✦ ATS-Friendly</span>
              {" "}Resume
            </span><br />
            That Gets <span className="grad-text">Noticed</span>
          </motion.h1>

          <RevealItem as={motion.p} className="app-text2" style={{ fontSize: "clamp(16px, 2vw, 20px)", lineHeight: 1.6, margin: "0 0 36px" }}>
            Create a professional, ATS-friendly resume in under 5 minutes. Our AI helps you beat applicant tracking systems, impress recruiters, and land more interviews.
          </RevealItem>

          <RevealItem
            style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}
            variants={{ hidden: { opacity: 0, scale: 0.94 }, show: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } } }}
          >
            <motion.button className="btn btn-primary btn-xl" onClick={() => setPage(user ? PAGES.BUILDER : PAGES.REGISTER)}
              whileHover={reduceMotion ? undefined : { scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
              Build Your Resume — It's Free <Icon.ArrowRight />
            </motion.button>
            <motion.button className="btn btn-secondary btn-xl" onClick={() => setPage(PAGES.TEMPLATES)}
              whileHover={reduceMotion ? undefined : { scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
              View Templates <Icon.Eye />
            </motion.button>
          </RevealItem>

          <RevealItem as={motion.div} className="app-text2" style={{ marginTop: 20, fontSize: 13, fontWeight: 500 }}>
            ✓ No credit card required &nbsp;·&nbsp; ✓ Free to get started
          </RevealItem>
        </motion.div>

        {/* Hero Resume Card */}
        {/* ── Hero Mockup ── */}
        <motion.div
          className="hero-mockup"
          style={{ margin: "36px 24px 0", position: "relative", y: heroParallaxY }}
          initial={reduceMotion ? false : { opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.35, ease: EASE_OUT }}
        >
          <motion.div
            animate={reduceMotion ? undefined : { y: [0, -10, 0] }}
            transition={reduceMotion ? undefined : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
            style={{ willChange: "transform" }}
          >

          {/* Glow backdrop */}
          <div style={{
            position: "absolute", inset: "-40px -60px",
            background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(26,86,219,0.10) 0%, transparent 70%)",
            pointerEvents: "none", zIndex: 0,
          }} />

          {/* ── ATS PASSED hero banner — top center ── */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24, position: "relative", zIndex: 2 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
              border: "1.5px solid #6EE7B7",
              borderRadius: 999, padding: "10px 22px",
              boxShadow: "0 4px 24px rgba(5,150,105,0.18), 0 0 0 4px rgba(5,150,105,0.07)",
            }}>
              {/* Animated pulse ring */}
              <div style={{ position: "relative", width: 22, height: 22, flexShrink: 0 }}>
                <div style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  background: "rgba(5,150,105,0.2)",
                  animation: "ats-ring 1.6s ease-out infinite",
                }} />
                <div style={{
                  position: "absolute", inset: 4, borderRadius: "50%",
                  background: "#059669",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#065F46", letterSpacing: "-0.01em", fontFamily: "var(--font-display)" }}>
                ATS Passed
              </span>
              <div style={{ width: 1, height: 18, background: "#6EE7B7" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Score: 94/100</span>
              <div style={{
                background: "#059669", color: "#fff",
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
              }}>STRONG ↑</div>
            </div>
          </div>

          {/* ── Browser window ── */}
          <HeroBrowserWindow reduceMotion={reduceMotion} />

          {/* ── Floating accent chips ── */}
          {/* Match score — bottom left */}
          <div className="hero-chip" style={{
            position: "absolute", bottom: -20, left: 40,
            display: "flex", alignItems: "center", gap: 8,
            background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)",
            border: "1.5px solid #FDE68A",
            borderRadius: 999, padding: "9px 18px",
            boxShadow: "0 6px 20px rgba(217,119,6,0.2)",
            zIndex: 10,
          }}>
            <span style={{ fontSize: 16 }}>📈</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#92400E" }}>94% Match Score</div>
              <div style={{ fontSize: 10, color: "#B45309" }}>vs. Job Description</div>
            </div>
          </div>

          {/* Recruiter view — top right */}
          <div className="hero-chip" style={{
            position: "absolute", top: 60, right: -20,
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--c-surface)",
            border: "1.5px solid var(--c-border)",
            borderRadius: 999, padding: "8px 16px",
            boxShadow: "0 8px 28px var(--c-shadow)",
            zIndex: 10,
          }}>
            <div style={{ display: "flex", marginRight: 2 }}>
              {["#3B82F6","#8B5CF6","#EC4899"].map((c,i) => (
                <div key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: "2px solid #fff", marginLeft: i > 0 ? -7 : 0, fontSize: 9, display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700 }}>
                  {["R","H","T"][i]}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>3 recruiters viewed</div>
              <div style={{ fontSize: 10, color: "var(--c-text3)" }}>in the last 24h</div>
            </div>
          </div>

          {/* Extra ambient floating badges — small, glassy, subtle shadows, gentle
              floating loops. Each has its own float cycle (delay + duration) and a
              slight fixed rotation so they don't feel machine-made. */}
          <HeroFloatBadge className="hero-chip" reduceMotion={reduceMotion} delay={0.6} floatDelay={0.4} floatDuration={5.5} rotate={-4}
            style={{ top: "36%", left: -34 }}>
            <span style={{ fontSize: 14 }}>🤖</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>AI Writing</span>
          </HeroFloatBadge>

          <HeroFloatBadge className="hero-chip" reduceMotion={reduceMotion} delay={0.75} floatDelay={1.1} floatDuration={6.5} rotate={3}
            style={{ top: 110, right: -44 }}>
            <span style={{ fontSize: 14 }}>📈</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>Resume Score: 95/100</span>
          </HeroFloatBadge>

          <HeroFloatBadge className="hero-chip" reduceMotion={reduceMotion} delay={0.9} floatDelay={0.2} floatDuration={5.8} rotate={-2}
            style={{ top: -18, left: "58%" }}>
            <span style={{ fontSize: 14 }}>✅</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>Recruiter Approved</span>
          </HeroFloatBadge>

          <HeroFloatBadge className="hero-chip" reduceMotion={reduceMotion} delay={1.05} floatDelay={0.7} floatDuration={6.2} rotate={-3}
            style={{ top: "62%", left: -46 }}>
            <span style={{ fontSize: 14 }}>✨</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>AI Suggestions Applied</span>
          </HeroFloatBadge>

          </motion.div>
        </motion.div>

        <style>{`
          @keyframes ats-ring {
            0%   { transform: scale(1);   opacity: 0.6; }
            70%  { transform: scale(1.9); opacity: 0; }
            100% { transform: scale(1.9); opacity: 0; }
          }
        `}</style>
      </section>

      {/* Features */}
      <section style={{ padding: "80px 24px" }}>
        <Reveal style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, margin: "0 0 12px" }}>
            Everything you need to land the job
          </h2>
          <p className="app-text2" style={{ fontSize: 17, maxWidth: 500, margin: "0 auto" }}>
            Built for modern job seekers who want an unfair advantage.
          </p>
        </Reveal>
        <Reveal stagger={0.08} className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {features.map((f, i) => (
            <RevealItem key={i} className={`card card-hover shine feature-card${f.featured ? " feature-card-featured" : ""}`} style={{ padding: 24, position: "relative", transition: "transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease" }}
              whileHover={{ y: -8 }}>
              {f.featured && (
                <span className="feature-badge">Most Loved</span>
              )}
              <motion.div className="feature-icon" style={{
                width: 48, height: 48, borderRadius: 12,
                background: "linear-gradient(135deg, var(--c-accent-light) 0%, var(--c-accent-light) 100%)",
                color: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 16, fontSize: 20,
              }}>
                {f.icon}
              </motion.div>
              <h3 className="font-display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>{f.title}</h3>
              <p className="app-text2" style={{ fontSize: 14, margin: 0, lineHeight: 1.6 }}>{f.desc}</p>
            </RevealItem>
          ))}
        </Reveal>
        <style>{`
          .feature-card { overflow: hidden; }
          .feature-card:hover { border-color: var(--c-accent) !important; box-shadow: 0 12px 32px var(--c-shadow); }
          .feature-card:hover .feature-icon {
            transform: scale(1.1);
            background: linear-gradient(135deg, var(--c-accent) 0%, var(--c-accent2) 100%) !important;
            color: #fff !important;
            transition: transform 0.25s ease, background 0.25s ease, color 0.25s ease;
          }
          .feature-icon { transition: transform 0.25s ease, background 0.25s ease, color 0.25s ease; }
          .feature-card-featured { border-color: var(--c-accent) !important; box-shadow: 0 0 0 1px var(--c-accent-light); }
          .feature-badge {
            position: absolute; top: 0; right: 0;
            background: linear-gradient(135deg, var(--c-accent) 0%, var(--c-accent2) 100%);
            color: #fff; font-size: 10.5px; font-weight: 700;
            letter-spacing: 0.03em; text-transform: uppercase;
            padding: 5px 12px;
            border-bottom-left-radius: 10px;
          }
        `}</style>
      </section>

      {/* How It Works */}
      <section style={{ padding: "80px 24px", background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)", position: "relative" }}>
        <Reveal style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, margin: "0 0 12px" }}>
            Create your resume in 3 simple steps
          </h2>
          <p className="app-text2" style={{ fontSize: 17, maxWidth: 500, margin: "0 auto" }}>
            From blank page to interview-ready in minutes.
          </p>
        </Reveal>
        <Reveal stagger={0.15} className="how-it-works-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, maxWidth: 1000, margin: "0 auto", position: "relative" }}>
          <HowItWorksConnector />
          {[
            { n: "1", icon: <Icon.LayoutTemplate />, title: "Choose a template", desc: "Pick from dozens of recruiter-approved, ATS-safe designs built for every industry." },
            { n: "2", icon: <Icon.Sparkles />, title: "Let AI improve it", desc: "Generate summaries, rewrite bullets, and get keyword suggestions tailored to the job." },
            { n: "3", icon: <Icon.Download />, title: "Download & apply", desc: "Export a pixel-perfect, ATS-safe PDF and start sending applications immediately." },
          ].map((s, i) => (
            <RevealItem key={i} className="card card-hover" style={{ padding: 28, textAlign: "center", transition: "transform 0.2s ease, box-shadow 0.2s ease", position: "relative", zIndex: 1 }}
              whileHover={{ y: -8 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14, margin: "0 auto 18px",
                background: "linear-gradient(135deg, var(--c-accent), var(--c-accent2))",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, position: "relative",
              }}>
                {s.icon}
                <span style={{
                  position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: "50%",
                  background: "var(--c-surface)", border: "2px solid var(--c-accent)", color: "var(--c-accent)",
                  fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
                }}>{s.n}</span>
              </div>
              <h3 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>{s.title}</h3>
              <p className="app-text2" style={{ fontSize: 14, margin: 0, lineHeight: 1.6 }}>{s.desc}</p>
            </RevealItem>
          ))}
        </Reveal>
        <style>{`
          @media (min-width: 769px) { .how-it-works-connector { display: block !important; } }
          @media (max-width: 768px) { .how-it-works-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </section>

      {/* ATS Score Demo */}
      <AtsScoreDemo />

      {/* Templates showcase */}
      {(() => {
        const filters = ["all", "minimal", "modern", "corporate", "creative", "with photo"];
        const filtered = TEMPLATES.filter(t => {
          if (homeFilter === "all") return true;
          if (homeFilter === "minimal") return ["clarity","form","slate","pure","zen","mono"].includes(t.id);
          if (homeFilter === "modern") return ["apex","echo","edge","flow","nexus","vector"].includes(t.id);
          if (homeFilter === "corporate") return ["axiom","form","summit","prestige","atlas","charter"].includes(t.id);
          if (homeFilter === "creative") return ["nova","axiom","spark","bloom","crimson","halo"].includes(t.id);
          if (homeFilter === "with photo") return t.photo === true;
          return true;
        });
        const isCapped = homeFilter === "all" && !homeTemplatesExpanded && filtered.length > HOME_TEMPLATE_CAP;
        const visibleTemplates = isCapped ? filtered.slice(0, HOME_TEMPLATE_CAP) : filtered;
        return (
      <section style={{ padding: "90px 24px", borderTop: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.1 }}>
              Pick your perfect template
            </h2>
            <p className="app-text2" style={{ fontSize: 16, maxWidth: 480, margin: "0 auto 24px" }}>
              ATS-optimized, recruiter-approved, and fully customizable.
            </p>

            {/* Resume / Cover Letter tabs */}
            <div style={{ display: "inline-flex", background: "var(--c-surface)", border: "1.5px solid var(--c-border)", borderRadius: 12, padding: 4, gap: 4, marginBottom: 20 }}>
              {[
                { id: "resume", label: "Resume", icon: <Icon.FileText size="16" /> },
                { id: "coverletter", label: "Cover Letter", icon: <Icon.FileText size="16" /> },
              ].map(({ id, label, icon }) => (
                <button key={id} onClick={() => { setHomeDocType(id); setHomeFilter("all"); setHomeTemplatesExpanded(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "8px 20px",
                    borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "var(--font-body)",
                    fontSize: 14, fontWeight: 700, transition: "all 0.18s",
                    background: homeDocType === id ? "var(--c-accent)" : "transparent",
                    color: homeDocType === id ? "#fff" : "var(--c-text2)",
                    boxShadow: homeDocType === id ? "0 2px 8px rgba(26,86,219,0.25)" : "none",
                  }}>
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* Style filters — resume only */}
            {homeDocType === "resume" && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
                {filters.map(f => (
                  <button key={f} onClick={() => { setHomeFilter(f); setHomeTemplatesExpanded(false); }}
                    style={{ padding: "8px 20px", borderRadius: 99, border: homeFilter === f ? "none" : "1.5px solid var(--c-border)", background: homeFilter === f ? "var(--c-accent)" : "var(--c-surface)", color: homeFilter === f ? "#fff" : "var(--c-text2)", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 0.15s", textTransform: "capitalize" }}>
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            )}

            <div style={{ marginTop: homeDocType === "coverletter" ? 16 : 0 }}>
              {homeDocType === "resume"
                ? <div className="badge badge-blue" style={{ fontSize: 12 }}><Icon.LayoutTemplate /> {TEMPLATES.length} professional templates</div>
                : <div className="badge badge-blue" style={{ fontSize: 12 }}>{COVER_LETTER_TEMPLATES.length} cover letter templates</div>
              }
            </div>
          </div>

          {/* Cover letter template grid */}
          {homeDocType === "coverletter" && (
            <Reveal stagger={0.05} amount={0.05} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20, marginBottom: 48 }}>
              {COVER_LETTER_TEMPLATES.map(t => {
                const Preview = t.preview;
                return (
                  <RevealItem key={t.id} className="landing-template-card" onClick={() => setPage(user ? PAGES.COVER_LETTER : PAGES.REGISTER)}
                    whileHover={{ scale: 1.02 }} transition={{ duration: 0.25, ease: EASE_OUT }}
                    style={{ borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "2px solid var(--c-border)", boxShadow: "0 2px 8px var(--c-shadow)" }}>
                    <div className="landing-template-card-media" style={{ height: 300, overflow: "hidden", position: "relative" }}>
                      <div className="landing-template-card-preview" style={{ height: "100%", transition: "transform 0.3s ease" }}>
                        <Preview />
                      </div>
                      <div className="landing-template-card-overlay" style={{ position: "absolute", inset: 0, background: "rgba(15,14,12,0.28)", opacity: 0, transition: "opacity 0.25s ease", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ background: "#fff", color: "var(--c-text)", fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 99, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>Preview</span>
                      </div>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(transparent, #ffffff)", pointerEvents: "none" }} />
                    </div>
                    <div style={{ padding: "12px 14px", background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div className="font-display" style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t.name}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span className="badge badge-green" style={{ fontSize: 10 }}>ATS ✓</span>
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>{t.tag}</span>
                        </div>
                      </div>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />
                    </div>
                  </RevealItem>
                );
              })}
            </Reveal>
          )}

          {/* Resume template grid */}
          {homeDocType === "resume" && (
            <Reveal key={`${homeDocType}-${homeFilter}-${homeTemplatesExpanded}`} stagger={0.05} amount={0.05} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
              {visibleTemplates.map((t) => {
                const MiniPreview = MINI_PREVIEWS[t.id];
                return (
                  <RevealItem key={t.id} className="landing-template-card" onClick={() => { setPage(user ? PAGES.BUILDER : PAGES.REGISTER); }}
                    whileHover={{ scale: 1.02 }} transition={{ duration: 0.25, ease: EASE_OUT }}
                    style={{ borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "2px solid var(--c-border)", boxShadow: "0 2px 8px var(--c-shadow)", position: "relative" }}>
                    <div className="landing-template-card-media" style={{ height: 300, overflow: "hidden", position: "relative" }}>
                      <div className="landing-template-card-preview" style={{ height: "100%", transition: "transform 0.3s ease" }}>
                        {MiniPreview && (t.photo ? <MiniPreview photo={DUMMY_AVATAR} /> : <MiniPreview />)}
                      </div>
                      <div className="landing-template-card-overlay" style={{ position: "absolute", inset: 0, background: "rgba(15,14,12,0.28)", opacity: 0, transition: "opacity 0.25s ease", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ background: "#fff", color: "var(--c-text)", fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 99, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>Preview</span>
                      </div>
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: `linear-gradient(transparent, ${t.bg === "#0F172A" || t.bg === "#0F0F0F" || t.bg === "#0A0A0A" || t.bg === "#0C0C0C" || t.bg === "#0F0F23" || t.bg === "#0C0A09" ? "#0F172A" : "#ffffff"})`, pointerEvents: "none" }} />
                    </div>
                    <div style={{ padding: "12px 14px", background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div className="font-display" style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t.name}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span className="badge badge-green" style={{ fontSize: 10 }}>ATS ✓</span>
                          {t.photo
                            ? <span style={{ background: "#FDF4FF", color: "#9333EA", border: "1px solid #E9D5FF", fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>📸 Photo</span>
                            : <span className="badge badge-gray" style={{ fontSize: 10 }}>{t.tag}</span>}
                        </div>
                      </div>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />
                    </div>
                  </RevealItem>
                );
              })}
            </Reveal>
          )}
          <style>{`
            .landing-template-card:hover { box-shadow: 0 12px 32px var(--c-shadow), 0 0 0 1px rgba(26,86,219,0.12) !important; }
            .landing-template-card:hover .landing-template-card-preview { transform: translateY(-6px); }
            .landing-template-card:hover .landing-template-card-overlay { opacity: 1 !important; }
          `}</style>

          {homeDocType === "resume" && homeFilter === "all" && filtered.length > HOME_TEMPLATE_CAP && (
            <div style={{ textAlign: "center", marginTop: 32 }}>
              <motion.button
                className="btn btn-secondary"
                onClick={() => setHomeTemplatesExpanded(v => !v)}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} transition={{ duration: 0.15 }}
              >
                {homeTemplatesExpanded
                  ? <>Show Less <motion.span animate={{ rotate: 180 }} style={{ display: "inline-flex" }}><Icon.ChevronDown /></motion.span></>
                  : <>View All {filtered.length} Templates <Icon.ChevronDown /></>}
              </motion.button>
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 32 }}>
            <button className="btn btn-primary btn-lg" onClick={() => setPage(user ? PAGES.BUILDER : PAGES.REGISTER)} style={{ marginRight: 12 }}>
              <Icon.Sparkles /> Start Building Free
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => setPage(PAGES.TEMPLATES)}>
              Browse Full Template Library <Icon.ArrowRight />
            </button>
          </div>
        </div>
      </section>
        );
      })()}

      {/* FAQ */}
      <FaqSection />

      {/* CTA */}
      <Reveal as={motion.section} className="cta-gradient-bg" style={{
        padding: "72px 20px", textAlign: "center", color: "#fff",
        backgroundSize: "200% 200%",
      }}>
        <h2 className="font-display" style={{ fontSize: "clamp(26px, 4vw, 44px)", fontWeight: 800, margin: "0 0 12px" }}>
          Your next interview starts here
        </h2>
        <p style={{ fontSize: 17, opacity: 0.85, margin: "0 0 28px", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
          Create a recruiter-approved resume in minutes using AI.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <motion.button className="btn btn-xl cta-glow-btn" onClick={() => setPage(user ? PAGES.BUILDER : PAGES.REGISTER)}
            whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}
            style={{ background: "#fff", color: "var(--c-accent)", fontWeight: 700 }}>
            Create My Resume Free <Icon.ArrowRight />
          </motion.button>
          <motion.button className="btn btn-xl btn-secondary cta-glow-btn" onClick={() => setPage(PAGES.TEMPLATES)}
            whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}>
            Browse Templates
          </motion.button>
        </div>
        <style>{`
          .cta-gradient-bg {
            background: linear-gradient(135deg, var(--c-accent) 0%, #1E3A8A 50%, #312E81 100%, var(--c-accent) 100%);
            animation: ctaGradientShift 10s ease infinite;
          }
          @media (prefers-reduced-motion: reduce) { .cta-gradient-bg { animation: none; } }
          @keyframes ctaGradientShift {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }
          .cta-glow-btn:hover { box-shadow: 0 0 24px rgba(255,255,255,0.35); }
        `}</style>
      </Reveal>

      {/* Footer */}
      <footer className="app-surface" style={{ borderTop: "1px solid var(--c-border)", padding: "56px 24px 28px" }}>
        <Reveal stagger={0.08} className="footer-grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 32, maxWidth: 1100, margin: "0 auto 40px" }}>
          {/* Brand column */}
          <RevealItem>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <img src="/logo.svg" alt="ATS Resume Pilot" style={{ height: 50, width: "auto", display: "block" }} />
            </div>
            <p className="app-text3" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 220, margin: "0 0 16px" }}>
              AI-powered, ATS-optimized resumes that help you land more interviews.
            </p>
          </RevealItem>

          {/* Product */}
          <RevealItem as={motion.nav} aria-label="Product">
            <div className="app-text3" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>Product</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setPage(PAGES.TEMPLATES); }} className="footer-link footer-anim-link app-text2" style={{ fontSize: 14, textDecoration: "none" }}>Templates</a>
              <a href="#" onClick={(e) => { e.preventDefault(); setPage(user ? PAGES.COVER_LETTER : PAGES.REGISTER); }} className="footer-link footer-anim-link app-text2" style={{ fontSize: 14, textDecoration: "none" }}>Cover Letters</a>
            </div>
          </RevealItem>

          {/* Resources — hidden until Blog/Career Tips/ATS Guide pages exist */}

          {/* Company */}
          <RevealItem as={motion.nav} aria-label="Company">
            <div className="app-text3" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>Company</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setPage(PAGES.ABOUT); }} className="footer-link footer-anim-link app-text2" style={{ fontSize: 14, textDecoration: "none" }}>About</a>
              <a href="#" onClick={(e) => { e.preventDefault(); setPage(PAGES.CONTACT); }} className="footer-link footer-anim-link app-text2" style={{ fontSize: 14, textDecoration: "none" }}>Contact</a>
              <a href="#" onClick={(e) => { e.preventDefault(); setPage(PAGES.PRIVACY); }} className="footer-link footer-anim-link app-text2" style={{ fontSize: 14, textDecoration: "none" }}>Privacy Policy</a>
              <a href="#" onClick={(e) => { e.preventDefault(); setPage(PAGES.TERMS); }} className="footer-link footer-anim-link app-text2" style={{ fontSize: 14, textDecoration: "none" }}>Terms</a>
            </div>
          </RevealItem>
        </Reveal>

        <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 20, maxWidth: 1100, margin: "0 auto" }}>
          <div className="app-text3" style={{ fontSize: 13, textAlign: "center" }}>© {new Date().getFullYear()} ATS Resume Pilot. Made with ♥ for job seekers everywhere.</div>
        </div>
        <style>{`
          .footer-link:hover { color: var(--c-accent) !important; }
          @media (max-width: 768px) { .footer-grid { grid-template-columns: 1fr 1fr !important; } }
          @media (max-width: 480px) { .footer-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </footer>
    </div>
  );
}

// ─── LEGAL PAGES ────────────────────────────────────────────────────────────────

function LegalPageShell({ title, updated, setPage, children }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.HOME)} style={{ marginBottom: 24 }}>
          ← Back to home
        </button>
        <h1 className="font-display" style={{ fontSize: 32, fontWeight: 800, margin: "0 0 8px" }}>{title}</h1>
        <p className="app-text3" style={{ fontSize: 13, margin: "0 0 32px" }}>Last updated: {updated}</p>
        <div className="app-text2" style={{ fontSize: 15, lineHeight: 1.75 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function LegalH2({ children }) {
  return <h2 className="font-display" style={{ fontSize: 19, fontWeight: 700, margin: "28px 0 10px" }}>{children}</h2>;
}
function LegalP({ children }) {
  return <p style={{ margin: "0 0 14px" }}>{children}</p>;
}
function LegalUl({ items }) {
  return (
    <ul style={{ margin: "0 0 14px", paddingLeft: 22 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
    </ul>
  );
}

function PrivacyPage({ setPage }) {
  return (
    <LegalPageShell title="Privacy Policy" updated="July 15, 2026" setPage={setPage}>
      <LegalP>
        ATS Resume Pilot ("we", "our") builds the resumes and cover letters you create using this app. This
        page explains what data we collect, why, and how it's protected.
      </LegalP>

      <LegalH2>What we collect</LegalH2>
      <LegalUl items={[
        "Account info: your name, email address, and (if you sign in with Google) your profile photo — handled by Firebase Authentication.",
        "Resume & cover letter content: whatever you enter into the builder — work history, education, skills, contact details, and any text you generate with the AI tools.",
        "Uploaded files: if you use \"Import from existing CV,\" the file you upload is sent to our AI provider to extract text and is not stored by us afterward.",
      ]} />

      <LegalH2>How we use it</LegalH2>
      <LegalP>
        Your resume and cover letter data is stored so you can come back and keep editing it — that's
        the entire purpose of collecting it. We don't sell your data, and we don't use your resume
        content to train AI models.
      </LegalP>
      <LegalP>
        When you use an AI feature (generating a summary, rewriting a bullet, importing a CV, matching
        against a job description), the relevant text is sent to Anthropic's Claude API to produce the
        result. That request happens through our own server, not directly from your browser.
      </LegalP>

      <LegalH2>Where it's stored</LegalH2>
      <LegalP>
        Account data and resume/cover letter content are stored in Google Firebase (Authentication and
        Firestore). Access is restricted by security rules so that only you — authenticated as your
        account — can read or write your own data. No one else, including other signed-in users, can
        access it.
      </LegalP>

      <LegalH2>Third parties</LegalH2>
      <LegalUl items={[
        "Firebase (Google) — authentication and data storage.",
        "Anthropic — processes text you submit to AI-powered features.",
        "Vercel — hosts the application.",
      ]} />

      <LegalH2>Your choices</LegalH2>
      <LegalP>
        You can edit or delete your resume and cover letter content at any time from within the app.
        To delete your account entirely, contact us using the details below and we'll remove your
        account and associated data.
      </LegalP>

      <LegalH2>Contact</LegalH2>
      <LegalP>
        Questions about this policy or your data? Reach out at{" "}
        <a href="mailto:support@atsresumepilot.com" style={{ color: "var(--c-accent)" }}>support@atsresumepilot.com</a>.
      </LegalP>
    </LegalPageShell>
  );
}

function TermsPage({ setPage }) {
  return (
    <LegalPageShell title="Terms of Service" updated="July 15, 2026" setPage={setPage}>
      <LegalP>
        These terms govern your use of ATS Resume Pilot. By creating an account, you agree to them.
      </LegalP>

      <LegalH2>The service</LegalH2>
      <LegalP>
        ATS Resume Pilot lets you build, edit, and export resumes and cover letters, with optional AI-assisted
        writing tools. All features are currently free to use.
      </LegalP>

      <LegalH2>Your account</LegalH2>
      <LegalP>
        You're responsible for the accuracy of the information you enter and for keeping your account
        credentials secure. You must be old enough to legally enter into these terms in your
        jurisdiction to create an account.
      </LegalP>

      <LegalH2>Your content</LegalH2>
      <LegalP>
        You own the resumes, cover letters, and other content you create. We don't claim any
        ownership over it, and we don't use it for anything other than providing the service back to
        you — including AI features, which process your content only to generate the output you
        requested.
      </LegalP>

      <LegalH2>AI-generated content</LegalH2>
      <LegalP>
        Text generated by the AI writing tools is a starting point, not a guarantee. You're
        responsible for reviewing and verifying anything you include in a resume, cover letter, or
        application before sending it to an employer.
      </LegalP>

      <LegalH2>Acceptable use</LegalH2>
      <LegalP>
        Don't use the service to create fraudulent documents (e.g. fake credentials or employment
        history intended to deceive an employer), to abuse the AI features (e.g. attempting to extract
        or misuse the underlying system), or to interfere with the service's normal operation.
      </LegalP>

      <LegalH2>Availability</LegalH2>
      <LegalP>
        We aim to keep the service available and your data intact, but we don't guarantee
        uninterrupted access. Back up anything critical by exporting it (PDF/DOCX) outside the app.
      </LegalP>

      <LegalH2>Changes</LegalH2>
      <LegalP>
        We may update these terms as the product evolves. Continued use of the service after a change
        means you accept the update.
      </LegalP>

      <LegalH2>Contact</LegalH2>
      <LegalP>
        Questions about these terms? Reach out at{" "}
        <a href="mailto:support@atsresumepilot.com" style={{ color: "var(--c-accent)" }}>support@atsresumepilot.com</a>.
      </LegalP>
    </LegalPageShell>
  );
}

// ─── ABOUT PAGE ─────────────────────────────────────────────────────────────────

function AboutPage({ setPage, user }) {
  const values = [
    {
      icon: "🎯",
      title: "Built to pass the bots",
      body: "Applicant tracking systems reject well-qualified candidates over formatting alone. Every template we ship is built to parse cleanly, so your experience gets in front of a human.",
    },
    {
      icon: "⚡",
      title: "AI that saves time, not replaces judgment",
      body: "Our AI tools draft summaries, tighten bullet points, and match your resume against a job description — but you stay in control of every word that goes out.",
    },
    {
      icon: "🌱",
      title: "Still early, still improving",
      body: "ATS Resume Pilot is in beta. We're actively shipping based on what people tell us they need — if something's missing or broken, we want to hear about it.",
    },
  ];

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.HOME)} style={{ marginBottom: 24 }}>
          ← Back to home
        </button>

        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <motion.div
            style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#fff", fontSize: 22 }}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
          >
            👋
          </motion.div>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 800, margin: "0 0 8px" }}>
            About ATS Resume Pilot
          </h1>
          <p className="app-text2" style={{ fontSize: 15, margin: 0, maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
            We're building the fastest way to go from blank page to an ATS-safe, genuinely good resume.
          </p>
        </div>

        <div className="app-text2" style={{ fontSize: 15, lineHeight: 1.75, marginBottom: 40 }}>
          <p style={{ margin: "0 0 14px" }}>
            Job hunting is stressful enough without fighting your own resume. Most applicant tracking
            systems can't reliably read the fancy two-column templates and graphics that "modern" resume
            builders love to push — so a strong candidate gets filtered out before a person ever sees
            their application.
          </p>
          <p style={{ margin: 0 }}>
            ATS Resume Pilot exists to fix that: clean, ATS-safe templates, AI help where it actually
            saves you time, and a builder that gets out of your way so you can focus on telling your
            story well.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 40 }}>
          {values.map(v => (
            <div key={v.title} style={{ display: "flex", gap: 16, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 24, flexShrink: 0 }}>{v.icon}</div>
              <div>
                <h2 className="font-display" style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{v.title}</h2>
                <p className="app-text2" style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{v.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, padding: "32px 24px" }}>
          <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Have thoughts or feedback?</h2>
          <p className="app-text2" style={{ fontSize: 14, margin: "0 0 18px" }}>
            We read everything that comes in — good, bad, or "you should really add this feature."
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setPage(PAGES.CONTACT)}>Get in touch</button>
        </div>
      </div>
    </div>
  );
}

// ─── CONTACT PAGE ───────────────────────────────────────────────────────────────

function ContactPage({ setPage, user }) {
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", subject: "", message: "" });
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError("Please fill in your name, email, and message.");
      return;
    }
    setError("");
    const subject = encodeURIComponent(form.subject.trim() || "Message from ATS Resume Pilot contact form");
    const body = encodeURIComponent(
      `${form.message}\n\n—\n${form.name}\n${form.email}`
    );
    window.location.href = `mailto:support@atsresumepilot.com?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px 80px" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.HOME)} style={{ marginBottom: 24 }}>
          ← Back to home
        </button>

        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <motion.div
            style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#fff", fontSize: 22 }}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
          >
            ✉️
          </motion.div>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 800, margin: "0 0 8px" }}>
            Contact us
          </h1>
          <p className="app-text2" style={{ fontSize: 15, margin: 0 }}>
            Questions, feedback, or need a hand? We'd love to hear from you.
          </p>
        </div>

        {sent ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ textAlign: "center", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, padding: "36px 24px" }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <h2 className="font-display" style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Thanks — your message is ready to send!</h2>
            <p className="app-text2" style={{ fontSize: 14, margin: "0 0 20px" }}>
              We opened your email app with everything filled in. Just hit send and we'll get back to you soon.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={() => setSent(false)}>Send another message</button>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, padding: 28 }}>
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#DC2626" }}>{error}</div>
                </motion.div>
              )}
            </AnimatePresence>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label className="label">Name</label>
                <input className="input" placeholder="Alex Morgan" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="label">Subject</label>
              <input className="input" placeholder="How can we help?" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label className="label">Message</label>
              <textarea className="input" placeholder="Tell us what's on your mind…" rows={6} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
            </div>

            <motion.button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "11px", fontSize: 15, fontWeight: 600 }}
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} transition={{ duration: 0.15 }}>
              Send message
            </motion.button>

            <p className="app-text3" style={{ fontSize: 12.5, textAlign: "center", margin: "16px 0 0" }}>
              Or email us directly at{" "}
              <a href="mailto:support@atsresumepilot.com" style={{ color: "var(--c-accent)" }}>support@atsresumepilot.com</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── ADMIN FEEDBACK PAGE ────────────────────────────────────────────────────────

function AdminFeedbackPage({ setPage, user }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "feedback"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        setError("Couldn't load feedback. " + (err?.message || ""));
        setItems([]);
      }
    })();
  }, []);

  if (!ADMIN_EMAILS.includes(user?.email)) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <div>
          <h1 className="font-display" style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>Not authorized</h1>
          <p className="app-text2" style={{ fontSize: 14, margin: "0 0 20px" }}>This page is only available to admins.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setPage(PAGES.HOME)}>Back to home</button>
        </div>
      </div>
    );
  }

  const avg = items?.length ? (items.reduce((s, f) => s + (f.rating || 0), 0) / items.length) : 0;
  const counts = [1, 2, 3, 4, 5].map(n => items?.filter(f => f.rating === n).length || 0);

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px 80px" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.HOME)} style={{ marginBottom: 24 }}>
          ← Back to home
        </button>

        <h1 className="font-display" style={{ fontSize: 28, fontWeight: 800, margin: "0 0 24px" }}>
          User Feedback
        </h1>

        {items === null ? (
          <p className="app-text2" style={{ fontSize: 14 }}>Loading…</p>
        ) : error ? (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#DC2626" }}>{error}</div>
        ) : items.length === 0 ? (
          <p className="app-text2" style={{ fontSize: 14 }}>No feedback submitted yet.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "center", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 14, padding: 24, marginBottom: 28 }}>
              <div style={{ textAlign: "center" }}>
                <div className="font-display" style={{ fontSize: 40, fontWeight: 800, color: "#F59E0B", lineHeight: 1 }}>{avg.toFixed(1)}</div>
                <div className="app-text3" style={{ fontSize: 12 }}>{items.length} response{items.length === 1 ? "" : "s"}</div>
              </div>
              <div>
                {[5, 4, 3, 2, 1].map(n => {
                  const c = counts[n - 1];
                  const pct = items.length ? Math.round((c / items.length) * 100) : 0;
                  return (
                    <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, width: 14 }}>{n}</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--c-border)", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "#F59E0B" }} />
                      </div>
                      <span className="app-text3" style={{ fontSize: 12, width: 28, textAlign: "right" }}>{c}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map(f => (
                <div key={f.id} style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ color: "#F59E0B", display: "flex", flexShrink: 0 }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <svg key={n} viewBox="0 0 24 24" fill={n <= f.rating ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" style={{ width: 16, height: 16 }}>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.email || "Anonymous"}</div>
                    <div className="app-text3" style={{ fontSize: 12 }}>{f.docType === "cover letter" ? "Cover letter" : "Resume"}</div>
                  </div>
                  <div className="app-text3" style={{ fontSize: 12, flexShrink: 0 }}>
                    {f.createdAt ? new Date(f.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────

function AuthPage({ mode, setPage, setUser, dark, setDark }) {
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("form"); // "form" | "forgot" | "sent"
  const [resetEmail, setResetEmail] = useState("");
  const isLogin = mode === "login";

  const friendlyAuthError = (err) => {
    switch (err?.code) {
      case "auth/invalid-email": return "Enter a valid email address";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential": return "Incorrect email or password";
      case "auth/email-already-in-use": return "An account with this email already exists";
      case "auth/weak-password": return "Password must be at least 6 characters";
      case "auth/too-many-requests": return "Too many attempts. Please try again later";
      case "auth/popup-closed-by-user": return "Sign-in was cancelled";
      default: return "Something went wrong. Please try again.";
    }
  };

  const handle = async () => {
    if (!form.email || !form.password || (!isLogin && !form.name)) {
      setError("Please fill in all fields"); return;
    }
    setLoading(true); setError("");
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, form.email, form.password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await updateProfile(cred.user, { displayName: form.name });
        // updateProfile doesn't re-fire onAuthStateChanged, so push the name
        // into app state directly rather than waiting on a listener that
        // already ran (with a null displayName) right after account creation.
        setUser(prev => ({ ...prev, name: form.name }));
        trackEvent("sign_up", { method: "email" });
      }
      setPage(PAGES.DASHBOARD);
    } catch (err) {
      setError(friendlyAuthError(err));
    }
    setLoading(false);
  };

  const handleResetRequest = async () => {
    if (!resetEmail || !resetEmail.includes("@")) {
      setError("Enter a valid email address"); return;
    }
    setLoading(true); setError("");
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setView("sent");
    } catch (err) {
      setError(friendlyAuthError(err));
    }
    setLoading(false);
  };

  const googleAuth = async () => {
    setLoading(true); setError("");
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      if (getAdditionalUserInfo(cred)?.isNewUser) trackEvent("sign_up", { method: "google" });
      setPage(PAGES.DASHBOARD);
    } catch (err) {
      setError(friendlyAuthError(err));
    }
    setLoading(false);
  };

  const reduceMotion = useReducedMotion();

  return (
    <div className="auth-split" style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      {/* Left — form */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20, position: "relative" }}>
        <div style={{ position: "absolute", top: 20, left: 20, right: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <motion.button
            className="btn btn-ghost btn-sm auth-home-link"
            onClick={() => setPage(PAGES.HOME)}
            whileHover={{ x: -2 }}
          >
            ← Back to home
          </motion.button>
          {setDark && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Icon.Sun /> : <Icon.Moon />}
            </button>
          )}
        </div>

        <div className="card fade-in" style={{ width: "100%", maxWidth: 420, padding: 36, boxShadow: "none", border: "none", overflow: "hidden" }}>
          <AnimatePresence mode="wait">
            {view === "form" && (
              <motion.div
                key="form"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
              >
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                  <motion.div
                    style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#fff" }}
                    initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
                  >
                    <Icon.FileText />
                  </motion.div>
                  <h1 className="font-display" style={{ fontSize: 26, fontWeight: 800, margin: "0 0 6px" }}>
                    {isLogin ? "Welcome back" : "Create account"}
                  </h1>
                  <p className="app-text2" style={{ fontSize: 14, margin: 0 }}>
                    {isLogin ? "Sign in to your ATS Resume Pilot account" : "Start building ATS-optimized resumes"}
                  </p>
                </div>

                {/* Google */}
                <button onClick={googleAuth} disabled={loading} className="btn btn-secondary auth-google-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 16, padding: "11px", fontSize: 14 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  {loading ? "Signing in…" : "Continue with Google"}
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div className="divider" style={{ flex: 1 }} />
                  <span className="app-text3" style={{ fontSize: 12 }}>or</span>
                  <div className="divider" style={{ flex: 1 }} />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                      animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#DC2626" }}>{error}</div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!isLogin && (
                  <div style={{ marginBottom: 12 }}>
                    <label className="label">Full name</label>
                    <input className="input" placeholder="Alex Morgan" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label className="label">Password</label>
                  <input className="input" type="password" placeholder="••••••••" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} onKeyDown={e => e.key === "Enter" && handle()} />
                  {isLogin && (
                    <div style={{ textAlign: "right", marginTop: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: "2px 4px", fontSize: 13, fontWeight: 600, color: "var(--c-accent)" }}
                        onClick={() => { setResetEmail(form.email); setError(""); setView("forgot"); }}
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}
                </div>

                <motion.button onClick={handle} disabled={loading} className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "11px", fontSize: 15, fontWeight: 600 }}
                  whileHover={reduceMotion ? undefined : { scale: 1.01 }} whileTap={{ scale: 0.98 }} transition={{ duration: 0.15 }}>
                  {loading ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
                </motion.button>

                <div style={{ textAlign: "center", marginTop: 20, fontSize: 14 }} className="app-text2">
                  {isLogin ? "Don't have an account? " : "Already have an account? "}
                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 4px", color: "var(--c-accent)", fontWeight: 600 }}
                    onClick={() => setPage(isLogin ? PAGES.REGISTER : PAGES.LOGIN)}>
                    {isLogin ? "Sign up free" : "Sign in"}
                  </button>
                </div>
              </motion.div>
            )}

            {view === "forgot" && (
              <motion.div
                key="forgot"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
              >
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                  <motion.div
                    style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, var(--c-accent) 0%, #8B5CF6 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#fff" }}
                    initial={reduceMotion ? false : { scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
                  >
                    <Icon.Shield />
                  </motion.div>
                  <h1 className="font-display" style={{ fontSize: 26, fontWeight: 800, margin: "0 0 6px" }}>
                    Reset your password
                  </h1>
                  <p className="app-text2" style={{ fontSize: 14, margin: 0 }}>
                    Enter your email and we'll send you a reset link
                  </p>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                      animate={{ opacity: 1, height: "auto", marginBottom: 12 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#DC2626" }}>{error}</div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div style={{ marginBottom: 20 }}>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="you@example.com" value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleResetRequest()} />
                </div>

                <motion.button onClick={handleResetRequest} disabled={loading} className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "11px", fontSize: 15, fontWeight: 600 }}
                  whileHover={reduceMotion ? undefined : { scale: 1.01 }} whileTap={{ scale: 0.98 }} transition={{ duration: 0.15 }}>
                  {loading ? "Sending…" : "Send reset link"}
                </motion.button>

                <div style={{ textAlign: "center", marginTop: 20, fontSize: 14 }} className="app-text2">
                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 4px", color: "var(--c-accent)", fontWeight: 600 }}
                    onClick={() => { setError(""); setView("form"); }}>
                    ← Back to sign in
                  </button>
                </div>
              </motion.div>
            )}

            {view === "sent" && (
              <motion.div
                key="sent"
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
                style={{ textAlign: "center" }}
              >
                <motion.div
                  style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--c-accent2-light)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "var(--c-accent2)" }}
                  initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
                >
                  <Icon.Check size="6" />
                </motion.div>
                <h1 className="font-display" style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>
                  Check your email
                </h1>
                <p className="app-text2" style={{ fontSize: 14, margin: "0 0 28px", lineHeight: 1.6 }}>
                  We've sent a password reset link to <strong style={{ color: "var(--c-text)" }}>{resetEmail}</strong>. It may take a minute to arrive.
                </p>
                <button className="btn btn-secondary" style={{ width: "100%", justifyContent: "center", padding: "11px", fontSize: 14 }}
                  onClick={() => { setError(""); setView("form"); }}>
                  ← Back to sign in
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right — product showcase */}
      <div className="auth-showcase hero-grad" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 40 }}>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 380, textAlign: "center" }}>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT }}
            style={{ position: "relative" }}
          >
            {/* Mini resume card */}
            <div style={{
              background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 16,
              padding: 22, textAlign: "left", boxShadow: "0 24px 60px var(--c-shadow)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#EF4444" }} />
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#F59E0B" }} />
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#10B981" }} />
                </div>
                <span className="badge badge-green" style={{ fontSize: 10 }}>ATS Optimized</span>
              </div>
              <div className="font-display" style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>Alex Morgan</div>
              <div className="app-text3" style={{ fontSize: 12, marginBottom: 14 }}>Senior Software Engineer</div>
              {[92, 78, 88].map((w, i) => (
                <div key={i} style={{ height: 7, borderRadius: 4, background: "var(--c-border)", marginBottom: 8, overflow: "hidden" }}>
                  <motion.div
                    style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg, var(--c-accent), #8B5CF6)" }}
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${w}%` }}
                    transition={{ duration: 0.8, delay: 0.5 + i * 0.15, ease: EASE_OUT }}
                  />
                </div>
              ))}
            </div>

            {/* Floating ATS score badge */}
            <HeroFloatBadge reduceMotion={reduceMotion} delay={0.7} floatDelay={0.2} floatDuration={5.5} rotate={-3}
              style={{ top: -22, right: -18 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%", position: "relative",
                background: `conic-gradient(var(--c-accent2) 0% 94%, var(--c-border) 94% 100%)`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--c-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "var(--c-accent2)" }}>94</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>ATS Score</span>
            </HeroFloatBadge>

            {/* Floating AI badge */}
            <HeroFloatBadge reduceMotion={reduceMotion} delay={0.85} floatDelay={0.9} floatDuration={6} rotate={3}
              style={{ bottom: -16, left: -24 }}>
              <span style={{ fontSize: 14 }}>✨</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>AI Optimized</span>
            </HeroFloatBadge>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5, ease: EASE_OUT }}
            style={{ marginTop: 56 }}
          >
            <h2 className="font-display" style={{ fontSize: "clamp(22px, 2.4vw, 28px)", fontWeight: 800, margin: "0 0 10px", color: "var(--c-text)" }}>
              Land more interviews with an <span className="grad-text">AI-optimized</span> resume
            </h2>
            <p className="app-text2" style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
              Every resume is scored against real ATS rules, then rewritten to pass — free, no credit card required.
            </p>
          </motion.div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .auth-split { grid-template-columns: 1fr !important; }
          .auth-showcase { display: none !important; }
        }
        .auth-home-link:hover { color: var(--c-accent) !important; }
      `}</style>
    </div>
  );
}

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────

function CVPreviewModal({ resume, templateId, customAccent = "", customBg = "", customText = "", customHeaderBg = "", customMuted = "", customNameColor = "", onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", width: "min(820px, 90vw)" }}>
        <button onClick={onClose} style={{
          position: "absolute", top: -16, right: -16, zIndex: 10,
          width: 36, height: 36, borderRadius: "50%", border: "none",
          background: "var(--c-surface)", color: "var(--c-text)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)", fontSize: 18,
        }}>✕</button>
        <div style={{ background: "white", borderRadius: 12, overflow: "hidden", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}>
          <ResumePreview resume={resume} templateId={templateId} customAccent={customAccent} customBg={customBg} customText={customText} customHeaderBg={customHeaderBg} customMuted={customMuted} customNameColor={customNameColor} />
        </div>
      </div>
    </div>
  );
}

function DashboardPage({ setPage, user, resume, setResume, template, coverLetter, coverLetterTemplate = "cl-classic" }) {
  const [showCVPreview, setShowCVPreview] = useState(false);
  const { score } = computeATSScore(resume);
  const hasCoverLetter = !!(coverLetter?.opening || coverLetter?.body || coverLetter?.closing || coverLetter?.company);
  const stats = [
    { label: "ATS Score", value: `${score}`, unit: "/100", color: "var(--c-accent)" },
    { label: "Sections", value: `${computeSectionCount(resume)}`, unit: "filled", color: "var(--c-accent2)" },
    { label: "Word Count", value: `${computeWordCount(resume)}`, unit: "words", color: "var(--c-amber)" },
    { label: "Completeness", value: `${computeCompleteness(resume)}`, unit: "%", color: "#8B5CF6" },
  ];

  return (
    <div className="app-bg" style={{ minHeight: "100vh" }}>
      {showCVPreview && <CVPreviewModal resume={resume} templateId={template} onClose={() => setShowCVPreview(false)} />}
      <div style={{ padding: "32px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 className="font-display" style={{ fontSize: 28, fontWeight: 800, margin: "0 0 4px" }}>
              Good morning, {user?.name?.split(" ")[0] || "there"} 👋
            </h1>
            <p className="app-text2" style={{ margin: 0 }}>Let's get you to the next interview.</p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => setPage(PAGES.BUILDER)}>
            <Icon.Zap /> Open Builder
          </button>
        </div>

        {/* Stats */}
        <div className="dashboard-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
          {stats.map((s, i) => (
            <div key={i} className="stat-card">
              <div className="app-text2" style={{ fontSize: 13, marginBottom: 8 }}>{s.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="font-display" style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.value}</span>
                <span className="app-text3" style={{ fontSize: 14 }}>{s.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div className="dashboard-main" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
          {/* Resume card */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>My Resume</h2>
                <div className="app-text3" style={{ fontSize: 13 }}>Last edited just now</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setPage(PAGES.BUILDER)}><Icon.Download /> Export PDF</button>
                <button className="btn btn-primary btn-sm" onClick={() => setPage(PAGES.BUILDER)}><Icon.Zap /> Edit</button>
              </div>
            </div>
            <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ height: 240, overflow: "hidden", position: "relative" }}>
                <div style={{ transform: "scale(0.52)", transformOrigin: "top left", width: "192%", pointerEvents: "none" }}>
                  <ResumePreview resume={resume} />
                </div>
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(transparent, var(--c-surface))" }} />
              </div>
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--c-border)", display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCVPreview(true)}><Icon.Eye /> Full Preview</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.BUILDER)}><Icon.Download /> Download</button>
              </div>
            </div>
          </div>

          {/* Cover Letter card */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>My Cover Letter</h2>
                <div className="app-text3" style={{ fontSize: 13 }}>{hasCoverLetter ? "Last edited just now" : "Not started yet"}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setPage(PAGES.COVER_LETTER)}>
                  <Icon.Zap /> {hasCoverLetter ? "Edit" : "Start"}
                </button>
              </div>
            </div>
            <div style={{ border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ height: 240, overflow: "hidden", position: "relative" }}>
                <div style={{ transform: "scale(0.52)", transformOrigin: "top left", width: "192%", pointerEvents: "none" }}>
                  <CoverLetterPreview cl={coverLetter || {}} personal={resume?.personal} templateId={coverLetterTemplate} />
                </div>
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(transparent, var(--c-surface))" }} />
                {!hasCoverLetter && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(var(--c-surface-rgb, 255,255,255),0.85)", backdropFilter: "blur(2px)" }}>
                    <Icon.FileText size="32" style={{ color: "var(--c-text3)", marginBottom: 10 }} />
                    <div style={{ fontSize: 13, color: "var(--c-text2)", fontWeight: 600 }}>No cover letter yet</div>
                    <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setPage(PAGES.COVER_LETTER)}>
                      Create Cover Letter
                    </button>
                  </div>
                )}
              </div>
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--c-border)", display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.COVER_LETTER)}><Icon.Eye /> Open Editor</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.TEMPLATES)}><Icon.LayoutTemplate /> Change Style</button>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ATSPanel resume={resume} />

            {/* Quick actions */}
            <div className="card" style={{ padding: 20 }}>
              <h3 className="font-display" style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px" }}>Quick Actions</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { icon: <Icon.Sparkles />, label: "AI Improve Resume", color: "var(--c-accent)", page: PAGES.BUILDER },
                  { icon: <Icon.Target />, label: "Match to Job Description", color: "var(--c-accent2)", page: PAGES.BUILDER },
                  { icon: <Icon.LayoutTemplate />, label: "Change Template", color: "#8B5CF6", page: PAGES.TEMPLATES },
                  { icon: <Icon.Download />, label: "Export PDF", color: "var(--c-amber)", page: PAGES.BUILDER },
                ].map((a, i) => (
                  <button key={i} className="sidebar-item" onClick={() => setPage(a.page)}
                    style={{ border: "1px solid var(--c-border)", borderRadius: 8 }}>
                    <span style={{ color: a.color }}>{a.icon}</span>
                    {a.label}
                    <Icon.ChevronRight />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BUILDER PAGE ─────────────────────────────────────────────────────────────

function BuilderPage({ resume, setResume, template = "clarity", onTemplateChange, user, onNeedUpgrade }) {
  const premium = isPremium(user);
  const [section, setSection] = useState("personal");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [jd, setJd] = useState("");
  const [showJD, setShowJD] = useState(false);
  const [tab, setTab] = useState("edit"); // edit | preview | ats
  const [newSkill, setNewSkill] = useState("");
  const [importing, setImporting] = useState(false);
  // Persisted per-user so leaving the Live Preview tab (or navigating away
  // and back) doesn't silently reset margins/spacing to defaults.
  const marginKey = user?.email ? `ats-margins-${user.email}` : "ats-margins-anon";
  const [printMarginTop, setPrintMarginTop] = useLocalStorage(`${marginKey}-top`, 40);
  const [printMarginBottom, setPrintMarginBottom] = useLocalStorage(`${marginKey}-bottom`, 40);
  const [printMarginLeft, setPrintMarginLeft] = useLocalStorage(`${marginKey}-left`, 48);
  const [printMarginRight, setPrintMarginRight] = useLocalStorage(`${marginKey}-right`, 48);
  const [linkTB, setLinkTB] = useLocalStorage(`${marginKey}-linkTB`, true);
  const [linkLR, setLinkLR] = useLocalStorage(`${marginKey}-linkLR`, true);
  // Vertical gap (px) between experience/education/project entries. `null`
  // means "use each template's own default spacing" — templates fall back to
  // their original hardcoded value when this is unset.
  const [entrySpacing, setEntrySpacing] = useLocalStorage(`${marginKey}-entrySpacing`, null);

  const updateMarginTop = (v) => { setPrintMarginTop(v); if (linkTB) setPrintMarginBottom(v); };
  const updateMarginBottom = (v) => { setPrintMarginBottom(v); if (linkTB) setPrintMarginTop(v); };
  const updateMarginLeft = (v) => { setPrintMarginLeft(v); if (linkLR) setPrintMarginRight(v); };
  const updateMarginRight = (v) => { setPrintMarginRight(v); if (linkLR) setPrintMarginLeft(v); };
  const [pageCount, setPageCount] = useState(1);
  // Per-page margin overrides, keyed by 0-based page index: { [pageIndex]: { top, bottom, left, right } }
  const [pageOverrides, setPageOverrides] = useLocalStorage(`${marginKey}-pageOverrides`, {});
  const setPageOverride = (pageIdx, field, value) => {
    setPageOverrides(prev => ({ ...prev, [pageIdx]: { ...prev[pageIdx], [field]: value } }));
  };
  const clearPageOverride = (pageIdx) => {
    setPageOverrides(prev => { const next = { ...prev }; delete next[pageIdx]; return next; });
  };
  // The page index a page-override lives under is only meaningful for the
  // current page count — if editing margins/content collapses the resume
  // from e.g. 3 pages to 2, an override still stored under index 2 would
  // silently attach to whatever content now falls on a different page
  // instead of just disappearing cleanly. Drop overrides once their page no
  // longer exists so a shrink can't leave a stale override misapplied.
  useEffect(() => {
    setPageOverrides(prev => {
      const next = {};
      let changed = false;
      for (const key of Object.keys(prev)) {
        if (Number(key) < pageCount) next[key] = prev[key];
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [pageCount]);
  // Which page the toolbar margin sliders are editing. -1 = "All pages"
  // (the shared default). A specific 0-based index edits/creates that page's
  // override, falling back to the default whenever no override exists yet.
  const [marginPageSel, setMarginPageSel] = useState(-1);
  useEffect(() => {
    if (marginPageSel >= pageCount) setMarginPageSel(-1);
  }, [pageCount, marginPageSel]);
  const [expDragIdx, setExpDragIdx] = useState(null);
  const [expOverIdx, setExpOverIdx] = useState(null);
  const [expCollapsed, setExpCollapsed] = useState({});
  const toggleExpCollapsed = (id) => setExpCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const [eduCollapsed, setEduCollapsed] = useState({});
  const toggleEduCollapsed = (id) => setEduCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const [eduDragIdx, setEduDragIdx] = useState(null);
  const [eduOverIdx, setEduOverIdx] = useState(null);
  const moveEdu = (fromIdx, toIdx) => {
    setResume(prev => {
      const next = [...prev.education];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, education: next };
    });
  };
  const [certCollapsed, setCertCollapsed] = useState({});
  const toggleCertCollapsed = (id) => setCertCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const [certDragIdx, setCertDragIdx] = useState(null);
  const [certOverIdx, setCertOverIdx] = useState(null);
  const moveCert = (fromIdx, toIdx) => {
    setResume(prev => {
      const next = [...prev.certifications];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, certifications: next };
    });
  };
  const [projCollapsed, setProjCollapsed] = useState({});
  const toggleProjCollapsed = (id) => setProjCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const [projDragIdx, setProjDragIdx] = useState(null);
  const [projOverIdx, setProjOverIdx] = useState(null);
  const moveProj = (fromIdx, toIdx) => {
    setResume(prev => {
      const next = [...prev.projects];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, projects: next };
    });
  };
  const [importError, setImportError] = useState("");
  const importRef = useRef(null);

  const handleImportCV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportError("");
    try {
      const parsed = await parseResumeWithClaude(file);
      setResume(parsed);
      setSection("personal");
      trackEvent("ai_cv_import");
    } catch (err) {
      setImportError(err.message || "AI features are temporarily unavailable. Please try again later.");
    }
    setImporting(false);
    e.target.value = "";
  };
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [customAccent, setCustomAccent] = useLocalStorage("ats-custom-accent", "");
  const [customBg, setCustomBg] = useLocalStorage("ats-custom-bg", "");
  const [customText, setCustomText] = useLocalStorage("ats-custom-text", "");
  const [customHeaderBg, setCustomHeaderBg] = useLocalStorage("ats-custom-headerbg", "");
  const [customMuted, setCustomMuted] = useLocalStorage("ats-custom-muted", "");
  const [customNameColor, setCustomNameColor] = useLocalStorage("ats-custom-namecolor", "");

  const resetColors = () => { setCustomAccent(""); setCustomBg(""); setCustomText(""); setCustomHeaderBg(""); setCustomMuted(""); setCustomNameColor(""); };

  const handleTemplateChange = (id) => {
    onTemplateChange?.(id);
    setShowTemplatePicker(false);
    resetColors();
  };

  useEffect(() => {
    setTab(section === "ai" ? "ai" : "edit");
  }, [section]);

  const sections = [
    { id: "personal", label: "Personal Info", icon: <Icon.User /> },
    { id: "summary", label: "Summary", icon: <Icon.FileText /> },
    { id: "experience", label: "Experience", icon: <Icon.Briefcase /> },
    { id: "education", label: "Education", icon: <Icon.GraduationCap /> },
    { id: "skills", label: "Skills", icon: <Icon.Zap /> },
    { id: "certifications", label: "Certifications", icon: <Icon.Award /> },
    { id: "projects", label: "Projects", icon: <Icon.Target /> },
    { id: "ai", label: "AI Tools", icon: <Icon.Sparkles /> },
  ];

  const { score } = computeATSScore(resume);

  const aiGenerate = async (type) => {
    setAiLoading(true); setAiText("");
    try {
      let prompt = "";
      if (type === "summary") {
        const expStr = resume.experience?.map(e => `${e.role} at ${e.company}`).join(", ") || "various roles";
        const skillsStr = resume.skills?.join(", ") || "various skills";
        prompt = `Write a 2-3 sentence professional summary for a resume. Name: ${resume.personal.name}. Title: ${resume.personal.title}. Experience: ${expStr}. Skills: ${skillsStr}. Make it achievement-oriented, quantified, and ATS-friendly. Do NOT use the word "I".`;
      } else if (type === "jd") {
        prompt = `Given this job description:\n\n${jd}\n\nAnd this candidate's current summary:\n${resume.summary}\n\nRewrite the summary to be better optimized for this JD, emphasizing matching keywords and skills. Keep it 2-3 sentences. Do NOT use the word "I".`;
      } else if (type === "keywords") {
        prompt = `From this job description:\n\n${jd}\n\nList the top 10 ATS keywords this resume should include. The candidate has these skills: ${resume.skills?.join(", ")}. Format: comma-separated list of missing keywords that should be added.`;
      }
      const result = await callClaude(prompt);
      setAiText(result);
      trackEvent("ai_resume_generate", { type });
    } catch (e) {
      setAiText(e.message || "AI features are temporarily unavailable. Please try again later.");
    }
    setAiLoading(false);
  };

  const applySummary = () => {
    if (aiText) { setResume({ ...resume, summary: aiText }); setAiText(""); }
  };

  const updatePersonal = (field, val) => setResume({ ...resume, personal: { ...resume.personal, [field]: val } });

  const updateExpBullet = (expId, bulletIdx, val) => {
    setResume({
      ...resume,
      experience: resume.experience.map(e => e.id === expId
        ? { ...e, bullets: e.bullets.map((b, i) => i === bulletIdx ? val : b) }
        : e
      )
    });
  };

  const addExpBullet = (expId) => {
    setResume({
      ...resume,
      experience: resume.experience.map(e => e.id === expId ? { ...e, bullets: [...e.bullets, ""] } : e)
    });
  };

  const removeExpBullet = (expId, bulletIdx) => {
    setResume({
      ...resume,
      experience: resume.experience.map(e => e.id === expId
        ? { ...e, bullets: e.bullets.filter((_, i) => i !== bulletIdx) }
        : e
      )
    });
  };

  const addSkill = () => {
    if (newSkill.trim() && !resume.skills.includes(newSkill.trim())) {
      setResume({ ...resume, skills: [...resume.skills, newSkill.trim()] });
      setNewSkill("");
    }
  };

  const removeSkill = (skill) => setResume({ ...resume, skills: resume.skills.filter(s => s !== skill) });

  const addExperience = () => {
    setResume({
      ...resume,
      experience: [...resume.experience, {
        id: Date.now(), company: "", role: "", start: "", end: "Present", location: "", bullets: [""]
      }]
    });
    setSection("experience");
  };

  const updateExp = (id, field, val) => {
    setResume({ ...resume, experience: resume.experience.map(e => e.id === id ? { ...e, [field]: val } : e) });
  };

  const removeExp = (id) => setResume({ ...resume, experience: resume.experience.filter(e => e.id !== id) });

  const moveExp = (fromIdx, toIdx) => {
    setResume(prev => {
      const next = [...prev.experience];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, experience: next };
    });
  };

  // Auto-sort experience by date (latest first) once, when this page mounts.
  // Manual drag-and-drop reordering afterwards is left untouched.
  const sortedOnMountRef = useRef(false);
  useEffect(() => {
    if (sortedOnMountRef.current) return;
    sortedOnMountRef.current = true;
    setResume(prev => ({ ...prev, experience: sortExperienceByDate(prev.experience) }));
  }, []);

  const [exportingPDF, setExportingPDF] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const handleExportPDF = async () => {
    if (!premium && !FREE_TEMPLATES.includes(template)) { onNeedUpgrade?.("pdf_export"); return; }
    // Must be the full-height off-screen copy (data-export-source), not one
    // of the visible per-page boxes — those are clipped to a single page's
    // slice and would export as one incomplete page.
    const el = document.querySelector(".builder-preview-wrap [data-export-source] .resume-preview");
    if (!el) return;
    setExportingPDF(true);
    try {
      const name = (resume?.personal?.name || "resume").trim().replace(/\s+/g, "_");
      await exportElementToPDF(el, `${name}.pdf`, { top: printMarginTop, bottom: printMarginBottom, left: printMarginLeft, right: printMarginRight }, pageOverrides);
      trackEvent("resume_export", { template });
      setShowFeedback(true);
    } finally {
      setExportingPDF(false);
    }
  };

  return (
    <>
    <FeedbackModal open={showFeedback} onClose={() => setShowFeedback(false)} user={user} docType="resume" />
    <div className="builder-layout" style={{ display: "flex", height: "calc(100vh - 58px)", overflow: "hidden" }}>
      {/* Sidebar */}
      <div className="builder-sidebar app-surface" style={{ width: 220, borderRight: "1px solid var(--c-border)", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, overflowY: "auto" }}>
        <div style={{ marginBottom: 8 }}>
          <div className="app-text3" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 12px 6px" }}>Sections</div>
          <div className="progress-bar" style={{ margin: "0 12px 12px" }}>
            <div className="progress-fill" style={{ width: `${score}%` }} />
          </div>
          <div className="app-text3" style={{ fontSize: 11, padding: "0 12px 8px" }}>ATS Score: <span style={{ color: "var(--c-accent)", fontWeight: 600 }}>{score}/100</span></div>
        </div>

        {sections.map(s => (
          <button key={s.id} className={cn("sidebar-item", section === s.id && "active")} onClick={() => setSection(s.id)}>
            {s.icon}
            <span style={{ fontSize: 13 }}>{s.label}</span>
            {s.id === "ai" && <span className="badge badge-blue" style={{ fontSize: 10, padding: "1px 6px", marginLeft: "auto" }}>AI</span>}
          </button>
        ))}

        <div className="divider" style={{ margin: "8px 0" }} />
        <button className="sidebar-item" style={{ color: "var(--c-accent2)", fontSize: 13 }} onClick={addExperience}>
          <Icon.Plus /> Add Experience
        </button>

        <div style={{ flex: 1 }} />
        <div className="divider" style={{ margin: "8px 0" }} />

        {/* Template switcher */}
        <div style={{ marginBottom: 8 }}>
          <div className="app-text3" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 4px 6px" }}>Template</div>
          <button className="btn btn-secondary btn-sm" style={{ width: "100%", justifyContent: "space-between" }}
            onClick={() => setShowTemplatePicker(p => !p)}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: TEMPLATES.find(t => t.id === template)?.accent || "var(--c-accent)", flexShrink: 0 }} />
              {TEMPLATES.find(t => t.id === template)?.name || "Clarity"}
            </span>
            <Icon.ChevronRight />
          </button>

          {showTemplatePicker && (
            <div style={{
              marginTop: 8, background: "var(--c-surface)", border: "1px solid var(--c-border)",
              borderRadius: 10, padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6,
              maxHeight: 260, overflowY: "auto",
            }}>
              {TEMPLATES.map(t => {
                const isPrem = !FREE_TEMPLATES.includes(t.id);
                return (
                  <button key={t.id}
                    onClick={() => handleTemplateChange(t.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                      borderRadius: 7, border: t.id === template ? `1.5px solid var(--c-accent)` : "1.5px solid var(--c-border)",
                      background: t.id === template ? "var(--c-accent-light)" : "var(--c-surface2)",
                      cursor: "pointer", fontSize: 12, fontWeight: 500, fontFamily: "var(--font-body)",
                      color: t.id === template ? "var(--c-accent)" : "var(--c-text2)",
                    }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />
                    <span style={{ flex: 1, textAlign: "left" }}>{t.name}</span>
                    {isPrem && <span style={{ fontSize: 9, background: "linear-gradient(135deg,#F59E0B,#D97706)", color: "#fff", borderRadius: 3, padding: "1px 4px", fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>PRO</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Color Customizer ── */}
        {(() => {
          const tplAccent = TEMPLATES.find(t => t.id === template)?.accent || "#1A86D0";
          const hasHeaderBand = ["echo","flow","summit","bloom","vista","lens","axiom","portrait","prism"].includes(template);
          const anyCustom = customAccent || customBg || customText || customHeaderBg || customMuted || customNameColor;
          const colorRows = [
            {
              label: "Accent", value: customAccent, set: setCustomAccent, def: tplAccent,
              presets: ["#1D4ED8","#0D9488","#7C3AED","#059669","#DC2626","#EA580C","#EC4899","#0EA5E9","#111827","#B45309","#0891B2","#9333EA"],
            },
            {
              label: "Name Color", value: customNameColor, set: setCustomNameColor, def: "#FFFFFF",
              presets: ["#FFFFFF","#F1F5F9","#111827","#1E293B","#1D4ED8","#7C3AED","#0D9488","#DC2626","#F59E0B","#EC4899","#059669","#0891B2"],
            },
            ...(hasHeaderBand ? [{
              label: "Header BG", value: customHeaderBg, set: setCustomHeaderBg, def: tplAccent,
              presets: ["#1D4ED8","#7C3AED","#0D9488","#DC2626","#EA580C","#EC4899","#059669","#0891B2","#111827","#4C1D95","#9333EA","#B45309"],
            }] : []),
            {
              label: "Background", value: customBg, set: setCustomBg, def: "#FFFFFF",
              presets: ["#FFFFFF","#F8FAFC","#F0F9FF","#FFF7ED","#F5F3FF","#FDF4FF","#F0FDF4","#FFFBF5","#0F172A","#111827","#1C1917","#0C0A09"],
            },
            {
              label: "Sub-heading", value: customText, set: setCustomText, def: "#111111",
              presets: ["#111827","#1E293B","#0F172A","#374151","#1D4ED8","#065F46","#4C1D95","#7C2D12","#FFFFFF","#F1F5F9","#E2E8F0","#CBD5E1"],
            },
            {
              label: "Details", value: customMuted, set: setCustomMuted, def: "#6B7280",
              presets: ["#6B7280","#475569","#94A3B8","#9CA3AF","#374151","#1D4ED8","#0D9488","#7C3AED","#DC2626","#B45309","#059669","#EC4899"],
            },
          ];
          return (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 8px" }}>
                <div className="app-text3" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Colors</div>
                {anyCustom && (
                  <button onClick={resetColors} style={{ fontSize: 10, color: "var(--c-accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                    Reset all
                  </button>
                )}
              </div>
              {colorRows.map(({ label, value, set, def, presets }) => {
                const isLight = c => ["#FFFFFF","#F8FAFC","#F0F9FF","#FFF7ED","#F5F3FF","#FDF4FF","#F0FDF4","#FFFBF5","#F1F5F9","#E2E8F0","#CBD5E1","#FFFFFF"].includes(c);
                const active = value || def;
                return (
                <div key={label} style={{ marginBottom: 12, padding: "0 4px" }}>
                  {/* Label + current value */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--c-text3)", fontWeight: 600 }}>{label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, background: active, border: "1px solid var(--c-border)" }} />
                      <span style={{ fontSize: 10, color: "var(--c-text3)", fontFamily: "monospace" }}>{active}</span>
                    </div>
                  </div>

                  {/* Preset swatches */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 7 }}>
                    <button title="Template default" onClick={() => set("")}
                      style={{ width: 22, height: 22, borderRadius: 4, background: def, border: "none", cursor: "pointer", position: "relative", outline: !value ? "2.5px solid var(--c-accent)" : "1px solid rgba(0,0,0,0.1)", outlineOffset: 1, flexShrink: 0 }}>
                      {!value && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: isLight(def) ? "#111" : "#fff", fontSize: 10, fontWeight: 800 }}>✓</span>}
                    </button>
                    {presets.map(c => (
                      <button key={c} title={c} onClick={() => set(c)}
                        style={{ width: 22, height: 22, borderRadius: 4, background: c, border: "1px solid rgba(0,0,0,0.08)", cursor: "pointer", position: "relative", outline: value === c ? "2.5px solid var(--c-accent)" : "1px solid rgba(0,0,0,0.08)", outlineOffset: 1, transition: "transform 0.1s", transform: value === c ? "scale(1.18)" : "scale(1)", flexShrink: 0 }}>
                        {value === c && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: isLight(c) ? "#111" : "#fff", fontSize: 10, fontWeight: 800 }}>✓</span>}
                      </button>
                    ))}
                  </div>

                  {/* Custom color input row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--c-surface2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "5px 8px" }}>
                    {/* Large color swatch that opens native picker */}
                    <label title="Pick custom color" style={{ display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: active, border: "2px solid var(--c-border)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)", position: "relative", overflow: "hidden" }}>
                        <input type="color" value={active} onChange={e => set(e.target.value)}
                          style={{ position: "absolute", inset: 0, width: "200%", height: "200%", opacity: 0, cursor: "pointer", padding: 0, border: "none" }} />
                      </div>
                    </label>
                    {/* Hex text input */}
                    <input
                      value={value || def}
                      onChange={e => {
                        const v = e.target.value;
                        if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) set(v);
                      }}
                      onBlur={e => {
                        const v = e.target.value;
                        if (/^#[0-9A-Fa-f]{6}$/.test(v)) set(v); else set(value);
                      }}
                      maxLength={7}
                      placeholder={def}
                      style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 12, fontFamily: "monospace", color: "var(--c-text)", padding: 0 }}
                    />
                    {value && (
                      <button onClick={() => set("")} title="Reset to default"
                        style={{ fontSize: 13, color: "var(--c-text3)", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          );
        })()}

        <button className="btn btn-primary btn-export-highlight btn-sm" style={{ justifyContent: "center" }} onClick={handleExportPDF} disabled={exportingPDF}>
          <Icon.Download /> {exportingPDF ? "Generating…" : "Export PDF"}
        </button>
      </div>

      {/* Editor */}
      <div className="builder-editor app-bg" style={{ flex: "0 0 420px", borderRight: "1px solid var(--c-border)", overflowY: "auto", padding: 20 }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--c-surface2)", borderRadius: 10, padding: 4 }}>
          {["edit", "ats", "ai"].map(t => (
            <button key={t}
              onClick={() => {
                if (t === "ai" && !premium) { onNeedUpgrade?.("ai_writing"); return; }
                setTab(t);
              }}
              style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "var(--font-body)",
                background: tab === t ? "var(--c-surface)" : "transparent",
                color: tab === t ? "var(--c-text)" : "var(--c-text2)",
                boxShadow: tab === t ? "0 1px 4px var(--c-shadow)" : "none", transition: "all 0.15s" }}>
              {t === "edit" ? "Editor" : t === "ats" ? "ATS Check" : <>AI Tools {!premium && "🔒"}</>}
            </button>
          ))}
        </div>

        {tab === "edit" && (
          <div className="fade-in">
            {/* Personal Info */}
            {section === "personal" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Personal Info</h2>

                {/* ── Import existing CV ── */}
                <div style={{
                  background: "linear-gradient(135deg, var(--c-accent-light), var(--c-surface))",
                  border: "1.5px dashed var(--c-accent)",
                  borderRadius: 12, padding: 16,
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="font-display" style={{ fontWeight: 700, fontSize: 14 }}>Import from existing CV</div>
                    <div className="app-text2" style={{ fontSize: 12, marginTop: 2 }}>Upload your PDF, DOCX, or TXT — AI will fill in all fields automatically</div>
                    {importError && <div style={{ fontSize: 12, color: "var(--c-danger)", marginTop: 4 }}>{importError}</div>}
                  </div>
                  {premium ? (
                    <label style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "8px 16px", borderRadius: 8, cursor: importing ? "wait" : "pointer",
                      background: "var(--c-accent)", color: "#fff",
                      fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)",
                      whiteSpace: "nowrap", flexShrink: 0, opacity: importing ? 0.7 : 1,
                    }}>
                      {importing ? <><div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} /> Importing…</> : <><Icon.Upload /> Upload CV</>}
                      <input ref={importRef} type="file" accept=".pdf,.docx,.txt" style={{ display: "none" }} onChange={handleImportCV} disabled={importing} />
                    </label>
                  ) : (
                    <button onClick={() => onNeedUpgrade?.("cv_import")} className="btn btn-secondary btn-sm" style={{ flexShrink: 0, gap: 6 }}>
                      🔒 Premium
                    </button>
                  )}
                </div>

                {/* ── Photo Upload ── */}
                <div>
                  <label className="label">Profile Photo <span className="app-text3" style={{ fontWeight: 400 }}>(optional — for photo templates)</span></label>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {/* Avatar preview */}
                    <div style={{
                      width: 72, height: 72, borderRadius: "50%", flexShrink: 0,
                      background: resume.personal.photo ? "transparent" : "var(--c-accent-light)",
                      border: "2px dashed var(--c-border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden", position: "relative",
                    }}>
                      {resume.personal.photo ? (
                        <img src={resume.personal.photo} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" strokeWidth="1.5">
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        padding: "8px 16px", borderRadius: 8, cursor: "pointer",
                        background: "var(--c-surface2)", border: "1px solid var(--c-border)",
                        fontSize: 13, fontWeight: 500, color: "var(--c-text)",
                        transition: "all 0.15s",
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>
                        Upload Photo
                        <input type="file" accept="image/*" style={{ display: "none" }}
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = ev => updatePersonal("photo", ev.target.result);
                              reader.readAsDataURL(file);
                            }
                          }} />
                      </label>
                      {resume.personal.photo && (
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8, color: "var(--c-danger)" }}
                          onClick={() => updatePersonal("photo", null)}>
                          Remove
                        </button>
                      )}
                      <div className="app-text3" style={{ fontSize: 11, marginTop: 5 }}>
                        JPG, PNG · Max 5MB · Used in Portrait, Vista & Pulse templates
                      </div>
                    </div>
                  </div>
                </div>

                <div className="divider" />

                {[
                  { key: "name", label: "Full Name", placeholder: "Alex Morgan" },
                  { key: "title", label: "Professional Title", placeholder: "Senior Software Engineer" },
                  { key: "email", label: "Email", placeholder: "alex@example.com" },
                  { key: "phone", label: "Phone", placeholder: "+1 (555) 000-0000" },
                  { key: "location", label: "Location", placeholder: "San Francisco, CA" },
                  { key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/..." },
                  { key: "github", label: "GitHub", placeholder: "github.com/..." },
                  { key: "website", label: "Website", placeholder: "yoursite.com" },
                ].map(f => (
                  <div key={f.key}>
                    <label className="label">{f.label}</label>
                    <input className="input" placeholder={f.placeholder}
                      value={resume.personal[f.key] || ""}
                      onChange={e => updatePersonal(f.key, e.target.value)} />
                  </div>
                ))}
              </div>
            )}

            {/* Summary */}
            {section === "summary" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Professional Summary</h2>
                  <button className="btn btn-secondary btn-sm" onClick={() => setTab("ai")}><Icon.Sparkles /> AI Help</button>
                </div>
                <div>
                  <label className="label">Summary <span className="app-text3">({resume.summary?.length || 0} chars)</span></label>
                  <textarea className="input" rows={6} placeholder="2-3 impactful sentences highlighting your expertise, key achievements, and value proposition…"
                    value={resume.summary || ""}
                    onChange={e => setResume({ ...resume, summary: e.target.value })} />
                </div>
                <div className="ai-panel">
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--c-accent)" }}><Icon.Sparkles /> ATS Tips</div>
                  {["Start with your job title and years of experience", "Include 2-3 specific, quantified achievements", "Match keywords from target job descriptions"].map((t, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--c-text2)", marginBottom: 4, display: "flex", gap: 6 }}>
                      <Icon.Check size="3" /> {t}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Experience */}
            {section === "experience" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Experience</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    {resume.experience.length > 1 && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const allCollapsed = resume.experience.every(exp => expCollapsed[exp.id]);
                          setExpCollapsed(Object.fromEntries(resume.experience.map(exp => [exp.id, !allCollapsed])));
                        }}>
                        {resume.experience.every(exp => expCollapsed[exp.id]) ? "Expand all" : "Collapse all"}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={addExperience}><Icon.Plus /> Add</button>
                  </div>
                </div>
                {resume.experience.map((exp, ei) => (
                  <div key={exp.id} className="card"
                    draggable
                    onDragStart={() => setExpDragIdx(ei)}
                    onDragOver={e => { e.preventDefault(); if (expOverIdx !== ei) setExpOverIdx(ei); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (expDragIdx !== null && expDragIdx !== ei) moveExp(expDragIdx, ei);
                      setExpDragIdx(null); setExpOverIdx(null);
                    }}
                    onDragEnd={() => { setExpDragIdx(null); setExpOverIdx(null); }}
                    style={{
                      padding: 16,
                      opacity: expDragIdx === ei ? 0.5 : 1,
                      outline: expOverIdx === ei && expDragIdx !== null && expDragIdx !== ei ? "2px dashed var(--c-accent)" : "none",
                      outlineOffset: 2,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: expCollapsed[exp.id] ? 0 : 12, cursor: "pointer" }}
                      onClick={() => toggleExpCollapsed(exp.id)}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span title="Drag to reorder" onClick={e => e.stopPropagation()} style={{ cursor: "grab", color: "var(--c-text3)", display: "flex" }}><Icon.GripVertical /></span>
                        <span style={{ display: "inline-flex", transform: expCollapsed[exp.id] ? "rotate(-90deg)" : "none", transition: "transform 0.15s", color: "var(--c-text3)" }}><Icon.ChevronDown /></span>
                        <span className="font-display" style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>Position {ei + 1}</span>
                        {expCollapsed[exp.id] && (exp.role || exp.company) && (
                          <span style={{ fontSize: 13, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            — {exp.role}{exp.role && exp.company ? " @ " : ""}{exp.company}
                          </span>
                        )}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); removeExp(exp.id); }} style={{ color: "var(--c-danger)" }}><Icon.Trash /></button>
                    </div>
                    {!expCollapsed[exp.id] && (
                      <div style={{ display: "grid", gap: 10 }}>
                        {[
                          { key: "role", label: "Job Title", placeholder: "Senior Engineer" },
                          { key: "company", label: "Company", placeholder: "Stripe, Inc." },
                          { key: "location", label: "Location", placeholder: "San Francisco, CA" },
                        ].map(f => (
                          <div key={f.key}>
                            <label className="label">{f.label}</label>
                            <input className="input" placeholder={f.placeholder} value={exp[f.key] || ""}
                              onChange={e => updateExp(exp.id, f.key, e.target.value)} />
                          </div>
                        ))}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label className="label">Start</label>
                            <MonthYearPicker value={exp.start || ""} onChange={v => updateExp(exp.id, "start", v)} placeholder="Jan 2022" />
                          </div>
                          <div>
                            <label className="label">End</label>
                            <MonthYearPicker value={exp.end || ""} onChange={v => updateExp(exp.id, "end", v)} allowPresent placeholder="Present" />
                          </div>
                        </div>
                        <div>
                          <label className="label">Bullet Points</label>
                          {exp.bullets.map((bullet, bi) => (
                            <div key={bi} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                              <textarea className="input" rows={2} style={{ fontSize: 13 }}
                                placeholder="Led team of 5 engineers to deliver feature X, resulting in 30% improvement in Y…"
                                value={bullet}
                                onChange={e => updateExpBullet(exp.id, bi, e.target.value)} />
                              <button className="btn btn-ghost btn-sm" onClick={() => removeExpBullet(exp.id, bi)} style={{ flexShrink: 0 }}><Icon.Trash /></button>
                            </div>
                          ))}
                          <button className="btn btn-ghost btn-sm" onClick={() => addExpBullet(exp.id)}><Icon.Plus /> Add bullet</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Skills */}
            {section === "skills" && (() => {
              const recommended = getRecommendedSkills(resume.personal?.title, resume.summary, resume.skills);
              const hasContext = !!(resume.personal?.title || resume.summary);
              return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Skills</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {resume.skills.map(skill => (
                    <div key={skill} className="badge badge-blue" style={{ cursor: "pointer", gap: 6 }}>
                      {skill}
                      <button onClick={() => removeSkill(skill)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit", lineHeight: 1, fontSize: 14 }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" placeholder="Add a skill…" value={newSkill}
                    onChange={e => setNewSkill(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addSkill()} />
                  <button className="btn btn-primary btn-sm" onClick={addSkill}><Icon.Plus /></button>
                </div>

                {/* Recommended skills */}
                <div className="ai-panel">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-accent)", display: "flex", alignItems: "center", gap: 6 }}>
                      💡 Recommended
                      {hasContext && (
                        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--c-text3)" }}>
                          based on your {resume.personal?.title ? "title" : ""}{resume.personal?.title && resume.summary ? " & " : ""}{resume.summary ? "summary" : ""}
                        </span>
                      )}
                    </div>
                    {recommended.length > 0 && (
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "3px 8px" }}
                        onClick={() => {
                          const toAdd = recommended.filter(s => !resume.skills.includes(s));
                          setResume({ ...resume, skills: [...resume.skills, ...toAdd] });
                        }}>
                        + Add all
                      </button>
                    )}
                  </div>

                  {!hasContext ? (
                    <div style={{ fontSize: 12, color: "var(--c-text3)", fontStyle: "italic" }}>
                      Add your Professional Title or Summary to get personalised skill suggestions.
                    </div>
                  ) : recommended.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--c-text3)" }}>All recommended skills already added! 🎉</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {recommended.map(s => (
                        <button key={s} className="badge badge-gray"
                          style={{ cursor: "pointer", border: "1px dashed var(--c-border)", fontSize: 12, padding: "4px 10px" }}
                          onClick={() => setResume({ ...resume, skills: [...resume.skills, s] })}>
                          <Icon.Plus /> {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              );
            })()}

            {/* Education */}
            {section === "education" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Education</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    {resume.education.length > 1 && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const allCollapsed = resume.education.every(edu => eduCollapsed[edu.id]);
                          setEduCollapsed(Object.fromEntries(resume.education.map(edu => [edu.id, !allCollapsed])));
                        }}>
                        {resume.education.every(edu => eduCollapsed[edu.id]) ? "Expand all" : "Collapse all"}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setResume({ ...resume, education: [...resume.education, { id: Date.now(), school: "", degree: "", year: "", gpa: "" }] })}>
                      <Icon.Plus /> Add
                    </button>
                  </div>
                </div>
                {resume.education.map((edu, edi) => (
                  <div key={edu.id} className="card"
                    draggable
                    onDragStart={() => setEduDragIdx(edi)}
                    onDragOver={e => { e.preventDefault(); if (eduOverIdx !== edi) setEduOverIdx(edi); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (eduDragIdx !== null && eduDragIdx !== edi) moveEdu(eduDragIdx, edi);
                      setEduDragIdx(null); setEduOverIdx(null);
                    }}
                    onDragEnd={() => { setEduDragIdx(null); setEduOverIdx(null); }}
                    style={{
                      padding: 16,
                      opacity: eduDragIdx === edi ? 0.5 : 1,
                      outline: eduOverIdx === edi && eduDragIdx !== null && eduDragIdx !== edi ? "2px dashed var(--c-accent)" : "none",
                      outlineOffset: 2,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: eduCollapsed[edu.id] ? 0 : 12, cursor: "pointer" }}
                      onClick={() => toggleEduCollapsed(edu.id)}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span title="Drag to reorder" onClick={e => e.stopPropagation()} style={{ cursor: "grab", color: "var(--c-text3)", display: "flex" }}><Icon.GripVertical /></span>
                        <span style={{ display: "inline-flex", transform: eduCollapsed[edu.id] ? "rotate(-90deg)" : "none", transition: "transform 0.15s", color: "var(--c-text3)" }}><Icon.ChevronDown /></span>
                        <span className="font-display" style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>Education {edi + 1}</span>
                        {eduCollapsed[edu.id] && (edu.degree || edu.school) && (
                          <span style={{ fontSize: 13, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            — {edu.degree}{edu.degree && edu.school ? " @ " : ""}{edu.school}
                          </span>
                        )}
                      </span>
                      <button className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); setResume({ ...resume, education: resume.education.filter(ed => ed.id !== edu.id) }); }}
                        style={{ color: "var(--c-danger)" }}>
                        <Icon.Trash />
                      </button>
                    </div>
                    {!eduCollapsed[edu.id] && (
                      <>
                        {[
                          { key: "school", label: "Institution" },
                          { key: "degree", label: "Degree" },
                          { key: "gpa", label: "GPA (optional)" },
                        ].map(f => (
                          <div key={f.key} style={{ marginBottom: 10 }}>
                            <label className="label">{f.label}</label>
                            <input className="input" value={edu[f.key] || ""}
                              onChange={e => setResume({
                                ...resume,
                                education: resume.education.map(ed => ed.id === edu.id ? { ...ed, [f.key]: e.target.value } : ed)
                              })} />
                          </div>
                        ))}
                        <div style={{ marginBottom: 10 }}>
                          <label className="label">Year</label>
                          <MonthYearPicker value={edu.year || ""} onChange={v => setResume({ ...resume, education: resume.education.map(ed => ed.id === edu.id ? { ...ed, year: v } : ed) })} placeholder="2022" />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Certifications */}
            {section === "certifications" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Certifications</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    {resume.certifications.length > 1 && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const allCollapsed = resume.certifications.every(cert => certCollapsed[cert.id]);
                          setCertCollapsed(Object.fromEntries(resume.certifications.map(cert => [cert.id, !allCollapsed])));
                        }}>
                        {resume.certifications.every(cert => certCollapsed[cert.id]) ? "Expand all" : "Collapse all"}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setResume({ ...resume, certifications: [...resume.certifications, { id: Date.now(), name: "", issuer: "", year: "" }] })}>
                      <Icon.Plus /> Add
                    </button>
                  </div>
                </div>
                {resume.certifications.map((cert, ci) => (
                  <div key={cert.id} className="card"
                    draggable
                    onDragStart={() => setCertDragIdx(ci)}
                    onDragOver={e => { e.preventDefault(); if (certOverIdx !== ci) setCertOverIdx(ci); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (certDragIdx !== null && certDragIdx !== ci) moveCert(certDragIdx, ci);
                      setCertDragIdx(null); setCertOverIdx(null);
                    }}
                    onDragEnd={() => { setCertDragIdx(null); setCertOverIdx(null); }}
                    style={{
                      padding: 16,
                      opacity: certDragIdx === ci ? 0.5 : 1,
                      outline: certOverIdx === ci && certDragIdx !== null && certDragIdx !== ci ? "2px dashed var(--c-accent)" : "none",
                      outlineOffset: 2,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: certCollapsed[cert.id] ? 0 : 12, cursor: "pointer" }}
                      onClick={() => toggleCertCollapsed(cert.id)}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span title="Drag to reorder" onClick={e => e.stopPropagation()} style={{ cursor: "grab", color: "var(--c-text3)", display: "flex" }}><Icon.GripVertical /></span>
                        <span style={{ display: "inline-flex", transform: certCollapsed[cert.id] ? "rotate(-90deg)" : "none", transition: "transform 0.15s", color: "var(--c-text3)" }}><Icon.ChevronDown /></span>
                        <span className="font-display" style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>Certification {ci + 1}</span>
                        {certCollapsed[cert.id] && (cert.name || cert.issuer) && (
                          <span style={{ fontSize: 13, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            — {cert.name}{cert.name && cert.issuer ? " @ " : ""}{cert.issuer}
                          </span>
                        )}
                      </span>
                      <button className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); setResume({ ...resume, certifications: resume.certifications.filter(c => c.id !== cert.id) }); }}
                        style={{ color: "var(--c-danger)" }}>
                        <Icon.Trash />
                      </button>
                    </div>
                    {!certCollapsed[cert.id] && (
                      <>
                        {[{ key: "name", label: "Name" }, { key: "issuer", label: "Issuer" }].map(f => (
                          <div key={f.key} style={{ marginBottom: 10 }}>
                            <label className="label">{f.label}</label>
                            <input className="input" value={cert[f.key] || ""}
                              onChange={e => setResume({
                                ...resume,
                                certifications: resume.certifications.map(c => c.id === cert.id ? { ...c, [f.key]: e.target.value } : c)
                              })} />
                          </div>
                        ))}
                        <div style={{ marginBottom: 10 }}>
                          <label className="label">Year</label>
                          <MonthYearPicker value={cert.year || ""} onChange={v => setResume({ ...resume, certifications: resume.certifications.map(c => c.id === cert.id ? { ...c, year: v } : c) })} placeholder="2022" />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Projects */}
            {section === "projects" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Projects</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    {resume.projects.length > 1 && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const allCollapsed = resume.projects.every(proj => projCollapsed[proj.id]);
                          setProjCollapsed(Object.fromEntries(resume.projects.map(proj => [proj.id, !allCollapsed])));
                        }}>
                        {resume.projects.every(proj => projCollapsed[proj.id]) ? "Expand all" : "Collapse all"}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setResume({ ...resume, projects: [...resume.projects, { id: Date.now(), name: "", desc: "", start: "", end: "", url: "" }] })}>
                      <Icon.Plus /> Add
                    </button>
                  </div>
                </div>
                {resume.projects.map((proj, pi) => (
                  <div key={proj.id} className="card"
                    draggable
                    onDragStart={() => setProjDragIdx(pi)}
                    onDragOver={e => { e.preventDefault(); if (projOverIdx !== pi) setProjOverIdx(pi); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (projDragIdx !== null && projDragIdx !== pi) moveProj(projDragIdx, pi);
                      setProjDragIdx(null); setProjOverIdx(null);
                    }}
                    onDragEnd={() => { setProjDragIdx(null); setProjOverIdx(null); }}
                    style={{
                      padding: 16,
                      opacity: projDragIdx === pi ? 0.5 : 1,
                      outline: projOverIdx === pi && projDragIdx !== null && projDragIdx !== pi ? "2px dashed var(--c-accent)" : "none",
                      outlineOffset: 2,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: projCollapsed[proj.id] ? 0 : 10, cursor: "pointer" }}
                      onClick={() => toggleProjCollapsed(proj.id)}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span title="Drag to reorder" onClick={e => e.stopPropagation()} style={{ cursor: "grab", color: "var(--c-text3)", display: "flex" }}><Icon.GripVertical /></span>
                        <span style={{ display: "inline-flex", transform: projCollapsed[proj.id] ? "rotate(-90deg)" : "none", transition: "transform 0.15s", color: "var(--c-text3)" }}><Icon.ChevronDown /></span>
                        <span className="font-display" style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>Project {pi + 1}</span>
                        {projCollapsed[proj.id] && proj.name && (
                          <span style={{ fontSize: 13, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            — {proj.name}
                          </span>
                        )}
                      </span>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--c-danger)" }}
                        onClick={e => { e.stopPropagation(); setResume({ ...resume, projects: resume.projects.filter(p => p.id !== proj.id) }); }}>
                        <Icon.Trash />
                      </button>
                    </div>
                    {!projCollapsed[proj.id] && (
                      <>
                        <div style={{ marginBottom: 10 }}>
                          <label className="label">Project Name</label>
                          <input className="input" placeholder="My Awesome Project" value={proj.name || ""}
                            onChange={e => setResume({ ...resume, projects: resume.projects.map(p => p.id === proj.id ? { ...p, name: e.target.value } : p) })} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div>
                            <label className="label">Start Date</label>
                            <MonthYearPicker value={proj.start || ""} onChange={v => setResume({ ...resume, projects: resume.projects.map(p => p.id === proj.id ? { ...p, start: v } : p) })} placeholder="Jan 2023" />
                          </div>
                          <div>
                            <label className="label">End Date</label>
                            <MonthYearPicker value={proj.end || ""} onChange={v => setResume({ ...resume, projects: resume.projects.map(p => p.id === proj.id ? { ...p, end: v } : p) })} allowPresent placeholder="Present" />
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <label className="label">URL <span className="app-text3" style={{ fontWeight: 400 }}>(optional)</span></label>
                          <input className="input" placeholder="github.com/you/project" value={proj.url || ""}
                            onChange={e => setResume({ ...resume, projects: resume.projects.map(p => p.id === proj.id ? { ...p, url: e.target.value } : p) })} />
                        </div>
                        <div>
                          <label className="label">Description</label>
                          <textarea className="input" rows={3} placeholder="What did you build? What technologies? What was the impact?" value={proj.desc || ""}
                            onChange={e => setResume({ ...resume, projects: resume.projects.map(p => p.id === proj.id ? { ...p, desc: e.target.value } : p) })} />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* AI Tools section — handled by useEffect switching to AI tab */}
          </div>
        )}

        {tab === "ats" && (
          <div className="fade-in">
            <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>ATS Analysis</h2>
            <ATSPanel resume={resume} />
            <div className="card" style={{ padding: 16, marginTop: 16 }}>
              <h3 className="font-display" style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>Job Description Match</h3>
              {!showJD ? (
                <button className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowJD(true)}>
                  <Icon.Target /> Paste Job Description
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea className="input" rows={6} placeholder="Paste the job description here…" value={jd} onChange={e => setJd(e.target.value)} />
                  <button className="btn btn-primary btn-sm" onClick={() => { setTab("ai"); aiGenerate("keywords"); }}>
                    <Icon.Sparkles /> Analyze & Get Keywords
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "ai" && (
          <div className="fade-in">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>AI Assistant</h2>
              <div className="badge badge-blue"><Icon.Sparkles /> Powered by Claude</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Generate Summary */}
              <div className="card" style={{ padding: 16 }}>
                <h3 className="font-display" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>✨ Generate Professional Summary</h3>
                <p className="app-text2" style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
                  AI writes a tailored summary based on your experience and skills.
                </p>
                <button className="btn btn-primary btn-sm" onClick={() => aiGenerate("summary")} disabled={aiLoading}>
                  {aiLoading ? "Generating…" : <><Icon.Sparkles /> Generate Summary</>}
                </button>
              </div>

              {/* JD Optimizer */}
              <div className="card" style={{ padding: 16 }}>
                <h3 className="font-display" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>🎯 Optimize for Job Description</h3>
                <textarea className="input" rows={4} placeholder="Paste the job description here…" value={jd} onChange={e => setJd(e.target.value)} style={{ marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => aiGenerate("jd")} disabled={aiLoading || !jd}>
                    {aiLoading ? "…" : "Rewrite Summary"}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => aiGenerate("keywords")} disabled={aiLoading || !jd}>
                    {aiLoading ? "…" : "Get Keywords"}
                  </button>
                </div>
              </div>

              {/* AI Output */}
              {aiLoading && (
                <div className="ai-panel">
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-accent)" }} />
                    <span style={{ fontSize: 13, color: "var(--c-accent)" }}>Claude is writing…</span>
                  </div>
                </div>
              )}

              {aiText && !aiLoading && (
                <div className="ai-panel fade-in">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-accent)" }}>✨ AI Suggestion</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAiText("")}>Dismiss</button>
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.7, margin: "0 0 12px", color: "var(--c-text)" }}>{aiText}</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={applySummary}>Apply to Summary</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(aiText)}>Copy</button>
                  </div>
                </div>
              )}

              {/* Tips */}
              <div className="card" style={{ padding: 16 }}>
                <h3 className="font-display" style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>⚡ ATS Writing Tips</h3>
                {[
                  "Use strong action verbs: Led, Built, Increased, Reduced, Shipped",
                  "Add numbers: percentages, team sizes, revenue impact",
                  "Mirror keywords from the job description exactly",
                  "Keep formatting simple — no tables, columns, or images in ATS version",
                  "Use standard section headers: Experience, Education, Skills",
                ].map((tip, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 12, color: "var(--c-text2)" }}>
                    <span style={{ color: "var(--c-accent2)", flexShrink: 0 }}>✓</span> {tip}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live Preview */}
      <div className="builder-preview-wrap" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {/* Toolbar */}
        <div className="no-print" style={{ flexShrink: 0, background: "var(--c-surface2)", borderBottom: "1px solid var(--c-border)" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 16px",
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text2)" }}>Live Preview</span>
              <div className="badge badge-green" style={{ fontSize: 10 }}>ATS Safe</div>
              <div className="badge badge-gray" style={{ fontSize: 10, textTransform: "capitalize" }}>
                {TEMPLATES.find(t => t.id === template)?.name || "Clarity"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn btn-export-highlight btn-sm" onClick={handleExportPDF} disabled={exportingPDF}>
                <Icon.Download /> {exportingPDF ? "Generating…" : "Export PDF"}
              </button>
            </div>
          </div>
          {/* Layout controls — always visible; every change here re-renders
              the preview and its margin frame instantly, no export needed. */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: "10px 20px", alignItems: "center",
            padding: "8px 16px", borderTop: "1px solid var(--c-border)",
          }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--c-text3)", whiteSpace: "nowrap" }}>Entry spacing</span>
              <input
                type="range" min={0} max={24} step={2}
                value={entrySpacing ?? 12}
                onChange={e => setEntrySpacing(Number(e.target.value))}
                title="Space between experience, education, and project entries"
                style={{ width: 80 }}
              />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-primary)", width: 24, textAlign: "right" }}>{entrySpacing ?? 12}px</span>
            </div>
            <div style={{ width: 1, height: 16, background: "var(--c-border)" }} />
            {pageCount > 1 && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--c-text3)", whiteSpace: "nowrap" }}>Margins for</span>
                <select
                  value={marginPageSel}
                  onChange={e => setMarginPageSel(Number(e.target.value))}
                  style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text)", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 6, padding: "3px 6px", cursor: "pointer" }}
                >
                  <option value={-1}>All pages</option>
                  {Array.from({ length: pageCount }).map((_, i) => (
                    <option key={i} value={i}>Page {i + 1}{pageOverrides[i] ? " (custom)" : ""}</option>
                  ))}
                </select>
                {marginPageSel >= 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-text3)", cursor: "pointer" }} title="Give this page its own margins instead of using the default">
                    <input
                      type="checkbox"
                      checked={!!pageOverrides[marginPageSel]}
                      onChange={e => {
                        if (e.target.checked) {
                          setPageOverride(marginPageSel, "top", printMarginTop);
                          setPageOverride(marginPageSel, "bottom", printMarginBottom);
                          setPageOverride(marginPageSel, "left", printMarginLeft);
                          setPageOverride(marginPageSel, "right", printMarginRight);
                        } else {
                          clearPageOverride(marginPageSel);
                        }
                      }}
                      style={{ margin: 0 }}
                    />
                    Custom
                  </label>
                )}
              </div>
            )}
            <div style={{ width: 1, height: 16, background: "var(--c-border)" }} />
            {(() => {
              // A specific page is selected: sliders always target that
              // page, never the shared default — even before "Custom" is
              // checked, so a page still showing default values can't be
              // dragged into silently editing every other page's margin too.
              const onPage = marginPageSel >= 0;
              const activeOverride = onPage ? pageOverrides[marginPageSel] : null;
              const globalDefaults = { top: printMarginTop, bottom: printMarginBottom, left: printMarginLeft, right: printMarginRight };
              const fields = [
                ["Top", "top", "bottom", linkTB],
                ["Bottom", "bottom", "top", linkTB],
                ["Left", "left", "right", linkLR],
                ["Right", "right", "left", linkLR],
              ];
              return fields.map(([label, field, pairField, linked]) => {
                const val = onPage ? (activeOverride?.[field] ?? globalDefaults[field]) : globalDefaults[field];
                const onChange = (v) => {
                  if (onPage) {
                    setPageOverride(marginPageSel, field, v);
                    if (linked) setPageOverride(marginPageSel, pairField, v);
                  } else if (field === "top") updateMarginTop(v);
                  else if (field === "bottom") updateMarginBottom(v);
                  else if (field === "left") updateMarginLeft(v);
                  else updateMarginRight(v);
                };
                return (
                  <div key={label} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--c-text3)", whiteSpace: "nowrap" }}>{label} margin</span>
                    <input
                      type="range" min={0} max={80} step={4} value={val}
                      onChange={e => onChange(Number(e.target.value))}
                      title={onPage ? `${label} margin for page ${marginPageSel + 1}` : `${label} page margin (all pages)`}
                      style={{ width: 70 }}
                    />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-primary)", width: 26, textAlign: "right" }}>{val}px</span>
                  </div>
                );
              });
            })()}
            {marginPageSel < 0 && (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-text3)", cursor: "pointer" }} title="Keep top/bottom equal">
                  <input type="checkbox" checked={linkTB} onChange={() => setLinkTB(v => !v)} style={{ margin: 0 }} /> Link T/B
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-text3)", cursor: "pointer" }} title="Keep left/right equal">
                  <input type="checkbox" checked={linkLR} onChange={() => setLinkLR(v => !v)} style={{ margin: 0 }} /> Link L/R
                </label>
              </>
            )}
          </div>
        </div>

        {/* Resume — fills remaining space */}
        <div style={{ flex: 1, overflow: "auto", padding: "24px", background: "var(--c-surface2)" }}>
          <PaginatedResumePreview
            margins={{ top: printMarginTop, bottom: printMarginBottom, left: printMarginLeft, right: printMarginRight }}
            pageOverrides={pageOverrides}
            onPageCountChange={setPageCount}
            highlightPage={marginPageSel}
          >
            <ResumePreview resume={resume} templateId={template} customAccent={customAccent} customBg={customBg} customText={customText} customHeaderBg={customHeaderBg} customMuted={customMuted} customNameColor={customNameColor} entrySpacing={entrySpacing} />
          </PaginatedResumePreview>
        </div>
      </div>
    </div>
    </>
  );
}

// ─── MINI RESUME PREVIEWS (one per template style) ───────────────────────────

const R = SAMPLE_RESUME; // shorthand

// Dummy placeholder photo for photo-template previews
const DUMMY_AVATAR = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#B8CDE0"/>
      <stop offset="100%" stop-color="#8AAEC8"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#bg)"/>
  <circle cx="50" cy="36" r="22" fill="#F0D9C8"/>
  <ellipse cx="50" cy="36" rx="18" ry="19" fill="#E8C9B0"/>
  <circle cx="43" cy="33" r="2.5" fill="#7A5C44"/>
  <circle cx="57" cy="33" r="2.5" fill="#7A5C44"/>
  <path d="M43 43 Q50 49 57 43" stroke="#C49A7A" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <ellipse cx="50" cy="105" rx="40" ry="30" fill="#D4A882"/>
  <ellipse cx="50" cy="100" rx="32" ry="22" fill="#E0B896"/>
</svg>`)}`;


function MiniApex() {
  // Dark navy, cyan accent — side bar left strip
  const s = { fontFamily: "'Poppins',sans-serif", background: "#0F172A", color: "#E2E8F0", fontSize: 8, lineHeight: 1.45, padding: "14px 12px", height: "100%", display: "flex", flexDirection: "column", gap: 0 };
  const accent = "#38BDF8"; const muted = "#94A3B8"; const border = "#1E293B";
  return (
    <div style={s}>
      {/* Header strip */}
      <div style={{ borderBottom: `1px solid ${border}`, paddingBottom: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#F8FAFC", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 8, color: accent, fontWeight: 600, marginTop: 1 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => (
            <span key={i} style={{ fontSize: 7, color: muted }}>· {v}</span>
          ))}
        </div>
      </div>
      {/* Summary */}
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 3 }}>Profile</div>
        <div style={{ fontSize: 7, color: muted, lineHeight: 1.5 }}>{R.summary.slice(0, 130)}…</div>
      </div>
      {/* Experience */}
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 3 }}>Experience</div>
        {R.experience.slice(0, 2).map(exp => (
          <div key={exp.id} style={{ marginBottom: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 7.5, color: "#F1F5F9" }}>{exp.role}</span>
              <span style={{ fontSize: 6.5, color: muted }}>{exp.start}–{exp.end}</span>
            </div>
            <div style={{ fontSize: 7, color: accent, fontWeight: 600, marginBottom: 2 }}>{exp.company}</div>
            {exp.bullets.slice(0, 2).map((b, i) => (
              <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 8, position: "relative", marginBottom: 1 }}>
                <span style={{ position: "absolute", left: 2, color: accent }}>›</span>{b.slice(0, 70)}…
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Skills */}
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 4 }}>Skills</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {R.skills.slice(0, 9).map((sk, i) => (
            <span key={i} style={{ background: "#1E293B", border: `1px solid ${border}`, color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>{sk}</span>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 3 }}>Education</div>
        {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
      </div>
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 3 }}>Certifications</div>
        {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
      </div>
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 3 }}>Projects</div>
        {R.projects.slice(0, 1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7, color: "#F1F5F9" }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
      </div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 3 }}>Portfolio & Links</div>
        <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
      </div>
    </div>
  );
}

function MiniClarity() {
  // Clean white, green accent, single-column, spacious
  const accent = "#059669"; const muted = "#6B7280"; const rule = "#D1FAE5";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", color: "#111827", fontSize: 8, lineHeight: 1.5, padding: "16px 14px", height: "100%" }}>
      <div style={{ textAlign: "center", borderBottom: `2px solid ${rule}`, paddingBottom: 9, marginBottom: 9 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 8, color: accent, fontWeight: 600 }}>{R.personal.title}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 3 }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => (
            <span key={i} style={{ fontSize: 6.5, color: muted }}>{v}</span>
          ))}
        </div>
      </div>
      <SectionBlock label="Summary" accent={accent}>
        <div style={{ fontSize: 7, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0, 140)}…</div>
      </SectionBlock>
      <SectionBlock label="Experience" accent={accent}>
        {R.experience.slice(0, 2).map(exp => (
          <div key={exp.id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role} · <span style={{ color: accent }}>{exp.company}</span></span>
              <span style={{ fontSize: 6.5, color: muted }}>{exp.start}–{exp.end}</span>
            </div>
            {exp.bullets.slice(0, 2).map((b, i) => (
              <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 7, position: "relative", marginTop: 1 }}>
                <span style={{ position: "absolute", left: 1, color: accent, fontWeight: 700 }}>•</span>{b.slice(0, 72)}…
              </div>
            ))}
          </div>
        ))}
      </SectionBlock>
      <SectionBlock label="Skills" accent={accent}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {R.skills.slice(0, 10).map((sk, i) => (
            <span key={i} style={{ background: "#ECFDF5", color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>{sk}</span>
          ))}
        </div>
      </SectionBlock>
      <SectionBlock label="Education" accent={accent}>
        {R.education.map(e => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, fontSize: 7 }}>{e.degree} · <span style={{ color: muted }}>{e.school}</span></span>
            <span style={{ fontSize: 6.5, color: muted }}>{e.year}</span>
          </div>
        ))}
      </SectionBlock>
      <SectionBlock label="Certifications" accent={accent}>
        {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>{c.name}</span><span style={{ color: muted }}>{c.issuer} · {c.year}</span></div>)}
      </SectionBlock>
      <SectionBlock label="Projects" accent={accent}>
        {R.projects.slice(0, 1).map(p => <div key={p.id}><div style={{ fontWeight: 700, fontSize: 7 }}>{p.name}</div>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
      </SectionBlock>
      <SectionBlock label="Portfolio & Links" accent={accent}>
        <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website}</div>
        <div style={{ fontSize: 6.5, color: muted }}>in {R.personal.linkedin} · ⌥ {R.personal.github}</div>
      </SectionBlock>
    </div>
  );
}

function MiniAxiom() {
  // Two-column: left sidebar purple, right content
  const accent = "#7C3AED"; const sideText = "#EDE9FE"; const sideBg = "#4C1D95";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex" }}>
      {/* Left sidebar */}
      <div style={{ width: "34%", background: sideBg, padding: "14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 12, margin: "0 auto 4px" }}>
          {R.personal.name.split(" ").map(n => n[0]).join("")}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>{R.personal.name}</div>
          <div style={{ fontSize: 7, color: "#C4B5FD", marginTop: 2 }}>{R.personal.title}</div>
        </div>
        <div style={{ borderTop: "1px solid #5B21B6", paddingTop: 8 }}>
          <div style={{ fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#A78BFA", marginBottom: 5 }}>Contact</div>
          {[{ icon: "✉", val: R.personal.email }, { icon: "📱", val: R.personal.phone }, { icon: "📍", val: R.personal.location }].map((c, i) => (
            <div key={i} style={{ fontSize: 6.5, color: sideText, marginBottom: 3, wordBreak: "break-all" }}>{c.icon} {c.val}</div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#A78BFA", marginBottom: 5 }}>Skills</div>
          {R.skills.slice(0, 7).map((sk, i) => (
            <div key={i} style={{ fontSize: 6.5, color: sideText, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ flex: 1, height: 3, background: "#5B21B6", borderRadius: 2 }}>
                <div style={{ height: "100%", background: "#A78BFA", borderRadius: 2, width: `${75 + (i % 3) * 8}%` }} />
              </div>
              {sk}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#A78BFA", marginBottom: 4 }}>Education</div>
          {R.education.map(e => (
            <div key={e.id} style={{ color: sideText, fontSize: 6.5, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 700 }}>{e.degree}</div>
              <div style={{ color: "#C4B5FD" }}>{e.school} · {e.year}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Right content */}
      <div style={{ flex: 1, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionBlock label="Profile" accent={accent}>
          <div style={{ fontSize: 7, color: "#4B5563", lineHeight: 1.6 }}>{R.summary.slice(0, 150)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7.5, color: "#111827" }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: "#9CA3AF" }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, fontWeight: 600, marginBottom: 2 }}>{exp.company} · {exp.location}</div>
              {exp.bullets.slice(0, 2).map((b, i) => (
                <div key={i} style={{ fontSize: 6.5, color: "#6B7280", paddingLeft: 7, position: "relative", marginBottom: 1 }}>
                  <span style={{ position: "absolute", left: 1, color: accent }}>•</span>{b.slice(0, 68)}…
                </div>
              ))}
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 7 }}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: "#9CA3AF" }}>{c.issuer} · {c.year}</span>
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0, 1).map(p => <div key={p.id}><div style={{ fontWeight: 700, fontSize: 7, color: "#111827" }}>{p.name}</div>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: "#6B7280" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

function MiniNova() {
  // Bold dark, amber/gold accent, large type, creative layout
  const accent = "#F59E0B"; const bg = "#0A0A0A"; const surface = "#111111"; const muted = "#71717A";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#FAFAFA", fontSize: 7.5, lineHeight: 1.45, padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Bold header */}
      <div style={{ background: surface, borderBottom: `2px solid ${accent}`, padding: "14px 14px 10px" }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#FAFAFA" }}>{R.personal.name}</div>
        <div style={{ fontSize: 8, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
          {[R.personal.email, R.personal.location].map((v, i) => (
            <span key={i} style={{ fontSize: 6.5, color: muted }}>{v}</span>
          ))}
          <span style={{ fontSize: 6.5, color: muted }}>↗ {R.personal.github}</span>
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Summary */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 16, height: 2, background: accent }} />
            <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>About</span>
          </div>
          <div style={{ fontSize: 7, color: "#A1A1AA", lineHeight: 1.6 }}>{R.summary.slice(0, 120)}…</div>
        </div>
        {/* Experience */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <div style={{ width: 16, height: 2, background: accent }} />
            <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Experience</span>
          </div>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6, borderLeft: `2px solid #222`, paddingLeft: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 8, color: "#F4F4F5" }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: muted }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, marginBottom: 2 }}>{exp.company}</div>
              {exp.bullets.slice(0, 1).map((b, i) => (
                <div key={i} style={{ fontSize: 6.5, color: "#71717A", marginBottom: 1 }}>› {b.slice(0, 75)}…</div>
              ))}
            </div>
          ))}
        </div>
        {/* Skills */}
        <div style={{ marginBottom: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 16, height: 2, background: accent }} />
            <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Stack</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {R.skills.slice(0, 9).map((sk, i) => (
              <span key={i} style={{ background: "#1A1A1A", border: `1px solid #333`, color: "#D4D4D8", fontSize: 6, padding: "1px 5px", borderRadius: 2 }}>{sk}</span>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 16, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Education</span></div>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 16, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Certifications</span></div>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 16, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Projects</span></div>
          {R.projects.slice(0, 1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#F4F4F5" }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 16, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Portfolio</span></div>
          <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </div>
      </div>
    </div>
  );
}

function MiniEcho() {
  // Light blue tech style, teal accent, right-aligned header detail strip
  const accent = "#0891B2"; const bg = "#F0F9FF"; const muted = "#64748B"; const strip = "#E0F2FE";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#0F172A", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header with left name + right contacts */}
      <div style={{ background: accent, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{R.personal.name}</div>
            <div style={{ fontSize: 7.5, color: "#BAE6FD", fontWeight: 500, marginTop: 2 }}>{R.personal.title}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {[R.personal.email, R.personal.phone, R.personal.location, R.personal.github].map((v, i) => (
              <div key={i} style={{ fontSize: 6.5, color: "#E0F2FE" }}>{v}</div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Summary */}
        <div style={{ background: strip, borderRadius: 4, padding: "6px 8px" }}>
          <div style={{ fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: accent, marginBottom: 2 }}>Professional Summary</div>
          <div style={{ fontSize: 7, color: muted, lineHeight: 1.5 }}>{R.summary.slice(0, 130)}…</div>
        </div>
        {/* Experience */}
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 5 }}>Work Experience</div>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7.5, color: "#0F172A" }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: muted }}>{exp.start} – {exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, fontWeight: 600, marginBottom: 2 }}>{exp.company} | {exp.location}</div>
              {exp.bullets.slice(0, 2).map((b, i) => (
                <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 7, position: "relative", marginBottom: 1 }}>
                  <span style={{ position: "absolute", left: 1 }}>▸</span>{b.slice(0, 68)}…
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Skills grid */}
        <div style={{ marginBottom: 7 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 5 }}>Core Competencies</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
            {R.skills.slice(0, 9).map((sk, i) => (
              <div key={i} style={{ background: strip, fontSize: 6, padding: "2px 4px", borderRadius: 3, color: accent, fontWeight: 600, textAlign: "center" }}>{sk}</div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 4 }}>Education</div>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 4 }}>Certifications</div>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 4 }}>Projects</div>
          {R.projects.slice(0, 1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
        </div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 4 }}>Portfolio & Links</div>
          <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </div>
      </div>
    </div>
  );
}

function MiniForm() {
  // Executive, classic black & white, serif-inspired, clean hierarchy
  const accent = "#1E293B"; const rule = "#CBD5E1"; const muted = "#475569"; const highlight = "#F1F5F9";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", color: "#1E293B", fontSize: 7.5, lineHeight: 1.5, padding: "14px 16px", height: "100%" }}>
      {/* Header: name large, rule, details inline */}
      <div style={{ marginBottom: 9 }}>
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.025em", color: "#0F172A", lineHeight: 1 }}>{R.personal.name}</div>
        <div style={{ fontSize: 8, fontWeight: 400, color: muted, marginTop: 2, letterSpacing: "0.03em" }}>{R.personal.title}</div>
        <div style={{ height: 2, background: accent, margin: "6px 0 5px", width: "100%" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 6.5, color: muted }}>
          <span>{R.personal.email}</span>
          <span>{R.personal.phone}</span>
          <span>{R.personal.location}</span>
          <span>{R.personal.linkedin}</span>
        </div>
      </div>
      {/* Summary */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, marginBottom: 3 }}>Executive Summary</div>
        <div style={{ fontSize: 7, color: muted, lineHeight: 1.65, borderLeft: `2px solid ${accent}`, paddingLeft: 7 }}>{R.summary.slice(0, 145)}…</div>
      </div>
      {/* Experience */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, borderBottom: `0.5px solid ${rule}`, paddingBottom: 2, marginBottom: 5 }}>Professional Experience</div>
        {R.experience.slice(0, 2).map(exp => (
          <div key={exp.id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: 800, fontSize: 8, color: "#0F172A" }}>{exp.role}</span>
              <span style={{ fontSize: 6.5, color: muted, fontStyle: "italic" }}>{exp.start} – {exp.end}</span>
            </div>
            <div style={{ fontSize: 7, fontWeight: 700, color: muted, marginBottom: 2 }}>{exp.company} · {exp.location}</div>
            {exp.bullets.slice(0, 2).map((b, i) => (
              <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 8, position: "relative", marginBottom: 1 }}>
                <span style={{ position: "absolute", left: 2 }}>—</span>{b.slice(0, 70)}…
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Skills & Education inline */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, borderBottom: `0.5px solid ${rule}`, paddingBottom: 2, marginBottom: 4 }}>Skills</div>
          {R.skills.slice(0, 6).map((sk, i) => (
            <div key={i} style={{ fontSize: 6.5, color: muted, marginBottom: 2 }}>· {sk}</div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, borderBottom: `0.5px solid ${rule}`, paddingBottom: 2, marginBottom: 4 }}>Education</div>
          {R.education.map(e => (
            <div key={e.id} style={{ fontSize: 7, color: muted }}>
              <div style={{ fontWeight: 700, color: "#0F172A" }}>{e.degree}</div>
              <div>{e.school} · {e.year}</div>
            </div>
          ))}
          {R.certifications.map(c => (
            <div key={c.id} style={{ fontSize: 6.5, color: muted, marginTop: 3 }}>
              <div style={{ fontWeight: 600, color: "#0F172A" }}>{c.name}</div>
              <div>{c.issuer} · {c.year}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, borderBottom: `0.5px solid ${rule}`, paddingBottom: 2, marginBottom: 4 }}>Projects</div>
        {R.projects.slice(0, 1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#0F172A" }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
      </div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, borderBottom: `0.5px solid ${rule}`, paddingBottom: 2, marginBottom: 4 }}>Portfolio & Links</div>
        <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
      </div>
    </div>
  );
}

// Shared section block helper used by mini previews
function SectionBlock({ label, accent, children }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent,
        borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}


// ─── PHOTO AVATAR HELPER ──────────────────────────────────────────────────────

function PhotoAvatar({ photo, name, size = 52, shape = "circle", accent = "#6366F1" }) {
  const initials = name ? name.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase() : "AM";
  return photo ? (
    <img src={photo} alt={name} style={{
      width: size, height: size, objectFit: "cover", flexShrink: 0,
      borderRadius: shape === "circle" ? "50%" : shape === "rounded" ? size * 0.22 : 0,
      border: `2px solid ${accent}44`,
    }} />
  ) : (
    <div style={{
      width: size, height: size, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: shape === "circle" ? "50%" : shape === "rounded" ? size * 0.22 : 0,
      background: `linear-gradient(135deg, ${accent}cc, ${accent}88)`,
      color: "#fff", fontWeight: 800, fontSize: size * 0.3,
      fontFamily: "var(--font-display)", letterSpacing: "-0.02em",
      border: `2px solid ${accent}55`,
    }}>{initials}</div>
  );
}

// Portrait — Dark indigo sidebar with large circular photo
function MiniPortrait({ photo } = {}) {
  const accent = "#818CF8"; const bg = "#1E1B4B"; const sideBg = "#13113A";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#E0E7FF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex" }}>
      {/* Left sidebar */}
      <div style={{ width: "38%", background: sideBg, padding: "16px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {/* Photo */}
        <PhotoAvatar photo={photo} name={R.personal.name} size={52} shape="circle" accent={accent} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: "#EEF2FF", lineHeight: 1.2 }}>{R.personal.name}</div>
          <div style={{ fontSize: 6.5, color: accent, marginTop: 2 }}>{R.personal.title}</div>
        </div>
        {/* Divider */}
        <div style={{ height: 1, background: "#312E81", width: "100%", margin: "2px 0" }} />
        {/* Contact */}
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 4 }}>Contact</div>
          {[{ i: "✉", v: R.personal.email }, { i: "📱", v: R.personal.phone }, { i: "📍", v: R.personal.location }].map((c, idx) => (
            <div key={idx} style={{ fontSize: 6, color: "#C7D2FE", marginBottom: 3, wordBreak: "break-all" }}>{c.i} {c.v}</div>
          ))}
          <div style={{ fontSize: 6, color: "#C7D2FE" }}>in {R.personal.linkedin}</div>
        </div>
        {/* Skills */}
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 4 }}>Skills</div>
          {R.skills.slice(0, 7).map((sk, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 6, color: "#C7D2FE", marginBottom: 2 }}>{sk}</div>
              <div style={{ height: 3, background: "#312E81", borderRadius: 99 }}>
                <div style={{ height: "100%", background: accent, borderRadius: 99, width: `${65 + (i*5)%36}%` }} />
              </div>
            </div>
          ))}
        </div>
        {/* Education */}
        <div style={{ width: "100%", marginTop: 2 }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, marginBottom: 4 }}>Education</div>
          {R.education.map(e => (
            <div key={e.id} style={{ fontSize: 6, color: "#C7D2FE" }}>
              <div style={{ fontWeight: 700, color: "#EEF2FF" }}>{e.degree}</div>
              <div>{e.school} · {e.year}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Right content */}
      <div style={{ flex: 1, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionBlock label="Profile" accent={accent}>
          <div style={{ fontSize: 7, color: "#C7D2FE", lineHeight: 1.6 }}>{R.summary.slice(0,140)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0,2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7.5, color: "#EEF2FF" }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: "#818CF8" }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, marginBottom: 2 }}>{exp.company}</div>
              {exp.bullets.slice(0,2).map((b,i) => (
                <div key={i} style={{ fontSize: 6.5, color: "#A5B4FC", paddingLeft: 7, position: "relative", marginBottom: 1 }}>
                  <span style={{ position: "absolute", left: 1, color: accent }}>•</span>{b.slice(0,65)}…
                </div>
              ))}
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: "#C7D2FE" }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#EEF2FF" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: "#C7D2FE" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// Vista — Light pink, horizontal header with round photo left
function MiniVista({ photo } = {}) {
  const accent = "#EC4899"; const muted = "#9D174D"; const light = "#FCE7F3"; const rule = "#FBCFE8";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFF1F2", color: "#1F2937", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header band */}
      <div style={{ background: "linear-gradient(135deg,#EC4899,#BE185D)", padding: "14px 16px 12px", display: "flex", alignItems: "center", gap: 12 }}>
        <PhotoAvatar photo={photo} name={R.personal.name} size={50} shape="circle" accent="#fff" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.02em" }}>{R.personal.name}</div>
          <div style={{ fontSize: 7.5, color: "#FBCFE8", fontWeight: 500, marginTop: 2 }}>{R.personal.title}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {[R.personal.email, R.personal.location].map((v, i) => (
              <span key={i} style={{ fontSize: 6, color: "#FBCFE8" }}>· {v}</span>
            ))}
          </div>
        </div>
      </div>
      {/* Body */}
      <div style={{ padding: "12px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionBlock label="Summary" accent={accent}>
          <div style={{ fontSize: 7, color: "#6B7280", lineHeight: 1.6 }}>{R.summary.slice(0,140)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0,2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: "#9CA3AF" }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, marginBottom: 2, fontWeight: 600 }}>{exp.company}</div>
              {exp.bullets.slice(0,2).map((b,i) => (
                <div key={i} style={{ fontSize: 6.5, color: "#6B7280", paddingLeft: 7, position: "relative", marginBottom: 1 }}>
                  <span style={{ position: "absolute", left: 1, color: accent }}>▸</span>{b.slice(0,65)}…
                </div>
              ))}
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Skills" accent={accent}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {R.skills.slice(0,10).map((sk,i) => (
              <span key={i} style={{ background: light, color: muted, fontSize: 6, padding: "1px 6px", borderRadius: 99, fontWeight: 600, border: `1px solid ${rule}` }}>{sk}</span>
            ))}
          </div>
        </SectionBlock>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 7 }}>
              <span style={{ fontWeight: 700 }}>{e.degree} · <span style={{ color: "#9CA3AF", fontWeight: 400 }}>{e.school}</span></span>
              <span style={{ color: "#9CA3AF" }}>{e.year}</span>
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600 }}>{c.name}</span><span style={{ color: "#9CA3AF" }}>{c.issuer} · {c.year}</span></div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><div style={{ fontWeight: 700, fontSize: 7 }}>{p.name}</div>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: "#6B7280" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// Pulse — Bold dark, orange accent, photo in top-right corner
function MiniPulse({ photo } = {}) {
  const accent = "#F97316"; const bg = "#0C0A09"; const muted = "#78716C";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#FAFAF9", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#1C1917", borderBottom: `2px solid ${accent}`, padding: "14px 14px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#FAFAF9", letterSpacing: "-0.03em", lineHeight: 1 }}>{R.personal.name}</div>
          <div style={{ fontSize: 7.5, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 3 }}>{R.personal.title}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
            {[R.personal.email, R.personal.phone].map((v,i) => (
              <span key={i} style={{ fontSize: 6, color: muted }}>· {v}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            {[R.personal.location, R.personal.github].map((v,i) => (
              <span key={i} style={{ fontSize: 6, color: muted }}>· {v}</span>
            ))}
          </div>
        </div>
        {/* Photo top-right */}
        <PhotoAvatar photo={photo} name={R.personal.name} size={48} shape="rounded" accent={accent} />
      </div>
      {/* Body */}
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 14, height: 2, background: accent }} />
            <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>About</span>
          </div>
          <div style={{ fontSize: 7, color: "#A8A29E", lineHeight: 1.6 }}>{R.summary.slice(0,120)}…</div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <div style={{ width: 14, height: 2, background: accent }} />
            <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Experience</span>
          </div>
          {R.experience.slice(0,2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6, borderLeft: `2px solid #292524`, paddingLeft: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 8, color: "#FAFAF9" }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: muted }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, marginBottom: 2 }}>{exp.company}</div>
              {exp.bullets.slice(0,1).map((b,i) => (
                <div key={i} style={{ fontSize: 6.5, color: "#78716C" }}>› {b.slice(0,72)}…</div>
              ))}
            </div>
          ))}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 14, height: 2, background: accent }} />
            <span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Skills</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {R.skills.slice(0,9).map((sk,i) => (
              <span key={i} style={{ background: "#1C1917", border: `1px solid #292524`, color: "#D6D3D1", fontSize: 6, padding: "1px 5px", borderRadius: 2 }}>{sk}</span>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 14, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Education</span></div>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 14, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Certifications</span></div>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 14, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Projects</span></div>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#FAFAF9" }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><div style={{ width: 14, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Portfolio</span></div>
          <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </div>
      </div>
    </div>
  );
}

// ── Slate: ultra-minimal, cool gray, single column ──
function MiniSlate() {
  const accent = "#475569"; const muted = "#94A3B8"; const rule = "#E2E8F0";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#F8FAFC", color: "#0F172A", fontSize: 7.5, lineHeight: 1.5, padding: "16px 14px", height: "100%" }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 8, color: accent, marginTop: 1 }}>{R.personal.title}</div>
        <div style={{ height: 1, background: rule, margin: "6px 0" }} />
        <div style={{ display: "flex", gap: 10, fontSize: 6.5, color: muted, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i}>{v}</span>)}
        </div>
      </div>
      <SectionBlock label="Summary" accent={accent}>
        <div style={{ fontSize: 7, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0, 130)}…</div>
      </SectionBlock>
      <SectionBlock label="Experience" accent={accent}>
        {R.experience.slice(0, 2).map(exp => (
          <div key={exp.id} style={{ marginBottom: 5 }}>
            <div style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role} <span style={{ color: accent }}>· {exp.company}</span></div>
            <div style={{ fontSize: 6.5, color: muted }}>{exp.start} – {exp.end}</div>
            {exp.bullets.slice(0, 2).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 7, position: "relative" }}><span style={{ position: "absolute", left: 1 }}>–</span>{b.slice(0, 65)}…</div>)}
          </div>
        ))}
      </SectionBlock>
      <SectionBlock label="Skills" accent={accent}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {R.skills.slice(0, 9).map((sk, i) => <span key={i} style={{ background: "#E2E8F0", color: accent, fontSize: 6, padding: "1px 6px", borderRadius: 3, fontWeight: 500 }}>{sk}</span>)}
        </div>
      </SectionBlock>
      <SectionBlock label="Education" accent={accent}>
        {R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
      </SectionBlock>
      <SectionBlock label="Certifications" accent={accent}>
        {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
      </SectionBlock>
      <SectionBlock label="Projects" accent={accent}>
        {R.projects.slice(0, 1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
      </SectionBlock>
      <SectionBlock label="Portfolio & Links" accent={accent}>
        <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
      </SectionBlock>
    </div>
  );
}

// ── Pure: stark black & white, ruled lines only, no color ──
function MiniPure() {
  const rule = "#E5E7EB";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#fff", color: "#111", fontSize: 7.5, lineHeight: 1.5, padding: "16px 14px", height: "100%" }}>
      <div style={{ borderBottom: "2px solid #111", paddingBottom: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.03em", color: "#111" }}>{R.personal.name}</div>
        <div style={{ fontSize: 8, color: "#555", marginTop: 1, fontWeight: 400 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, fontSize: 6.5, color: "#888", marginTop: 4 }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i}>{v}</span>)}
        </div>
      </div>
      {[["Summary", R.summary.slice(0, 120) + "…"], ["Experience", null], ["Skills", null]].map(([label], idx) => (
        <div key={idx} style={{ marginBottom: 7 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "#111", borderBottom: `1px solid ${rule}`, paddingBottom: 2, marginBottom: 4 }}>{label}</div>
          {label === "Summary" && <div style={{ fontSize: 7, color: "#555" }}>{R.summary.slice(0, 130)}…</div>}
          {label === "Experience" && R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role} · {exp.company}</span>
                <span style={{ fontSize: 6.5, color: "#888" }}>{exp.start}–{exp.end}</span>
              </div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: "#555", paddingLeft: 8, position: "relative" }}><span style={{ position: "absolute", left: 2 }}>•</span>{b.slice(0, 68)}…</div>)}
            </div>
          ))}
          {label === "Skills" && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0, 10).map((sk, i) => <span key={i} style={{ fontSize: 6.5, color: "#333" }}>· {sk}</span>)}</div>}
        </div>
      ))}
      {[["Education", R.education.map(e => `${e.degree} · ${e.school} · ${e.year}`).join("")],
        ["Certifications", R.certifications.map(c => `${c.name} · ${c.issuer} · ${c.year}`).join("")],
        ["Projects", R.projects[0]?.name || ""],
        ["Portfolio & Links", `🌐 ${R.personal.website} · in ${R.personal.linkedin}`]
      ].map(([label, val]) => val && (
        <div key={label} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "#111", borderBottom: `1px solid #E5E7EB`, paddingBottom: 2, marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: 6.5, color: "#555" }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

// ── Edge: dark indigo, bold left accent strip, modern ──
function MiniEdge() {
  const accent = "#818CF8"; const bg = "#0F0F23"; const strip = "#6366F1";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#E0E7FF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex" }}>
      <div style={{ width: 4, background: `linear-gradient(180deg, ${strip}, #4338CA)`, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ borderBottom: "1px solid #1E1B4B", paddingBottom: 8, marginBottom: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
          <div style={{ fontSize: 7.5, color: accent, fontWeight: 600, marginTop: 2 }}>{R.personal.title}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6.5, color: "#94A3B8" }}>{v}</span>)}
          </div>
        </div>
        <SectionBlock label="Profile" accent={accent}>
          <div style={{ fontSize: 7, color: "#94A3B8", lineHeight: 1.6 }}>{R.summary.slice(0, 120)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 7.5, color: "#fff" }}>{exp.role}</div>
              <div style={{ fontSize: 7, color: accent }}>{exp.company} · {exp.start}–{exp.end}</div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: "#94A3B8", paddingLeft: 7, position: "relative" }}><span style={{ position: "absolute", left: 1, color: accent }}>›</span>{b.slice(0, 65)}…</div>)}
            </div>
          ))}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
          {R.skills.slice(0, 8).map((sk, i) => <span key={i} style={{ background: "#1E1B4B", border: "1px solid #312E81", color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>{sk}</span>)}
        </div>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: "#94A3B8" }}>{e.degree} · {e.school} · {e.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: "#94A3B8" }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#fff" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: "#94A3B8" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── Flow: clean white, teal card-accented sections ──
function MiniFlow() {
  const accent = "#0891B2"; const strip = "#E0F7FA";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", color: "#0F172A", fontSize: 7.5, lineHeight: 1.45, padding: "14px 12px", height: "100%" }}>
      <div style={{ background: `linear-gradient(135deg, ${accent}, #0E7490)`, borderRadius: 8, padding: "12px 14px", marginBottom: 10, color: "#fff" }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: "#BAE6FD", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone].map((v, i) => <span key={i} style={{ fontSize: 6, color: "#E0F7FA" }}>{v}</span>)}
        </div>
      </div>
      <SectionBlock label="Summary" accent={accent}>
        <div style={{ fontSize: 7, color: "#64748B" }}>{R.summary.slice(0, 120)}…</div>
      </SectionBlock>
      <SectionBlock label="Experience" accent={accent}>
        {R.experience.slice(0, 2).map(exp => (
          <div key={exp.id} style={{ marginBottom: 5, background: strip, borderRadius: 4, padding: "4px 6px" }}>
            <div style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role}</div>
            <div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{exp.company} · {exp.start}–{exp.end}</div>
            {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: "#475569", marginTop: 2 }}>• {b.slice(0, 65)}…</div>)}
          </div>
        ))}
      </SectionBlock>
      <SectionBlock label="Skills" accent={accent}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {R.skills.slice(0, 9).map((sk, i) => <span key={i} style={{ background: strip, color: accent, fontSize: 6, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>{sk}</span>)}
        </div>
      </SectionBlock>
      <SectionBlock label="Education" accent={accent}>
        {R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: "#64748B" }}>{e.degree} · {e.school} · {e.year}</div>)}
      </SectionBlock>
      <SectionBlock label="Certifications" accent={accent}>
        {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: "#64748B" }}>{c.name} · {c.issuer} · {c.year}</div>)}
      </SectionBlock>
      <SectionBlock label="Projects" accent={accent}>
        {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
      </SectionBlock>
      <SectionBlock label="Portfolio & Links" accent={accent}>
        <div style={{ fontSize: 6.5, color: "#64748B" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
      </SectionBlock>
    </div>
  );
}

// ── Summit: corporate blue, horizontal band header ──
function MiniSummit() {
  const accent = "#1D4ED8"; const bg = "#EFF6FF"; const muted = "#4B5563";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", color: "#111827", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: `linear-gradient(135deg, #1D4ED8, #1E40AF)`, padding: "14px 16px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: "#BFDBFE", marginTop: 2, fontWeight: 500 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: "#DBEAFE" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7, background: bg }}>
        <SectionBlock label="Summary" accent={accent}>
          <div style={{ fontSize: 7, color: muted }}>{R.summary.slice(0, 120)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role}</span>
                <span style={{ fontSize: 6.5, color: "#9CA3AF" }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{exp.company}</div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 7, position: "relative" }}><span style={{ position: "absolute", left: 1, color: accent }}>›</span>{b.slice(0, 65)}…</div>)}
            </div>
          ))}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
          {R.skills.slice(0, 8).map((sk, i) => <span key={i} style={{ background: "#DBEAFE", color: accent, fontSize: 6, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>{sk}</span>)}
        </div>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── Prestige: warm ivory, burgundy accents, executive serif-inspired ──
function MiniPrestige() {
  const accent = "#7C2D12"; const muted = "#6B5747"; const rule = "#DDD0C8";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFBF5", color: "#1C0A00", fontSize: 7.5, lineHeight: 1.5, padding: "16px 14px", height: "100%" }}>
      <div style={{ textAlign: "center", borderBottom: `2px solid ${accent}`, paddingBottom: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "#1C0A00" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: accent, fontWeight: 500, marginTop: 2, letterSpacing: "0.08em" }}>{R.personal.title}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 4, fontSize: 6.5, color: muted }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i}>{v}</span>)}
        </div>
      </div>
      <SectionBlock label="Executive Summary" accent={accent}>
        <div style={{ fontSize: 7, color: muted, lineHeight: 1.65, borderLeft: `2px solid ${accent}`, paddingLeft: 6 }}>{R.summary.slice(0, 130)}…</div>
      </SectionBlock>
      <SectionBlock label="Experience" accent={accent}>
        {R.experience.slice(0, 2).map(exp => (
          <div key={exp.id} style={{ marginBottom: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 8 }}>{exp.role}</span>
              <span style={{ fontSize: 6.5, color: muted, fontStyle: "italic" }}>{exp.start}–{exp.end}</span>
            </div>
            <div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{exp.company}</div>
            {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 8, position: "relative" }}><span style={{ position: "absolute", left: 2 }}>—</span>{b.slice(0, 65)}…</div>)}
          </div>
        ))}
      </SectionBlock>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
        {R.skills.slice(0, 8).map((sk, i) => <span key={i} style={{ fontSize: 6.5, color: muted }}>· {sk}</span>)}
      </div>
      <SectionBlock label="Education" accent={accent}>
        {R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
      </SectionBlock>
      <SectionBlock label="Certifications" accent={accent}>
        {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
      </SectionBlock>
      <SectionBlock label="Projects" accent={accent}>
        {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7, color: "#1C0A00" }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
      </SectionBlock>
      <SectionBlock label="Portfolio & Links" accent={accent}>
        <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
      </SectionBlock>
    </div>
  );
}

// ── Spark: bold dark red, creative energy ──
function MiniSpark() {
  const accent = "#EF4444"; const bg = "#0C0C0C"; const muted = "#A3A3A3";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#FAFAFA", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 14px 10px", borderBottom: `3px solid ${accent}` }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-0.03em", color: "#FAFAFA" }}>{R.personal.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
          <div style={{ width: 20, height: 2, background: accent }} />
          <div style={{ fontSize: 7.5, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{R.personal.title}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: muted }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 7, color: "#A3A3A3", lineHeight: 1.6 }}>{R.summary.slice(0, 110)}…</div>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5, borderLeft: `2px solid ${accent}`, paddingLeft: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 8, color: "#FAFAFA" }}>{exp.role}</div>
              <div style={{ fontSize: 7, color: accent }}>{exp.company} · {exp.start}–{exp.end}</div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: muted }}>› {b.slice(0, 60)}…</div>)}
            </div>
          ))}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
          {R.skills.slice(0, 8).map((sk, i) => <span key={i} style={{ background: "#1A1A1A", border: `1px solid ${accent}44`, color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 3 }}>{sk}</span>)}
        </div>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#FAFAFA" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── Bloom: light purple, playful creative ──
function MiniBloom() {
  const accent = "#D946EF"; const bg = "#FDF4FF"; const muted = "#7E22CE";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#3B0764", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "linear-gradient(135deg, #D946EF, #9333EA)", padding: "14px 16px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: "#F3E8FF", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: "#E9D5FF" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: 7, color: "#6B21A8", lineHeight: 1.6 }}>{R.summary.slice(0, 110)}…</div>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 7.5, color: "#3B0764" }}>{exp.role}</div>
              <div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{exp.company} · {exp.start}–{exp.end}</div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: "#7E22CE", paddingLeft: 7, position: "relative" }}><span style={{ position: "absolute", left: 1 }}>✦</span>{b.slice(0, 60)}…</div>)}
            </div>
          ))}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
          {R.skills.slice(0, 8).map((sk, i) => <span key={i} style={{ background: "#F3E8FF", color: muted, fontSize: 6, padding: "1px 6px", borderRadius: 99, fontWeight: 600 }}>{sk}</span>)}
        </div>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: "#6B21A8" }}>{e.degree} · {e.school} · {e.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: "#6B21A8" }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#3B0764" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: "#6B21A8" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── Prism: purple gradient sidebar with photo ──
function MiniPrism({ photo } = {}) {
  const accent = "#A78BFA"; const sideBg = "#4C1D95"; const bg = "#F5F3FF";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex" }}>
      <div style={{ width: "36%", background: `linear-gradient(180deg, ${sideBg}, #5B21B6)`, padding: "14px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <PhotoAvatar photo={photo} name={R.personal.name} size={50} shape="circle" accent={accent} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 7.5, fontWeight: 800, color: "#EDE9FE", lineHeight: 1.2 }}>{R.personal.name}</div>
          <div style={{ fontSize: 6, color: accent, marginTop: 2 }}>{R.personal.title}</div>
        </div>
        <div style={{ height: 1, background: "#6D28D9", width: "100%" }} />
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", color: accent, marginBottom: 4 }}>Contact</div>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <div key={i} style={{ fontSize: 5.5, color: "#DDD6FE", marginBottom: 2 }}>{v}</div>)}
        </div>
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", color: accent, marginBottom: 4 }}>Skills</div>
          {R.skills.slice(0, 6).map((sk, i) => <div key={i} style={{ marginBottom: 3 }}>
            <div style={{ fontSize: 5.5, color: "#DDD6FE" }}>{sk}</div>
            <div style={{ height: 2, background: "#6D28D9", borderRadius: 99 }}><div style={{ height: "100%", background: accent, borderRadius: 99, width: `${65 + (i * 5) % 35}%` }} /></div>
          </div>)}
        </div>
      </div>
      <div style={{ flex: 1, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
        <SectionBlock label="Profile" accent={accent}>
          <div style={{ fontSize: 7, color: "#5B21B6", lineHeight: 1.6 }}>{R.summary.slice(0, 120)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 7.5, color: "#3B0764" }}>{exp.role}</div>
              <div style={{ fontSize: 7, color: accent }}>{exp.company} · {exp.start}–{exp.end}</div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: "#6B21A8", paddingLeft: 6 }}>• {b.slice(0, 60)}…</div>)}
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: "#5B21B6" }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#3B0764" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6.5, color: accent }}>{p.url}</div>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: "#5B21B6" }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── Lens: sky blue top band, photo top-center ──
function MiniLens({ photo } = {}) {
  const accent = "#0EA5E9"; const bg = "#F0F9FF"; const muted = "#64748B";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: `linear-gradient(135deg, #0EA5E9, #0369A1)`, padding: "14px 16px 18px", textAlign: "center", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <PhotoAvatar photo={photo} name={R.personal.name} size={46} shape="circle" accent="#fff" />
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7, color: "#BAE6FD", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 4 }}>
          {[R.personal.email, R.personal.phone].map((v, i) => <span key={i} style={{ fontSize: 5.5, color: "#E0F2FE" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, background: bg, display: "flex", flexDirection: "column", gap: 7 }}>
        <SectionBlock label="Summary" accent={accent}>
          <div style={{ fontSize: 7, color: muted }}>{R.summary.slice(0, 110)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 700, fontSize: 7.5 }}>{exp.role}</div>
              <div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{exp.company} · {exp.start}–{exp.end}</div>
              {exp.bullets.slice(0, 1).map((b, i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 6 }}>▸ {b.slice(0, 60)}…</div>)}
            </div>
          ))}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 7 }}>
          {R.skills.slice(0, 8).map((sk, i) => <span key={i} style={{ background: "#E0F2FE", color: "#0369A1", fontSize: 6, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>{sk}</span>)}
        </div>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>
          {R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6.5, color: accent }}> · {p.url}</span>}</div>)}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6.5, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── MiniRaviAxiom: Axiom style using RAVI_RESUME data (real resume showcase) ──
function MiniRaviAxiom() {
  const RV = R;
  const sh = { fontSize: 7, fontWeight: 800, color: "#111827", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1.5px solid #111827", paddingBottom: 2, marginBottom: 5 };
  const muted = "#4B5563"; const light = "#6B7280";
  const skillGroups = [
    { label: "Core Design", items: ["User Interface Design", "Design Systems", "High-Fidelity UI", "Responsive Design", "Accessibility"] },
    { label: "UX & Product", items: ["UX Research", "Information Architecture", "User Flows", "Wireframing", "Usability Testing"] },
    { label: "Technical", items: ["HTML5 / CSS3", "Design-to-Code", "Developer Handoff"] },
  ];
  const tools = ["Figma", "Adobe XD", "Photoshop", "Zeplin", "Axure", "Sketch", "Illustrator"];
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", fontSize: 7, lineHeight: 1.5, height: "100%", display: "flex" }}>

      {/* ── Left column: Contact · Skills · Tools · Certification ── */}
      <div style={{ width: "30%", padding: "12px 9px 12px 10px", borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 7 }}>

        {/* Contact */}
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, color: "#111827", marginBottom: 5 }}>CONTACT</div>
          {[{ icon: "☎", v: RV.personal.phone }, { icon: "✉", v: RV.personal.email }, { icon: "⊙", v: RV.personal.location }].map((c, i) => (
            <div key={i} style={{ fontSize: 5.5, color: muted, marginBottom: 3, display: "flex", gap: 3, alignItems: "flex-start" }}>
              <span style={{ color: light, flexShrink: 0 }}>{c.icon}</span>
              <span style={{ wordBreak: "break-all" }}>{c.v}</span>
            </div>
          ))}
        </div>

        {/* Skills */}
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, color: "#111827", marginBottom: 5 }}>Skills</div>
          {skillGroups.map(g => (
            <div key={g.label} style={{ marginBottom: 5 }}>
              <div style={{ fontSize: 6, fontWeight: 700, color: "#374151", marginBottom: 3 }}>{g.label}</div>
              {g.items.map(s => (
                <div key={s} style={{ fontSize: 5.5, color: muted, marginBottom: 2, paddingLeft: 7, position: "relative" }}>
                  <span style={{ position: "absolute", left: 1, color: light }}>•</span>{s}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Tools */}
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, color: "#111827", marginBottom: 5 }}>Tools</div>
          {tools.map(t => (
            <div key={t} style={{ fontSize: 5.5, color: muted, marginBottom: 2 }}>{t}</div>
          ))}
        </div>

        {/* Certification */}
        <div>
          <div style={{ fontSize: 7, fontWeight: 800, color: "#111827", marginBottom: 4 }}>Certification</div>
          <div style={{ fontSize: 5.5, color: muted }}>Certified Usability Analyst (CUA) from HFI</div>
        </div>
      </div>

      {/* ── Right column: Name · Summary · Key Impact · Experience ── */}
      <div style={{ flex: 1, padding: "12px 11px", display: "flex", flexDirection: "column", gap: 0 }}>

        {/* Name & title block */}
        <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#111827", letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "var(--font-display)" }}>{RV.personal.name}</div>
          <div style={{ fontSize: 6, color: muted, marginTop: 3, lineHeight: 1.4 }}>{RV.personal.title}</div>
          <div style={{ fontSize: 5.5, color: light, marginTop: 4 }}>{RV.personal.location} · Immediate Joiner</div>
          <div style={{ fontSize: 5.5, color: "#2563EB", marginTop: 3 }}>
            Portfolio: {RV.personal.website} · LinkedIn: {RV.personal.linkedin}
          </div>
        </div>

        {/* Summary */}
        <div style={{ marginBottom: 7 }}>
          <div style={sh}>Summary</div>
          <div style={{ fontSize: 6, color: muted, lineHeight: 1.6 }}>{RV.summary.slice(0, 145)}…</div>
        </div>

        {/* Experience */}
        <div style={{ marginBottom: 7 }}>
          <div style={sh}>Experience</div>
          {RV.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 6.5, fontWeight: 700, color: "#111827" }}>{exp.role}</div>
              <div style={{ fontSize: 5.5, color: light, marginBottom: 3 }}>{exp.company} · {exp.start}–{exp.end}</div>
              {exp.bullets.slice(0, 1).map((b, i) => (
                <div key={i} style={{ fontSize: 5.5, color: muted, paddingLeft: 7, position: "relative" }}>
                  <span style={{ position: "absolute", left: 1 }}>•</span>{b.slice(0, 75)}…
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Certifications */}
        <div>
          <div style={sh}>Certifications</div>
          {RV.certifications.map(c => (
            <div key={c.id} style={{ fontSize: 6, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniChronicle({ photo } = {}) {
  const accent = "#7C2D12"; const muted = "#4B5563"; const text = "#111827";
  const sh = { fontSize: 7, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1.5px solid ${accent}`, paddingBottom: 2, marginBottom: 5 };
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex" }}>
      {/* Left sidebar */}
      <div style={{ width: "30%", padding: "12px 9px", borderRight: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ fontSize: 6.5, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Contact</div>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => (
            <div key={i} style={{ fontSize: 5.5, color: muted, marginBottom: 3, wordBreak: "break-all" }}>{v}</div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 6.5, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Skills</div>
          {R.skills.slice(0, 8).map((sk, i) => (
            <div key={i} style={{ fontSize: 5.5, color: muted, marginBottom: 2.5, display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ color: accent }}>•</span>{sk}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 6.5, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Certification</div>
          {R.certifications.map(c => (
            <div key={c.id} style={{ fontSize: 5.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 6.5, fontWeight: 800, color: text, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Portfolio</div>
          <div style={{ fontSize: 5.5, color: "#2563EB" }}>🌐 {R.personal.website}</div>
        </div>
      </div>
      {/* Right content */}
      <div style={{ flex: 1, padding: "12px 10px" }}>
        {/* Name + photo header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8, paddingBottom: 7, borderBottom: "1px solid #E5E7EB" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, color: text, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{R.personal.name}</div>
            <div style={{ fontSize: 7, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{R.personal.title}</div>
            <div style={{ fontSize: 6, color: muted, marginTop: 3 }}>{R.personal.location}</div>
          </div>
          <PhotoAvatar photo={photo} name={R.personal.name} size={38} shape="circle" accent={accent} />
        </div>
        <SectionBlock label="Summary" accent={accent}>
          <div style={{ fontSize: 6.5, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0, 130)}…</div>
        </SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0, 2).map(exp => (
            <div key={exp.id} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 7, color: text }}>{exp.role}</span>
                <span style={{ fontSize: 6, color: muted }}>{exp.start}–{exp.end}</span>
              </div>
              <div style={{ fontSize: 6.5, color: accent, fontWeight: 600, marginBottom: 2 }}>{exp.company}</div>
              {exp.bullets.slice(0, 1).map((b, i) => (
                <div key={i} style={{ fontSize: 6, color: muted, paddingLeft: 7, position: "relative" }}>
                  <span style={{ position: "absolute", left: 1, color: accent }}>•</span>{b.slice(0, 65)}…
                </div>
              ))}
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Education" accent={accent}>
          {R.education.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 6.5 }}>
              <span style={{ fontWeight: 700 }}>{e.degree} · <span style={{ color: accent }}>{e.school}</span></span>
              <span style={{ color: muted }}>{e.year}</span>
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Projects" accent={accent}>
          {R.projects.slice(0, 1).map(p => (
            <div key={p.id}>
              <div style={{ fontWeight: 700, fontSize: 6.5, color: text }}>{p.name}</div>
              {p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}
            </div>
          ))}
        </SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}>
          <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>
        </SectionBlock>
      </div>
    </div>
  );
}

// ── Zen: ultra-minimal, centered name, thin rules, dark gray ──
function MiniZen() {
  const accent = "#374151"; const muted = "#6B7280"; const rule = "#E5E7EB";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FAFAFA", color: "#111", fontSize: 7.5, lineHeight: 1.6, padding: "16px 16px", height: "100%" }}>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 300, letterSpacing: "0.15em", textTransform: "uppercase", color: "#111" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7, color: muted, letterSpacing: "0.06em", marginTop: 3 }}>{R.personal.title}</div>
        <div style={{ height: 1, background: rule, margin: "7px 0" }} />
        <div style={{ display: "flex", justifyContent: "center", gap: 10, fontSize: 6, color: muted }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i}>{v}</span>)}
        </div>
      </div>
      {[["Summary", <div style={{ fontSize: 7, color: muted, lineHeight: 1.7 }}>{R.summary.slice(0,130)}…</div>],
        ["Experience", R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 600, fontSize: 7 }}>{e.role}</span><span style={{ fontSize: 6, color: muted }}>{e.start}–{e.end}</span></div><div style={{ fontSize: 6.5, color: accent }}>{e.company}</div></div>)],
        ["Skills", <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0,10).map((s, i) => <span key={i} style={{ fontSize: 6, color: muted }}>· {s}</span>)}</div>],
        ["Education", R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)],
        ["Certifications", R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)],
        ["Projects", R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)],
        ["Portfolio & Links", <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>],
      ].map(([label, content]) => (
        <div key={label} style={{ marginBottom: 7 }}>
          <div style={{ fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent, borderBottom: `0.5px solid ${rule}`, paddingBottom: 2, marginBottom: 4 }}>{label}</div>
          {content}
        </div>
      ))}
    </div>
  );
}

// ── Mono: monospace tech, blue accent, code-inspired ──
function MiniMono() {
  const accent = "#3B82F6"; const muted = "#374151"; const bg = "#F9FAFB";
  return (
    <div style={{ fontFamily: "monospace", background: bg, color: "#111", fontSize: 7, lineHeight: 1.6, padding: "14px 14px", height: "100%" }}>
      <div style={{ borderBottom: "2px solid #111", paddingBottom: 8, marginBottom: 9 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7, color: accent, marginTop: 1 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, fontSize: 6, color: muted, marginTop: 4, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i}>{v}</span>)}
        </div>
      </div>
      {[["// summary", <div style={{ fontSize: 7, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0,120)}…</div>],
        ["// experience", R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ fontWeight: 700, fontSize: 7 }}>{e.role} <span style={{ color: accent }}>@ {e.company}</span></div><div style={{ fontSize: 6, color: muted }}>{e.start}–{e.end}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6, color: muted, paddingLeft: 6 }}>{'>'} {b.slice(0,55)}…</div>)}</div>)],
        ["// skills", <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0,10).map((s, i) => <span key={i} style={{ background: "#E0F2FE", color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 2 }}>{s}</span>)}</div>],
        ["// education", R.education.map(e => <div key={e.id} style={{ fontSize: 6.5, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)],
        ["// certifications", R.certifications.map(c => <div key={c.id} style={{ fontSize: 6.5, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)],
        ["// projects", R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, color: accent, fontSize: 7 }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)],
        ["// links", <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>],
      ].map(([label, content]) => (
        <div key={label} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 6.5, fontWeight: 700, color: accent, marginBottom: 3 }}>{label}</div>
          {content}
        </div>
      ))}
    </div>
  );
}

// ── Nexus: dark teal-green, modern card layout ──
function MiniNexus() {
  const accent = "#10B981"; const bg = "#031D2E"; const muted = "#6EE7B7"; const surface = "#062532";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#E2FFF7", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: surface, borderBottom: `2px solid ${accent}`, padding: "14px 14px 10px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: accent, fontWeight: 700, marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: muted }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        {[["Summary", <div style={{ fontSize: 7, color: "#A7F3D0", lineHeight: 1.6 }}>{R.summary.slice(0,110)}…</div>],
          ["Experience", R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5, borderLeft: `2px solid ${accent}`, paddingLeft: 6 }}><div style={{ fontWeight: 700, fontSize: 7.5, color: "#fff" }}>{e.role}</div><div style={{ fontSize: 7, color: accent }}>{e.company} · {e.start}–{e.end}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted }}>› {b.slice(0,58)}…</div>)}</div>)],
          ["Skills", <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0,9).map((s, i) => <span key={i} style={{ background: "#052A1E", border: `1px solid ${accent}44`, color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 3 }}>{s}</span>)}</div>],
          ["Education", R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)],
          ["Certifications", R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)],
          ["Projects", R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#fff" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)],
          ["Portfolio", <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>],
        ].map(([l, c]) => <div key={l}><div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1px solid ${accent}33`, paddingBottom: 2, marginBottom: 4 }}>{l}</div>{c}</div>)}
      </div>
    </div>
  );
}

// ── Vector: dark indigo-black, electric blue, sharp grid ──
function MiniVector() {
  const accent = "#6366F1"; const bg = "#0D1117"; const muted = "#8B949E";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#E6EDF3", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 14px 10px", borderBottom: `1px solid #21262D` }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: accent, fontWeight: 600, marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.location, R.personal.github].filter(Boolean).map((v, i) => <span key={i} style={{ fontSize: 6, color: muted }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        {[["Profile", <div style={{ fontSize: 7, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0,110)}…</div>],
          ["Experience", R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 7.5, color: "#fff" }}>{e.role}</span><span style={{ fontSize: 6, color: muted }}>{e.start}–{e.end}</span></div><div style={{ fontSize: 7, color: accent }}>{e.company}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 6 }}>▸ {b.slice(0,60)}…</div>)}</div>)],
          ["Skills", <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>{R.skills.slice(0,9).map((s, i) => <span key={i} style={{ background: "#161B22", border: `1px solid #30363D`, color: "#C9D1D9", fontSize: 6, padding: "2px 4px", borderRadius: 3, textAlign: "center" }}>{s}</span>)}</div>],
          ["Education", R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)],
          ["Certifications", R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)],
          ["Projects", R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#fff" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)],
          ["Portfolio", <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>],
        ].map(([l, c]) => <div key={l}><div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1px solid #21262D`, paddingBottom: 2, marginBottom: 4 }}>{l}</div>{c}</div>)}
      </div>
    </div>
  );
}

// ── Atlas: dark navy + gold, executive prestige ──
function MiniAtlas() {
  const accent = "#C9A84C"; const bg = "#0F1B30"; const muted = "#94A3B8"; const gold = "#E8C97A";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#F1F5F9", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "linear-gradient(135deg,#0F1B30,#1B2A4A)", padding: "16px 16px 12px", borderBottom: `2px solid ${accent}` }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "#fff", letterSpacing: "0.03em", textTransform: "uppercase" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: gold, fontWeight: 500, letterSpacing: "0.1em", marginTop: 3 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: muted }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        {[["Executive Summary", <div style={{ fontSize: 7, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0,115)}…</div>],
          ["Experience", R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 7.5, color: "#fff" }}>{e.role}</span><span style={{ fontSize: 6, color: muted, fontStyle: "italic" }}>{e.start}–{e.end}</span></div><div style={{ fontSize: 7, color: gold, fontWeight: 600 }}>{e.company}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 8, position: "relative" }}><span style={{ position: "absolute", left: 2, color: accent }}>—</span>{b.slice(0,58)}…</div>)}</div>)],
          ["Skills", <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0,9).map((s, i) => <span key={i} style={{ background: "#1B2A4A", border: `1px solid ${accent}55`, color: gold, fontSize: 6, padding: "1px 6px", borderRadius: 3 }}>{s}</span>)}</div>],
          ["Education", R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)],
          ["Certifications", R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)],
          ["Projects", R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#fff" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: gold }}>{p.url}</div>}</div>)],
          ["Portfolio", <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>],
        ].map(([l, c]) => <div key={l}><div style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1px solid ${accent}44`, paddingBottom: 2, marginBottom: 4 }}>{l}</div>{c}</div>)}
      </div>
    </div>
  );
}

// ── Charter: clean blue corporate, two-tone header ──
function MiniCharter() {
  const accent = "#2563EB"; const muted = "#475569"; const bg = "#EFF6FF";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: `linear-gradient(135deg,#1D4ED8,#2563EB)`, padding: "14px 16px 12px" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: "#BFDBFE", fontWeight: 500, marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: "#DBEAFE" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, background: bg, display: "flex", flexDirection: "column", gap: 6 }}>
        <SectionBlock label="Summary" accent={accent}><div style={{ fontSize: 7, color: muted }}>{R.summary.slice(0,110)}…</div></SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 7.5 }}>{e.role}</span><span style={{ fontSize: 6, color: muted }}>{e.start}–{e.end}</span></div><div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{e.company}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 6 }}>› {b.slice(0,58)}…</div>)}</div>)}
        </SectionBlock>
        <SectionBlock label="Skills" accent={accent}><div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0,9).map((s, i) => <span key={i} style={{ background: "#DBEAFE", color: accent, fontSize: 6, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>{s}</span>)}</div></SectionBlock>
        <SectionBlock label="Education" accent={accent}>{R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}</SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>{R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}</SectionBlock>
        <SectionBlock label="Projects" accent={accent}>{R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6, color: accent }}> · {p.url}</span>}</div>)}</SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}><div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div></SectionBlock>
      </div>
    </div>
  );
}

// ── Crimson: dark editorial, bold red ──
function MiniCrimson() {
  const accent = "#E11D48"; const bg = "#0D0407"; const muted = "#A8A29E";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#FAFAF9", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 14px 10px", borderBottom: `3px solid ${accent}` }}>
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "-0.02em", color: "#FAFAF9" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 3 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: muted }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        {[["Profile", <div style={{ fontSize: 7, color: "#A8A29E", lineHeight: 1.6 }}>{R.summary.slice(0,110)}…</div>],
          ["Experience", R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5, borderLeft: `2px solid ${accent}`, paddingLeft: 6 }}><div style={{ fontWeight: 800, fontSize: 7.5, color: "#FAFAF9" }}>{e.role}</div><div style={{ fontSize: 7, color: accent }}>{e.company} · {e.start}–{e.end}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted }}>› {b.slice(0,58)}…</div>)}</div>)],
          ["Skills", <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{R.skills.slice(0,9).map((s, i) => <span key={i} style={{ background: "#1A0A0A", border: `1px solid ${accent}44`, color: accent, fontSize: 6, padding: "1px 5px", borderRadius: 3 }}>{s}</span>)}</div>],
          ["Education", R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)],
          ["Certifications", R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)],
          ["Projects", R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#FAFAF9" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)],
          ["Portfolio", <div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div>],
        ].map(([l, c]) => <div key={l}><div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}><div style={{ width: 14, height: 2, background: accent }} /><span style={{ fontSize: 7, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>{l}</span></div>{c}</div>)}
      </div>
    </div>
  );
}

// ── Halo: soft purple gradient, playful creative ──
function MiniHalo() {
  const accent = "#A855F7"; const bg = "#FAF5FF"; const muted = "#7E22CE";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: bg, color: "#3B0764", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "linear-gradient(135deg,#A855F7,#7C3AED,#5B21B6)", padding: "16px 16px 14px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7.5, color: "#E9D5FF", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: "#DDD6FE" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: 7, color: "#6B21A8", lineHeight: 1.6 }}>{R.summary.slice(0,110)}…</div>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ fontWeight: 700, fontSize: 7.5, color: "#3B0764" }}>{e.role}</div><div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{e.company} · {e.start}–{e.end}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 6 }}>✦ {b.slice(0,58)}…</div>)}</div>)}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 6 }}>{R.skills.slice(0,9).map((s, i) => <span key={i} style={{ background: "#F3E8FF", color: muted, fontSize: 6, padding: "1px 6px", borderRadius: 99, fontWeight: 600 }}>{s}</span>)}</div>
        <SectionBlock label="Education" accent={accent}>{R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}</SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>{R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}</SectionBlock>
        <SectionBlock label="Projects" accent={accent}>{R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#3B0764" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)}</SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}><div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div></SectionBlock>
      </div>
    </div>
  );
}

// ── Aura: soft purple, centered photo top, elegant ──
function MiniAura({ photo } = {}) {
  const accent = "#8B5CF6"; const bg = "#F5F3FF"; const muted = "#5B21B6";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFFFF", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "linear-gradient(180deg,#7C3AED 0%,#A855F7 100%)", padding: "16px 16px 20px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 7 }}>
          <PhotoAvatar photo={photo} name={R.personal.name} size={46} shape="circle" accent="#fff" />
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7, color: "#E9D5FF", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 4 }}>
          {[R.personal.email, R.personal.phone].map((v, i) => <span key={i} style={{ fontSize: 5.5, color: "#DDD6FE" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "10px 14px", flex: 1, background: bg, display: "flex", flexDirection: "column", gap: 6 }}>
        <SectionBlock label="Summary" accent={accent}><div style={{ fontSize: 7, color: muted }}>{R.summary.slice(0,100)}…</div></SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ fontWeight: 700, fontSize: 7.5 }}>{e.role}</div><div style={{ fontSize: 7, color: accent, fontWeight: 600 }}>{e.company} · {e.start}–{e.end}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 6 }}>• {b.slice(0,55)}…</div>)}</div>)}
        </SectionBlock>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>{R.skills.slice(0,8).map((s, i) => <span key={i} style={{ background: "#EDE9FE", color: muted, fontSize: 6, padding: "1px 6px", borderRadius: 99, fontWeight: 600 }}>{s}</span>)}</div>
        <SectionBlock label="Education" accent={accent}>{R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}</SectionBlock>
        <SectionBlock label="Certifications" accent={accent}>{R.certifications.map(c => <div key={c.id} style={{ fontSize: 7, color: muted }}>{c.name} · {c.issuer} · {c.year}</div>)}</SectionBlock>
        <SectionBlock label="Projects" accent={accent}>{R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 600, fontSize: 7 }}>{p.name}</span>{p.url && <span style={{ fontSize: 6, color: accent }}> · {p.url}</span>}</div>)}</SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}><div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div></SectionBlock>
      </div>
    </div>
  );
}

// ── Frame: dark sidebar with large square photo ──
function MiniFrame({ photo } = {}) {
  const accent = "#F59E0B"; const sideBg = "#111827"; const muted = "#9CA3AF";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#111827", fontSize: 7.5, lineHeight: 1.45, height: "100%", display: "flex" }}>
      <div style={{ width: "38%", background: "#0D1117", padding: "14px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <PhotoAvatar photo={photo} name={R.personal.name} size={52} shape="rounded" accent={accent} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>{R.personal.name}</div>
          <div style={{ fontSize: 6, color: accent, marginTop: 2 }}>{R.personal.title}</div>
        </div>
        <div style={{ height: 1, background: "#21262D", width: "100%" }} />
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", color: accent, marginBottom: 4 }}>Contact</div>
          {[R.personal.email, R.personal.phone, R.personal.location].map((v, i) => <div key={i} style={{ fontSize: 5.5, color: "#8B949E", marginBottom: 2, wordBreak: "break-all" }}>{v}</div>)}
        </div>
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", color: accent, marginBottom: 4 }}>Skills</div>
          {R.skills.slice(0,7).map((s, i) => <div key={i} style={{ fontSize: 5.5, color: "#8B949E", marginBottom: 2, display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 3, height: 3, borderRadius: "50%", background: accent, flexShrink: 0 }} />{s}</div>)}
        </div>
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", color: accent, marginBottom: 3 }}>Certification</div>
          {R.certifications.slice(0,1).map(c => <div key={c.id} style={{ fontSize: 5.5, color: "#8B949E" }}>{c.name}</div>)}
        </div>
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 6, fontWeight: 700, textTransform: "uppercase", color: accent, marginBottom: 3 }}>Portfolio</div>
          <div style={{ fontSize: 5.5, color: "#2F81F7" }}>🌐 {R.personal.website}</div>
        </div>
      </div>
      <div style={{ flex: 1, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
        <SectionBlock label="Profile" accent={accent}><div style={{ fontSize: 7, color: muted, lineHeight: 1.6 }}>{R.summary.slice(0,120)}…</div></SectionBlock>
        <SectionBlock label="Experience" accent={accent}>
          {R.experience.slice(0,2).map(e => <div key={e.id} style={{ marginBottom: 5 }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 7.5, color: "#fff" }}>{e.role}</span><span style={{ fontSize: 6, color: muted }}>{e.start}–{e.end}</span></div><div style={{ fontSize: 7, color: accent }}>{e.company}</div>{e.bullets.slice(0,1).map((b,i) => <div key={i} style={{ fontSize: 6.5, color: muted, paddingLeft: 6 }}>› {b.slice(0,58)}…</div>)}</div>)}
        </SectionBlock>
        <SectionBlock label="Education" accent={accent}>{R.education.map(e => <div key={e.id} style={{ fontSize: 7, color: muted }}>{e.degree} · {e.school} · {e.year}</div>)}</SectionBlock>
        <SectionBlock label="Projects" accent={accent}>{R.projects.slice(0,1).map(p => <div key={p.id}><span style={{ fontWeight: 700, fontSize: 7, color: "#fff" }}>{p.name}</span>{p.url && <div style={{ fontSize: 6, color: accent }}>{p.url}</div>}</div>)}</SectionBlock>
        <SectionBlock label="Portfolio & Links" accent={accent}><div style={{ fontSize: 6, color: muted }}>🌐 {R.personal.website} · in {R.personal.linkedin}</div></SectionBlock>
      </div>
    </div>
  );
}

const MINI_PREVIEWS = {
  apex: MiniApex, clarity: MiniClarity, axiom: MiniAxiom, nova: MiniNova,
  echo: MiniEcho, form: MiniForm,
  slate: MiniSlate, pure: MiniPure, edge: MiniEdge, flow: MiniFlow,
  summit: MiniSummit, prestige: MiniPrestige, spark: MiniSpark, bloom: MiniBloom,
  portrait: MiniPortrait, vista: MiniVista, pulse: MiniPulse, prism: MiniPrism, lens: MiniLens,
  zen: MiniZen, mono: MiniMono,
  nexus: MiniNexus, vector: MiniVector,
  atlas: MiniAtlas, charter: MiniCharter,
  crimson: MiniCrimson, halo: MiniHalo,
  aura: MiniAura, frame: MiniFrame,
};

// ─── COVER LETTER MINI PREVIEWS ──────────────────────────────────────────────

const CL_BODY_1 = "I am writing to express my strong interest in the Software Engineer position at your company. With 6+ years of experience building scalable systems and leading cross-functional teams, I am confident I would be a valuable addition.";
const CL_BODY_2 = "In my current role at Stripe, I architected a microservices migration that reduced p99 latency by 42%. I thrive in fast-paced environments and am passionate about clean architecture and developer experience.";
const CL_BODY_3 = "I am excited about the opportunity to bring my skills in TypeScript, Go, and distributed systems to your team. I look forward to discussing how I can contribute to your mission.";

function MiniCLClassic() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#fff", color: "#222", fontSize: 7, lineHeight: 1.55, height: "100%", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ borderBottom: "2px solid #1A56DB", paddingBottom: 10, marginBottom: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0F0F0F", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6.5, color: "#555", marginTop: 2 }}>{R.personal.email} · {R.personal.phone} · {R.personal.location}</div>
      </div>
      <div style={{ fontSize: 6.5, color: "#888" }}>June 2, 2026</div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 700, color: "#0F0F0F" }}>Hiring Manager</div>
        <div style={{ fontSize: 6.5, color: "#555" }}>Acme Corp · San Francisco, CA</div>
      </div>
      <div style={{ fontSize: 7, color: "#222" }}>Dear Hiring Manager,</div>
      <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_1}</div>
      <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_2}</div>
      <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_3}</div>
      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 7, color: "#222" }}>Sincerely,</div>
        <div style={{ fontSize: 8, fontWeight: 700, color: "#1A56DB", marginTop: 6 }}>{R.personal.name}</div>
      </div>
    </div>
  );
}

function MiniCLModern() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#F8FAFF", color: "#222", fontSize: 7, lineHeight: 1.55, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "linear-gradient(135deg,#1A56DB,#0EA5E9)", padding: "16px 18px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 7, color: "#BAE6FD", marginTop: 3 }}>{R.personal.title}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
          {[R.personal.email, R.personal.location].map((v, i) => <span key={i} style={{ fontSize: 6, color: "#E0F2FE" }}>{v}</span>)}
        </div>
      </div>
      <div style={{ padding: "12px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: 6.5, color: "#888" }}>June 2, 2026</div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 700 }}>Hiring Manager</div>
          <div style={{ fontSize: 6.5, color: "#555" }}>Acme Corp · San Francisco, CA</div>
        </div>
        <div style={{ fontSize: 7, fontWeight: 600, color: "#1A56DB" }}>Dear Hiring Manager,</div>
        <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_1}</div>
        <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_2}</div>
        <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_3}</div>
        <div style={{ marginTop: "auto", paddingTop: 6, borderTop: "1px solid #DBEAFE" }}>
          <div style={{ fontSize: 7, color: "#555" }}>Sincerely,</div>
          <div style={{ fontSize: 8, fontWeight: 800, color: "#1A56DB", marginTop: 4 }}>{R.personal.name}</div>
        </div>
      </div>
    </div>
  );
}

function MiniCLMinimal() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FAFAFA", color: "#222", fontSize: 7, lineHeight: 1.55, height: "100%", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#111", letterSpacing: "-0.02em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6, color: "#aaa" }}>June 2, 2026</div>
      </div>
      <div style={{ height: 1, background: "#E5E7EB", marginBottom: 2 }} />
      <div style={{ fontSize: 6.5, color: "#666" }}>{R.personal.email} · {R.personal.phone}</div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 600, color: "#111" }}>Acme Corp</div>
        <div style={{ fontSize: 6.5, color: "#888" }}>Hiring Manager · San Francisco, CA</div>
      </div>
      <div style={{ fontSize: 7 }}>Dear Hiring Manager,</div>
      <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_1}</div>
      <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_2}</div>
      <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_3}</div>
      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 7, color: "#555" }}>Best regards,</div>
        <div style={{ fontSize: 8, fontWeight: 700, color: "#111", marginTop: 5 }}>{R.personal.name}</div>
      </div>
    </div>
  );
}

function MiniCLCreative() {
  const accent = "#7C3AED";
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#fff", fontSize: 7, lineHeight: 1.55, height: "100%", display: "flex" }}>
      <div style={{ width: 28, background: "linear-gradient(180deg,#7C3AED,#A855F7)", flexShrink: 0 }} />
      <div style={{ flex: 1, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#3B0764", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
          <div style={{ fontSize: 6.5, color: accent, fontWeight: 600, marginTop: 2 }}>{R.personal.title}</div>
          <div style={{ fontSize: 6, color: "#888", marginTop: 3 }}>{R.personal.email} · {R.personal.phone}</div>
        </div>
        <div style={{ height: 1, background: "#EDE9FE" }} />
        <div style={{ fontSize: 6.5, color: "#888" }}>June 2, 2026</div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 700, color: "#3B0764" }}>Hiring Manager</div>
          <div style={{ fontSize: 6.5, color: "#888" }}>Acme Corp · San Francisco, CA</div>
        </div>
        <div style={{ fontSize: 7, fontWeight: 600, color: accent }}>Dear Hiring Manager,</div>
        <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_1}</div>
        <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_2}</div>
        <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_3}</div>
        <div style={{ marginTop: "auto", paddingTop: 6 }}>
          <div style={{ fontSize: 7, color: "#555" }}>Warm regards,</div>
          <div style={{ fontSize: 8, fontWeight: 800, color: accent, marginTop: 4 }}>{R.personal.name}</div>
        </div>
      </div>
    </div>
  );
}

function MiniCLExecutive() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#0F172A", color: "#E2E8F0", fontSize: 7, lineHeight: 1.55, height: "100%", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ paddingBottom: 10, borderBottom: "1px solid #1E293B" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6.5, color: "#F59E0B", fontWeight: 600, marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ fontSize: 6, color: "#64748B", marginTop: 3 }}>{R.personal.email} · {R.personal.phone} · {R.personal.location}</div>
      </div>
      <div style={{ fontSize: 6.5, color: "#475569" }}>June 2, 2026</div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 700, color: "#CBD5E1" }}>Hiring Manager</div>
        <div style={{ fontSize: 6.5, color: "#64748B" }}>Acme Corp · San Francisco, CA</div>
      </div>
      <div style={{ fontSize: 7, color: "#94A3B8" }}>Dear Hiring Manager,</div>
      <div style={{ fontSize: 6.5, color: "#94A3B8", lineHeight: 1.6 }}>{CL_BODY_1}</div>
      <div style={{ fontSize: 6.5, color: "#94A3B8", lineHeight: 1.6 }}>{CL_BODY_2}</div>
      <div style={{ fontSize: 6.5, color: "#94A3B8", lineHeight: 1.6 }}>{CL_BODY_3}</div>
      <div style={{ marginTop: "auto", paddingTop: 6, borderTop: "1px solid #1E293B" }}>
        <div style={{ fontSize: 7, color: "#64748B" }}>Sincerely,</div>
        <div style={{ fontSize: 8, fontWeight: 800, color: "#F59E0B", marginTop: 5 }}>{R.personal.name}</div>
      </div>
    </div>
  );
}

function MiniCLElegant() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFF9FB", fontSize: 7, lineHeight: 1.55, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#fff", borderBottom: "3px solid #EC4899", padding: "14px 18px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#831843", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
          <div style={{ fontSize: 6.5, color: "#EC4899", fontWeight: 600, marginTop: 2 }}>{R.personal.title}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 6, color: "#9D174D" }}>{R.personal.email}</div>
          <div style={{ fontSize: 6, color: "#9D174D" }}>{R.personal.location}</div>
        </div>
      </div>
      <div style={{ padding: "12px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 6.5, color: "#aaa" }}>June 2, 2026</div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 700, color: "#831843" }}>Hiring Manager</div>
          <div style={{ fontSize: 6.5, color: "#9D174D" }}>Acme Corp · San Francisco, CA</div>
        </div>
        <div style={{ fontSize: 7, fontWeight: 600, color: "#EC4899" }}>Dear Hiring Manager,</div>
        <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_1}</div>
        <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_2}</div>
        <div style={{ fontSize: 6.5, color: "#555", lineHeight: 1.6 }}>{CL_BODY_3}</div>
        <div style={{ marginTop: "auto", paddingTop: 6 }}>
          <div style={{ fontSize: 7, color: "#aaa" }}>With warm regards,</div>
          <div style={{ fontSize: 8, fontWeight: 800, color: "#EC4899", marginTop: 4 }}>{R.personal.name}</div>
        </div>
      </div>
    </div>
  );
}

function MiniCLTech() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#0D1117", fontSize: 7, lineHeight: 1.55, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#161B22", borderBottom: "2px solid #0EA5E9", padding: "14px 18px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#E6EDF3", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6.5, color: "#0EA5E9", fontWeight: 600, marginTop: 2, fontFamily: "monospace" }}>{R.personal.title}</div>
        <div style={{ fontSize: 6, color: "#8B949E", marginTop: 4 }}>{R.personal.email} · {R.personal.phone}</div>
      </div>
      <div style={{ padding: "12px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 6.5, color: "#30363D", fontFamily: "monospace" }}>// June 2, 2026</div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 700, color: "#C9D1D9" }}>Hiring Manager</div>
          <div style={{ fontSize: 6.5, color: "#8B949E" }}>Acme Corp · San Francisco, CA</div>
        </div>
        <div style={{ fontSize: 7, fontWeight: 600, color: "#0EA5E9" }}>Dear Hiring Manager,</div>
        <div style={{ fontSize: 6.5, color: "#8B949E", lineHeight: 1.6 }}>{CL_BODY_1}</div>
        <div style={{ fontSize: 6.5, color: "#8B949E", lineHeight: 1.6 }}>{CL_BODY_2}</div>
        <div style={{ fontSize: 6.5, color: "#8B949E", lineHeight: 1.6 }}>{CL_BODY_3}</div>
        <div style={{ marginTop: "auto", paddingTop: 6, borderTop: "1px solid #21262D" }}>
          <div style={{ fontSize: 7, color: "#30363D" }}>Sincerely,</div>
          <div style={{ fontSize: 8, fontWeight: 800, color: "#0EA5E9", marginTop: 4 }}>{R.personal.name}</div>
        </div>
      </div>
    </div>
  );
}

function MiniCLNature() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#F0FDF4", fontSize: 7, lineHeight: 1.55, height: "100%", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ paddingBottom: 10, borderBottom: "2px solid #16A34A" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#14532D", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6.5, color: "#16A34A", fontWeight: 600, marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ fontSize: 6, color: "#4B7C5A", marginTop: 3 }}>{R.personal.email} · {R.personal.phone} · {R.personal.location}</div>
      </div>
      <div style={{ fontSize: 6.5, color: "#86EFAC" }}>June 2, 2026</div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 700, color: "#14532D" }}>Hiring Manager</div>
        <div style={{ fontSize: 6.5, color: "#4B7C5A" }}>Acme Corp · San Francisco, CA</div>
      </div>
      <div style={{ fontSize: 7, color: "#14532D" }}>Dear Hiring Manager,</div>
      <div style={{ fontSize: 6.5, color: "#374151", lineHeight: 1.6 }}>{CL_BODY_1}</div>
      <div style={{ fontSize: 6.5, color: "#374151", lineHeight: 1.6 }}>{CL_BODY_2}</div>
      <div style={{ fontSize: 6.5, color: "#374151", lineHeight: 1.6 }}>{CL_BODY_3}</div>
      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 7, color: "#4B7C5A" }}>Best regards,</div>
        <div style={{ fontSize: 8, fontWeight: 700, color: "#16A34A", marginTop: 5 }}>{R.personal.name}</div>
      </div>
    </div>
  );
}

function MiniCLBold() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#fff", fontSize: 7, lineHeight: 1.55, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#DC2626", padding: "16px 18px 14px" }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em", textTransform: "uppercase" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6.5, color: "#FCA5A5", marginTop: 3 }}>{R.personal.title}</div>
      </div>
      <div style={{ padding: "12px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 6, color: "#aaa" }}>{R.personal.email} · {R.personal.phone} · June 2, 2026</div>
        <div>
          <div style={{ fontSize: 7, fontWeight: 700, color: "#111" }}>Hiring Manager</div>
          <div style={{ fontSize: 6.5, color: "#666" }}>Acme Corp · San Francisco, CA</div>
        </div>
        <div style={{ fontSize: 7, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.04em" }}>Dear Hiring Manager,</div>
        <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_1}</div>
        <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_2}</div>
        <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_3}</div>
        <div style={{ marginTop: "auto", borderTop: "2px solid #DC2626", paddingTop: 6 }}>
          <div style={{ fontSize: 7, color: "#888" }}>Sincerely,</div>
          <div style={{ fontSize: 8, fontWeight: 900, color: "#DC2626", marginTop: 4, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{R.personal.name}</div>
        </div>
      </div>
    </div>
  );
}

function MiniCLAcademic() {
  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: "#FFFBF5", fontSize: 7, lineHeight: 1.6, height: "100%", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ textAlign: "center", paddingBottom: 8, borderBottom: "1px solid #D97706" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#78350F", letterSpacing: "0.04em", textTransform: "uppercase" }}>{R.personal.name}</div>
        <div style={{ fontSize: 6.5, color: "#B45309", marginTop: 2 }}>{R.personal.title}</div>
        <div style={{ fontSize: 6, color: "#92400E", marginTop: 2 }}>{R.personal.email} · {R.personal.phone} · {R.personal.location}</div>
      </div>
      <div style={{ fontSize: 6.5, color: "#aaa", textAlign: "right" }}>June 2, 2026</div>
      <div>
        <div style={{ fontSize: 7, fontWeight: 600, color: "#78350F" }}>Hiring Manager</div>
        <div style={{ fontSize: 6.5, color: "#92400E" }}>Acme Corp · San Francisco, CA</div>
      </div>
      <div style={{ fontSize: 7, color: "#111" }}>Dear Hiring Manager,</div>
      <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_1}</div>
      <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_2}</div>
      <div style={{ fontSize: 6.5, color: "#444", lineHeight: 1.6 }}>{CL_BODY_3}</div>
      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 7, color: "#92400E" }}>Respectfully yours,</div>
        <div style={{ fontSize: 8, fontWeight: 700, color: "#78350F", marginTop: 4 }}>{R.personal.name}</div>
      </div>
    </div>
  );
}

// nameDefault mirrors each template's own hardcoded `nameC` fallback in
// CoverLetterPreview — used so the color customizer's "Template default"
// swatch shows (and, when picked, actually means) that template's real
// name color instead of a one-size-fits-all white that doesn't match most
// templates and made the default swatch lie about what it would apply.
const COVER_LETTER_TEMPLATES = [
  { id: "cl-classic",   name: "Classic",   tag: "Professional", accent: "#1A56DB", preview: MiniCLClassic,   nameDefault: "#0F0F0F" },
  { id: "cl-modern",    name: "Modern",    tag: "Contemporary", accent: "#0EA5E9", preview: MiniCLModern,    nameDefault: "#FFFFFF" },
  { id: "cl-minimal",   name: "Minimal",   tag: "Clean",        accent: "#6B7280", preview: MiniCLMinimal,   nameDefault: "#111111" },
  { id: "cl-creative",  name: "Creative",  tag: "Bold",         accent: "#7C3AED", preview: MiniCLCreative,  nameDefault: "#3B0764" },
  { id: "cl-executive", name: "Executive", tag: "Corporate",    accent: "#F59E0B", preview: MiniCLExecutive, nameDefault: "#FFFFFF" },
  { id: "cl-elegant",   name: "Elegant",   tag: "Sophisticated", accent: "#EC4899", preview: MiniCLElegant,  nameDefault: "#831843" },
  { id: "cl-tech",      name: "Tech",      tag: "Developer",    accent: "#0EA5E9", preview: MiniCLTech,      nameDefault: "#E6EDF3" },
  { id: "cl-nature",    name: "Nature",    tag: "Fresh",        accent: "#16A34A", preview: MiniCLNature,    nameDefault: "#14532D" },
  { id: "cl-bold",      name: "Bold",      tag: "Impact",       accent: "#DC2626", preview: MiniCLBold,      nameDefault: "#FFFFFF" },
  { id: "cl-academic",  name: "Academic",  tag: "Formal",       accent: "#B45309", preview: MiniCLAcademic,  nameDefault: "#78350F" },
];

// ─── TEMPLATES PAGE ───────────────────────────────────────────────────────────

function TemplatesPage({ setPage, onSelectTemplate, currentTemplate = "clarity", user, onNeedUpgrade, onSelectCoverLetterTemplate }) {
  const premium = isPremium(user);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [hovered, setHovered] = useState(null);
  const [previewing, setPreviewing] = useState(null); // template id being previewed
  const [docType, setDocType] = useState("resume"); // "resume" | "coverletter"
  const filters = ["all", "minimal", "modern", "corporate", "creative", "with photo"];

  const filteredTemplates = TEMPLATES.filter(t => {
    if (filter === "all") return true;
    if (filter === "minimal") return ["clarity","form","slate","pure","zen","mono"].includes(t.id);
    if (filter === "modern") return ["apex","echo","edge","flow","nexus","vector"].includes(t.id);
    if (filter === "corporate") return ["axiom","form","summit","prestige","atlas","charter"].includes(t.id);
    if (filter === "creative") return ["nova","axiom","spark","bloom","crimson","halo"].includes(t.id);
    if (filter === "with photo") return t.photo === true;
    return true;
  });

  const selectedTpl = TEMPLATES.find(t => t.id === selected);

  return (
    <div className="app-bg" style={{ minHeight: "100vh", padding: "40px 20px", paddingBottom: selected ? 100 : 40 }}>
      <div style={{ padding: "0 24px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, margin: "0 0 12px" }}>
            Pick your perfect template
          </h1>
          <p className="app-text2" style={{ fontSize: 17, maxWidth: 480, margin: "0 auto 28px" }}>
            ATS-optimized, recruiter-approved, and fully customizable.
          </p>

          {/* Resume / Cover Letter switcher */}
          <div style={{ display: "inline-flex", background: "var(--c-surface)", border: "1.5px solid var(--c-border)", borderRadius: 12, padding: 4, gap: 4, marginBottom: 24 }}>
            {[
              { id: "resume",      label: "Resume",       icon: <Icon.FileText size="16" /> },
              { id: "coverletter", label: "Cover Letter", icon: <Icon.FileText size="16" /> },
            ].map(({ id, label, icon }) => (
              <button key={id} onClick={() => { setDocType(id); setSelected(""); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "8px 20px",
                  borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "var(--font-body)",
                  fontSize: 14, fontWeight: 700, transition: "all 0.18s",
                  background: docType === id ? "var(--c-accent)" : "transparent",
                  color: docType === id ? "#fff" : "var(--c-text2)",
                  boxShadow: docType === id ? "0 2px 8px rgba(26,86,219,0.25)" : "none",
                }}>
                {icon} {label}
              </button>
            ))}
          </div>

          {/* Style filters — only for resumes */}
          {docType === "resume" && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {filters.map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={f === filter ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                  style={{ textTransform: "capitalize" }}>
                  {f}
                </button>
              ))}
            </div>
          )}

          {docType === "resume" && (
            <div className="badge badge-blue" style={{ marginTop: 16, fontSize: 13 }}>29 professional templates</div>
          )}
        </div>

        {/* Resume template grid */}
        {docType === "resume" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
          {filteredTemplates.map(t => {
            const MiniPreview = MINI_PREVIEWS[t.id];
            const isSelected = selected === t.id;
            const isHovered = hovered === t.id;
            return (
              <div key={t.id}
                onMouseEnter={() => setHovered(t.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(t.id)}
                style={{
                  borderRadius: 14, overflow: "hidden", cursor: "pointer",
                  border: isSelected ? "2.5px solid var(--c-accent)" : "2px solid var(--c-border)",
                  boxShadow: isSelected
                    ? "0 0 0 3px var(--c-glow), 0 20px 48px var(--c-shadow)"
                    : isHovered
                      ? "0 12px 36px var(--c-shadow)"
                      : "0 2px 8px var(--c-shadow)",
                  transform: isHovered && !isSelected ? "translateY(-3px)" : "translateY(0)",
                  transition: "all 0.2s ease",
                  position: "relative",
                }}>
                {/* Mini resume preview */}
                <div style={{ height: 340, overflow: "hidden", position: "relative" }}>
                  <div style={{ transform: "scale(1)", transformOrigin: "top left", height: "100%" }}>
                    {MiniPreview && (t.photo ? <MiniPreview photo={DUMMY_AVATAR} /> : <MiniPreview />)}
                  </div>
                  {/* Gradient fade at bottom */}
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
                    background: `linear-gradient(transparent, ${t.bg === "#0F172A" || t.bg === "#0F0F0F" || t.bg === "#0A0A0A" ? "#0F172A" : t.bg === "#F0F9FF" ? "#F0F9FF" : t.bg === "#FAFAF9" ? "#FAFAF9" : "#ffffff"})`,
                    pointerEvents: "none",
                  }} />
                  {isSelected && (
                    <div style={{
                      position: "absolute", top: 12, left: 12,
                      width: 26, height: 26, borderRadius: "50%",
                      background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", boxShadow: "0 2px 8px rgba(26,86,219,0.4)",
                    }}>
                      <Icon.Check size="3" />
                    </div>
                  )}
                  {isHovered && !isSelected && (
                    <div style={{
                      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(0,0,0,0.18)", backdropFilter: "blur(1px)",
                    }}>
                      <div style={{
                        background: "#fff", color: "var(--c-accent)", fontWeight: 700, fontSize: 13,
                        padding: "8px 20px", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                        fontFamily: "var(--font-body)",
                      }}>
                        Select Template
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div style={{
                  padding: "12px 16px 14px",
                  background: "var(--c-surface)",
                  borderTop: `1px solid var(--c-border)`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div className="font-display" style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
                      {t.photo && <span style={{ fontSize: 12 }}>📸</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span className="badge badge-green" style={{ fontSize: 10 }}>ATS ✓</span>
                      {t.photo
                        ? <span style={{ background: "#FDF4FF", color: "#9333EA", border: "1px solid #E9D5FF", fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>📸 Photo</span>
                        : <span className="badge badge-gray" style={{ fontSize: 10 }}>{t.tag}</span>
                      }
                    </div>
                  </div>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />
                </div>
              </div>
            );
          })}

          {/* ── Ravi's Real Resume — inside the same grid as all other cards ── */}
          <div
            onMouseEnter={() => setHovered("ravi")}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setSelected("ravi")}
            style={{
              borderRadius: 14, overflow: "hidden", cursor: "pointer",
              border: selected === "ravi" ? "2.5px solid var(--c-accent)" : hovered === "ravi" ? "2px solid #7C3AED" : "2px solid var(--c-border)",
              boxShadow: selected === "ravi"
                ? "0 0 0 3px var(--c-glow), 0 20px 48px var(--c-shadow)"
                : hovered === "ravi" ? "0 12px 36px var(--c-shadow)" : "0 2px 8px var(--c-shadow)",
              transform: hovered === "ravi" && selected !== "ravi" ? "translateY(-3px)" : "translateY(0)",
              transition: "all 0.2s ease",
              position: "relative",
            }}>
            <div style={{ height: 340, overflow: "hidden", position: "relative" }}>
              <div style={{ transform: "scale(1)", transformOrigin: "top left", height: "100%" }}>
                <MiniRaviAxiom />
              </div>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 60%, #ffffff)", pointerEvents: "none" }} />
              {selected === "ravi" && (
                <div style={{ position: "absolute", top: 10, left: 10, width: 26, height: 26, borderRadius: "50%", background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 2px 8px rgba(26,86,219,0.4)" }}>
                  <Icon.Check size="3" />
                </div>
              )}
            </div>
            <div style={{ padding: "14px 16px", background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div className="font-display" style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Chronicle · Executive</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <span className="badge badge-green" style={{ fontSize: 10 }}>ATS ✓</span>
                  <span style={{ background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE", fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>Corporate</span>
                </div>
              </div>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#7C3AED", flexShrink: 0 }} />
            </div>
          </div>
        </div>}

        {/* Cover letter template grid — always visible below the tab row */}
        <div style={{ marginTop: 16, marginBottom: 24, textAlign: "center" }}>
          <div className="badge badge-blue" style={{ fontSize: 13 }}>{COVER_LETTER_TEMPLATES.length} cover letter templates</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
            {COVER_LETTER_TEMPLATES.map(t => {
              const isSelected = selected === t.id;
              const isHovered = hovered === t.id;
              const Preview = t.preview;
              return (
                <div key={t.id}
                  onMouseEnter={() => setHovered(t.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(t.id)}
                  style={{
                    borderRadius: 14, overflow: "hidden", cursor: "pointer",
                    border: isSelected ? "2.5px solid var(--c-accent)" : "2px solid var(--c-border)",
                    boxShadow: isSelected
                      ? "0 0 0 3px var(--c-glow), 0 20px 48px var(--c-shadow)"
                      : isHovered ? "0 12px 36px var(--c-shadow)" : "0 2px 8px var(--c-shadow)",
                    transform: isHovered && !isSelected ? "translateY(-3px)" : "translateY(0)",
                    transition: "all 0.2s ease",
                    position: "relative",
                  }}>
                  <div style={{ height: 340, overflow: "hidden", position: "relative" }}>
                    <Preview />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(transparent, #ffffff)", pointerEvents: "none" }} />
                    {isSelected && (
                      <div style={{ position: "absolute", top: 12, left: 12, width: 26, height: 26, borderRadius: "50%", background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 2px 8px rgba(26,86,219,0.4)" }}>
                        <Icon.Check size="3" />
                      </div>
                    )}
                    {isHovered && !isSelected && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.18)", backdropFilter: "blur(1px)" }}>
                        <div style={{ background: "#fff", color: "var(--c-accent)", fontWeight: 700, fontSize: 13, padding: "8px 20px", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", fontFamily: "var(--font-body)" }}>
                          Select Template
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "12px 16px 14px", background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div className="font-display" style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t.name}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span className="badge badge-green" style={{ fontSize: 10 }}>ATS ✓</span>
                        <span className="badge badge-gray" style={{ fontSize: 10 }}>{t.tag}</span>
                      </div>
                    </div>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />
                  </div>
                </div>
              );
            })}
          </div>

        {/* CTA bar for cover letter template */}
        {COVER_LETTER_TEMPLATES.some(t => t.id === selected) && (() => {
          const clTpl = COVER_LETTER_TEMPLATES.find(t => t.id === selected);
          const Preview = clTpl?.preview;
          return (
            <div className="fade-in" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", boxShadow: "0 -4px 24px var(--c-shadow)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 40, height: 48, borderRadius: 6, overflow: "hidden", border: "1px solid var(--c-border)", flexShrink: 0 }}>
                  <div style={{ transform: "scale(0.13)", transformOrigin: "top left", width: "770%", height: "770%", pointerEvents: "none" }}>
                    {Preview && <Preview />}
                  </div>
                </div>
                <div>
                  <div className="font-display" style={{ fontWeight: 800, fontSize: 17 }}>{clTpl?.name} Cover Letter selected</div>
                  <div className="app-text2" style={{ fontSize: 13 }}>ATS-safe · {clTpl?.tag} · Fully editable</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-secondary btn-lg" onClick={() => setSelected("")}>Change</button>
                <button className="btn btn-primary btn-lg" onClick={() => { onSelectCoverLetterTemplate?.(selected); setPage(PAGES.COVER_LETTER); }}>
                  Use This Template <Icon.ArrowRight />
                </button>
              </div>
            </div>
          );
        })()}

        {/* CTA bar — fixed at bottom, appears only after user picks a template */}
        {docType === "resume" && selected === "ravi" && (
          <div className="fade-in" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", boxShadow: "0 -4px 24px var(--c-shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 40, height: 48, borderRadius: 6, overflow: "hidden", border: "1px solid var(--c-border)", flexShrink: 0 }}>
                <div style={{ transform: "scale(0.13)", transformOrigin: "top left", width: "770%", height: "770%", pointerEvents: "none" }}><MiniRaviAxiom /></div>
              </div>
              <div>
                <div className="font-display" style={{ fontWeight: 800, fontSize: 17 }}>Chronicle template selected</div>
                <div className="app-text2" style={{ fontSize: 13 }}>ATS-safe · Corporate · Fully editable</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary btn-lg" onClick={() => setSelected("")}>Change</button>
              <button className="btn btn-primary btn-lg" onClick={() => { onSelectTemplate?.("chronicle"); setPage(PAGES.BUILDER); }}>
                Use This Template <Icon.ArrowRight />
              </button>
            </div>
          </div>
        )}

        {/* CTA bar — fixed at bottom, appears only after user picks a resume template */}
        {docType === "resume" && selected && (
          <div className="fade-in" style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
            padding: "16px 32px",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16,
            background: "var(--c-surface)",
            borderTop: "1px solid var(--c-border)",
            boxShadow: "0 -4px 24px var(--c-shadow)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 40, height: 48, borderRadius: 6, overflow: "hidden", border: "1px solid var(--c-border)", flexShrink: 0 }}>
                <div style={{ transform: "scale(0.13)", transformOrigin: "top left", width: "770%", height: "770%", pointerEvents: "none" }}>
                  {(() => { const C = MINI_PREVIEWS[selected]; const tpl = TEMPLATES.find(t=>t.id===selected); return C ? (tpl?.photo ? <C photo={DUMMY_AVATAR}/> : <C/>) : null; })()}
                </div>
              </div>
              <div>
                <div className="font-display" style={{ fontWeight: 800, fontSize: 17 }}>
                  {selectedTpl?.name} template selected
                </div>
                <div className="app-text2" style={{ fontSize: 13 }}>ATS-safe · {selectedTpl?.tag} · Fully editable</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary btn-lg" onClick={() => setSelected("")}>Change</button>
              <button className="btn btn-primary btn-lg" onClick={() => { onSelectTemplate?.(selected); setPage(PAGES.BUILDER); }}>
                Use This Template <Icon.ArrowRight />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COVER LETTER PREVIEW ────────────────────────────────────────────────────

function CoverLetterPreview({ cl = {}, personal = {}, templateId = "cl-classic", customAccent = "", customBg = "", customText = "", customMuted = "", customNameColor = "", hiddenFields = new Set() }) {
  // Prefer cover letter sender overrides, fall back to resume personal data
  const name   = (cl.senderName     || personal.name     || "Your Name");
  const pTitle = (cl.senderTitle    || personal.title    || "Professional Title");
  const email  = (cl.senderEmail    || personal.email    || "");
  const phone  = (cl.senderPhone    || personal.phone    || "");
  const loc    = (cl.senderLocation || personal.location || "");
  const contacts = [email, phone, loc].filter(Boolean).join(" · ");

  const date = cl.date || "";
  const recName = cl.recipientName || "Hiring Manager";
  const recTitle = cl.recipientTitle || "";
  const company = cl.company || "";
  const role = cl.role || "";
  const salutation = cl.salutation || "Dear Hiring Manager,";
  const opening = cl.opening || "";
  const body = cl.body || "";
  const closing = cl.closing || "";
  const signoff = cl.signoff || "Sincerely,";

  const ph = (text, label, bodyColor, fieldKey) => {
    if (fieldKey && hiddenFields.has(fieldKey)) return null;
    return text
      ? <p style={{ marginBottom: 16, fontSize: 11, lineHeight: 1.85, color: bodyColor || "#333" }}>{text}</p>
      : <p style={{ marginBottom: 16, fontSize: 11, lineHeight: 1.85, color: "#ccc", fontStyle: "italic" }}>{label}</p>;
  };
  const showSignoff = !hiddenFields.has("signoff");

  const RecipientBlock = ({ textColor = "#333", mutedColor = "#888" }) => (
    <div style={{ marginBottom: 20 }}>
      {date && <div style={{ fontSize: 11, color: mutedColor, marginBottom: 16 }}>{date}</div>}
      <div style={{ fontWeight: 600, fontSize: 11, color: textColor }}>{recName}{recTitle ? `, ${recTitle}` : ""}</div>
      {company && <div style={{ fontSize: 11, color: mutedColor }}>{company}</div>}
      {role && <div style={{ fontSize: 11, color: mutedColor }}>{role}</div>}
    </div>
  );

  if (templateId === "cl-modern") {
    const accent = customAccent || "#1A56DB";
    const bg = customBg || "#F8FAFF";
    const textC = customText || "#1F2937";
    const mutedC = customMuted || "#6B7280";
    const nameC = customNameColor || "#fff";
    return (
      <div style={{ minHeight: 700, fontFamily: "'Poppins',sans-serif" }}>
        <div style={{ background: `linear-gradient(135deg,${accent},${accent}cc)`, padding: "32px 44px 28px" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
          <div style={{ fontSize: 13, color: `${nameC}bb`, marginTop: 5 }}>{pTitle}</div>
          <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
            {[email, phone, loc].filter(Boolean).map((v, i) => <span key={i} style={{ fontSize: 11, color: `${nameC}99` }}>{v}</span>)}
          </div>
        </div>
        <div style={{ background: bg, padding: "32px 44px", minHeight: 500, color: textC }}>
          <RecipientBlock textColor={textC} mutedColor={mutedC} />
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 18, color: accent }}>{salutation}</div>
          {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
          {ph(body, "Your main body paragraph will appear here…", textC, "body")}
          {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
          {showSignoff && <div style={{ fontSize: 12, color: mutedC, marginTop: 4 }}>{signoff}</div>}
          <div style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 24 }}>{name}</div>
          <div style={{ borderTop: `1px solid ${accent}33`, marginTop: 24, paddingTop: 14, fontSize: 11, color: mutedC }}>{contacts}</div>
        </div>
      </div>
    );
  }

  if (templateId === "cl-minimal") {
    const bg = customBg || "#FAFAFA";
    const nameC = customNameColor || "#111";
    const textC = customText || "#222";
    const mutedC = customMuted || "#666";
    const accent = customAccent || "#374151";
    return (
      <div style={{ background: bg, padding: "48px 56px", minHeight: 700, fontFamily: "'Poppins',sans-serif", color: textC }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: nameC, letterSpacing: "-0.02em" }}>{name}</div>
          {date && <div style={{ fontSize: 11, color: mutedC }}>{date}</div>}
        </div>
        <div style={{ height: 1, background: accent + "44", marginBottom: 18 }} />
        <div style={{ fontSize: 11, color: mutedC, marginBottom: 28 }}>{contacts}</div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: textC }}>{recName}{recTitle ? `, ${recTitle}` : ""}</div>
          {company && <div style={{ fontSize: 11, color: mutedC }}>{company}</div>}
          {role && <div style={{ fontSize: 11, color: mutedC }}>{role}</div>}
        </div>
        <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 18, color: textC }}>{salutation}</div>
        {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
        {ph(body, "Your main body paragraph will appear here…", textC, "body")}
        {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
        {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
        <div style={{ fontSize: 15, fontWeight: 700, color: nameC, marginTop: 28 }}>{name}</div>
      </div>
    );
  }

  if (templateId === "cl-creative") {
    const accent = customAccent || "#7C3AED";
    const bg = customBg || "#fff";
    const nameC = customNameColor || "#3B0764";
    const textC = customText || "#333";
    const mutedC = customMuted || "#888";
    return (
      <div style={{ minHeight: 700, fontFamily: "'Poppins',sans-serif", display: "flex" }}>
        <div style={{ width: 36, background: `linear-gradient(180deg,${accent},${accent}aa)`, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: "40px 44px", background: bg, color: textC }}>
          <div style={{ marginBottom: 24, paddingBottom: 18, borderBottom: `1px solid ${accent}33` }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
            <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginTop: 5 }}>{pTitle}</div>
            <div style={{ fontSize: 11, color: mutedC, marginTop: 8 }}>{contacts}</div>
          </div>
          <RecipientBlock textColor={nameC} mutedColor={mutedC} />
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 18, color: accent }}>{salutation}</div>
          {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
          {ph(body, "Your main body paragraph will appear here…", textC, "body")}
          {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
          {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
          <div style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 28 }}>{name}</div>
        </div>
      </div>
    );
  }

  if (templateId === "cl-executive") {
    const bg = customBg || "#0F172A";
    const accent = customAccent || "#F59E0B";
    const nameC = customNameColor || "#fff";
    const textC = customText || "#CBD5E1";
    const mutedC = customMuted || "#64748B";
    const bodyC = customText || "#94A3B8";
    return (
      <div style={{ background: bg, padding: "44px 52px", minHeight: 700, fontFamily: "'Poppins',sans-serif" }}>
        <div style={{ borderBottom: `1px solid ${mutedC}44`, paddingBottom: 22, marginBottom: 26 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
          <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginTop: 5 }}>{pTitle}</div>
          <div style={{ fontSize: 11, color: mutedC, marginTop: 8 }}>{contacts}</div>
        </div>
        <RecipientBlock textColor={textC} mutedColor={mutedC} />
        <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 18, color: bodyC }}>{salutation}</div>
        {ph(opening, "Your opening paragraph will appear here…", bodyC, "opening")}
        {ph(body, "Your main body paragraph will appear here…", bodyC, "body")}
        {ph(closing, "Your closing paragraph will appear here…", bodyC, "closing")}
        <div style={{ borderTop: `1px solid ${mutedC}44`, paddingTop: 18 }}>
          {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
          <div style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 24 }}>{name}</div>
        </div>
      </div>
    );
  }

  if (templateId === "cl-elegant") {
    const accent = customAccent || "#EC4899";
    const bg = customBg || "#FFF9FB";
    const nameC = customNameColor || "#831843";
    const textC = customText || "#333";
    const mutedC = customMuted || "#9D174D";
    return (
      <div style={{ minHeight: 700, fontFamily: "'Poppins',sans-serif", background: bg }}>
        <div style={{ background: "#fff", borderBottom: `3px solid ${accent}`, padding: "28px 44px 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
            <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginTop: 5 }}>{pTitle}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: mutedC }}>
            <div>{email}</div>
            <div>{phone}</div>
            <div>{loc}</div>
          </div>
        </div>
        <div style={{ padding: "32px 44px", color: textC }}>
          <RecipientBlock textColor={nameC} mutedColor={mutedC} />
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 18, color: accent }}>{salutation}</div>
          {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
          {ph(body, "Your main body paragraph will appear here…", textC, "body")}
          {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
          {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
          <div style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 28 }}>{name}</div>
        </div>
      </div>
    );
  }

  if (templateId === "cl-tech") {
    const accent = customAccent || "#0EA5E9";
    const bg = customBg || "#0D1117";
    const nameC = customNameColor || "#E6EDF3";
    const textC = customText || "#C9D1D9";
    const mutedC = customMuted || "#8B949E";
    return (
      <div style={{ background: bg, minHeight: 700, fontFamily: "'Poppins',sans-serif" }}>
        <div style={{ background: "#161B22", borderBottom: `2px solid ${accent}`, padding: "28px 44px 22px" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
          <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginTop: 5, fontFamily: "monospace" }}>{pTitle}</div>
          <div style={{ fontSize: 11, color: mutedC, marginTop: 8 }}>{contacts}</div>
        </div>
        <div style={{ padding: "32px 44px", color: textC }}>
          {date && <div style={{ fontSize: 11, color: "#30363D", fontFamily: "monospace", marginBottom: 20 }}>// {date}</div>}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 11, color: textC }}>{recName}{recTitle ? `, ${recTitle}` : ""}</div>
            {company && <div style={{ fontSize: 11, color: mutedC }}>{company}</div>}
            {role && <div style={{ fontSize: 11, color: mutedC }}>{role}</div>}
          </div>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 18, color: accent }}>{salutation}</div>
          {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
          {ph(body, "Your main body paragraph will appear here…", textC, "body")}
          {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
          <div style={{ borderTop: `1px solid #21262D`, paddingTop: 18 }}>
            {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
            <div style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 24 }}>{name}</div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === "cl-nature") {
    const accent = customAccent || "#16A34A";
    const bg = customBg || "#F0FDF4";
    const nameC = customNameColor || "#14532D";
    const textC = customText || "#374151";
    const mutedC = customMuted || "#4B7C5A";
    return (
      <div style={{ background: bg, padding: "44px 52px", minHeight: 700, fontFamily: "'Poppins',sans-serif", color: textC }}>
        <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 18, marginBottom: 26 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
          <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginTop: 5 }}>{pTitle}</div>
          <div style={{ fontSize: 11, color: mutedC, marginTop: 8 }}>{contacts}</div>
        </div>
        <RecipientBlock textColor={nameC} mutedColor={mutedC} />
        <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 18, color: textC }}>{salutation}</div>
        {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
        {ph(body, "Your main body paragraph will appear here…", textC, "body")}
        {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
        {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
        <div style={{ fontSize: 15, fontWeight: 700, color: accent, marginTop: 28 }}>{name}</div>
      </div>
    );
  }

  if (templateId === "cl-bold") {
    const accent = customAccent || "#DC2626";
    const bg = customBg || "#fff";
    const nameC = customNameColor || "#fff";
    const textC = customText || "#111";
    const mutedC = customMuted || "#555";
    return (
      <div style={{ minHeight: 700, fontFamily: "'Poppins',sans-serif", background: bg }}>
        <div style={{ background: accent, padding: "28px 44px 22px" }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: nameC, letterSpacing: "-0.02em", textTransform: "uppercase" }}>{name}</div>
          <div style={{ fontSize: 12, color: `${nameC}cc`, marginTop: 6 }}>{pTitle}</div>
        </div>
        <div style={{ padding: "32px 44px", color: textC }}>
          <div style={{ fontSize: 11, color: mutedC, marginBottom: 22 }}>{contacts}</div>
          <RecipientBlock textColor={textC} mutedColor={mutedC} />
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 18, color: accent, textTransform: "uppercase", letterSpacing: "0.04em" }}>{salutation}</div>
          {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
          {ph(body, "Your main body paragraph will appear here…", textC, "body")}
          {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
          <div style={{ borderTop: `2px solid ${accent}`, paddingTop: 18 }}>
            {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
            <div style={{ fontSize: 16, fontWeight: 900, color: accent, marginTop: 24, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{name}</div>
          </div>
        </div>
      </div>
    );
  }

  if (templateId === "cl-academic") {
    const accent = customAccent || "#B45309";
    const bg = customBg || "#FFFBF5";
    const nameC = customNameColor || "#78350F";
    const textC = customText || "#333";
    const mutedC = customMuted || "#92400E";
    return (
      <div style={{ background: bg, padding: "44px 52px", minHeight: 700, fontFamily: "'Poppins',sans-serif", color: textC }}>
        <div style={{ textAlign: "center", borderBottom: `1px solid ${accent}66`, paddingBottom: 20, marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: nameC, letterSpacing: "0.04em", textTransform: "uppercase" }}>{name}</div>
          <div style={{ fontSize: 12, color: accent, marginTop: 6 }}>{pTitle}</div>
          <div style={{ fontSize: 11, color: mutedC, marginTop: 8 }}>{contacts}</div>
        </div>
        {date && <div style={{ fontSize: 11, color: mutedC, textAlign: "right", marginBottom: 20 }}>{date}</div>}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontWeight: 600, fontSize: 11, color: textC }}>{recName}{recTitle ? `, ${recTitle}` : ""}</div>
          {company && <div style={{ fontSize: 11, color: mutedC }}>{company}</div>}
          {role && <div style={{ fontSize: 11, color: mutedC }}>{role}</div>}
        </div>
        <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 18, color: textC }}>{salutation}</div>
        {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
        {ph(body, "Your main body paragraph will appear here…", textC, "body")}
        {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
        {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
        <div style={{ fontSize: 15, fontWeight: 700, color: nameC, marginTop: 28 }}>{name}</div>
      </div>
    );
  }

  // Default: cl-classic
  const accent = customAccent || "#1A56DB";
  const bg = customBg || "#fff";
  const nameC = customNameColor || "#0F0F0F";
  const textC = customText || "#222";
  const mutedC = customMuted || "#555";
  return (
    <div style={{ background: bg, padding: "44px 52px", minHeight: 700, fontFamily: "'Poppins',sans-serif", color: textC }}>
      <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 18, marginBottom: 26 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: nameC }}>{name}</div>
        <div style={{ fontSize: 12, color: mutedC, marginTop: 5 }}>{contacts}</div>
      </div>
      <RecipientBlock textColor={textC} mutedColor={mutedC} />
      <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 18, color: textC }}>{salutation}</div>
      {ph(opening, "Your opening paragraph will appear here…", textC, "opening")}
      {ph(body, "Your main body paragraph will appear here…", textC, "body")}
      {ph(closing, "Your closing paragraph will appear here…", textC, "closing")}
      {showSignoff && <div style={{ fontSize: 12, color: mutedC }}>{signoff}</div>}
      <div style={{ fontSize: 15, fontWeight: 700, color: accent, marginTop: 28 }}>{name}</div>
    </div>
  );
}

// ─── COVER LETTER BUILDER PAGE ────────────────────────────────────────────────

function CoverLetterBuilderPage({ coverLetter, setCoverLetter, resume, templateId = "cl-classic", onTemplateChange, user }) {
  const [section, setSection] = useState("recipient");
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [hiddenFields, setHiddenFields] = useState(new Set());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingField, setAiLoadingField] = useState(null);
  const [aiError, setAiError] = useState("");
  const [jd, setJd] = useState("");
  const [exportingCLPDF, setExportingCLPDF] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const update = (field, val) => setCoverLetter(prev => ({ ...prev, [field]: val }));

  // Persisted per-user, same pattern as the resume builder's margin controls.
  const clMarginKey = user?.email ? `ats-cl-margins-${user.email}` : "ats-cl-margins-anon";
  const [clMarginTop, setClMarginTop] = useLocalStorage(`${clMarginKey}-top`, 40);
  const [clMarginBottom, setClMarginBottom] = useLocalStorage(`${clMarginKey}-bottom`, 40);
  const [clMarginLeft, setClMarginLeft] = useLocalStorage(`${clMarginKey}-left`, 48);
  const [clMarginRight, setClMarginRight] = useLocalStorage(`${clMarginKey}-right`, 48);
  const [clLinkTB, setClLinkTB] = useLocalStorage(`${clMarginKey}-linkTB`, true);
  const [clLinkLR, setClLinkLR] = useLocalStorage(`${clMarginKey}-linkLR`, true);
  const updateClMarginTop = (v) => { setClMarginTop(v); if (clLinkTB) setClMarginBottom(v); };
  const updateClMarginBottom = (v) => { setClMarginBottom(v); if (clLinkTB) setClMarginTop(v); };
  const updateClMarginLeft = (v) => { setClMarginLeft(v); if (clLinkLR) setClMarginRight(v); };
  const updateClMarginRight = (v) => { setClMarginRight(v); if (clLinkLR) setClMarginLeft(v); };
  const [clPageCount, setClPageCount] = useState(1);

  const handleExportCLPDF = async () => {
    // Must be the full-height off-screen copy (data-export-source), not one
    // of the visible per-page boxes — those are clipped to a single page's
    // slice and would export as one incomplete page. The measurer wrapper's
    // own child is the template's actual root (the one with a real
    // background) — one level deeper than the wrapper itself, which is
    // transparent and would export/color-sample as blank.
    const el = document.querySelector(".cl-preview-wrap [data-export-source] > div")?.firstElementChild;
    if (!el) return;
    setExportingCLPDF(true);
    try {
      const name = (coverLetter?.senderName || resume?.personal?.name || "cover_letter").trim().replace(/\s+/g, "_");
      await exportElementToPDF(el, `${name}_cover_letter.pdf`, { top: clMarginTop, bottom: clMarginBottom, left: clMarginLeft, right: clMarginRight });
      trackEvent("cover_letter_export", { template: templateId });
      setShowFeedback(true);
    } finally {
      setExportingCLPDF(false);
    }
  };

  const aiGenerateCL = async (field = "all") => {
    const name = coverLetter.senderName || resume?.personal?.name || "the applicant";
    const title = coverLetter.senderTitle || resume?.personal?.title || "";
    const company = coverLetter.company || "";
    const role = coverLetter.role || "";
    const summary = resume?.summary || "";
    const experience = (resume?.experience || []).slice(0, 3)
      .map(e => `${e.role} at ${e.company}${e.bullets?.length ? ": " + e.bullets.slice(0, 2).join("; ") : ""}`)
      .join("\n");
    const skills = (resume?.skills || []).slice(0, 12).join(", ");
    const recipient = coverLetter.recipientName || "Hiring Manager";

    if (!jd.trim() && !company && !role) {
      setAiError("Paste a job description or fill in Company Name and Position first.");
      setTimeout(() => setAiError(""), 4000);
      return;
    }

    const candidateProfile = `CANDIDATE PROFILE:
Name: ${name}${title ? ` | Title: ${title}` : ""}
Target role: ${role || "open position"} at ${company || "the company"}
Recipient: ${recipient}
Professional summary: ${summary || "Experienced professional"}
Experience:\n${experience || "Relevant work experience"}
Skills: ${skills || "Various professional skills"}`;

    const jdSection = jd.trim()
      ? `\nJOB DESCRIPTION:\n${jd.trim().slice(0, 3000)}`
      : "";

    const instruction = jd.trim()
      ? "Tailor the letter specifically to the job description. Mirror key requirements, use relevant keywords from the JD, and demonstrate how the candidate's background directly addresses what the employer needs."
      : "Write based on the candidate's profile and target role.";

    const systemPrompt = `You are an expert cover letter writer specializing in ATS optimization. ${instruction} Return plain text only, no labels, no markdown, no greetings or sign-offs — just the paragraph content.`;

    setAiError("");
    if (field === "all") setAiLoading(true);
    else setAiLoadingField(field);

    try {
      if (field === "opening" || field === "all") {
        const text = await callClaude(
          `Write a compelling opening paragraph (3-4 sentences) for a cover letter. Hook the reader immediately. Mention the specific role and express genuine enthusiasm. Briefly state the candidate's strongest relevant qualification.\n\n${candidateProfile}${jdSection}`,
          systemPrompt
        );
        update("opening", text.trim());
      }
      if (field === "body" || field === "all") {
        const text = await callClaude(
          `Write the main body paragraph (4-5 sentences) for a cover letter. Highlight 2-3 concrete achievements or skills that directly match what the employer is looking for. Use numbers/impact where possible. Connect the candidate's experience to the company's needs.${jd.trim() ? " Pull specific requirements from the job description and address them directly." : ""}\n\n${candidateProfile}${jdSection}`,
          systemPrompt
        );
        update("body", text.trim());
      }
      if (field === "closing" || field === "all") {
        const text = await callClaude(
          `Write a closing paragraph (2-3 sentences) for a cover letter. Express strong enthusiasm for this specific opportunity, request an interview, and thank the reader. End confidently.\n\n${candidateProfile}${jdSection}`,
          systemPrompt
        );
        update("closing", text.trim());
      }
      trackEvent("ai_cover_letter_generate", { field });
    } catch (err) {
      setAiError(err.message || "AI features are temporarily unavailable. Please try again later.");
      setTimeout(() => setAiError(""), 6000);
    } finally {
      setAiLoading(false);
      setAiLoadingField(null);
    }
  };
  const toggleField = (field) => setHiddenFields(prev => {
    const next = new Set(prev);
    next.has(field) ? next.delete(field) : next.add(field);
    return next;
  });
  const isHidden = (field) => hiddenFields.has(field);

  // Color customization
  const [customAccent,    setCustomAccent]    = useLocalStorage("cl-custom-accent", "");
  const [customBg,        setCustomBg]        = useLocalStorage("cl-custom-bg", "");
  const [customText,      setCustomText]      = useLocalStorage("cl-custom-text", "");
  const [customMuted,     setCustomMuted]     = useLocalStorage("cl-custom-muted", "");
  const [customNameColor, setCustomNameColor] = useLocalStorage("cl-custom-namecolor", "");
  const resetColors = () => { setCustomAccent(""); setCustomBg(""); setCustomText(""); setCustomMuted(""); setCustomNameColor(""); };

  const sections = [
    { id: "sender",    label: "Sender Info",   icon: <Icon.User /> },
    { id: "recipient", label: "Recipient",      icon: <Icon.Briefcase /> },
    { id: "content",   label: "Letter Body",    icon: <Icon.FileText /> },
  ];

  const tpl = COVER_LETTER_TEMPLATES.find(t => t.id === templateId);

  return (
    <>
    <FeedbackModal open={showFeedback} onClose={() => setShowFeedback(false)} user={user} docType="cover letter" />
    <div className="builder-layout" style={{ display: "flex", height: "calc(100vh - 58px)", overflow: "hidden" }}>
      {/* Sidebar */}
      <div className="builder-sidebar app-surface" style={{ width: 220, borderRight: "1px solid var(--c-border)", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, overflowY: "auto" }}>
        <div style={{ marginBottom: 8 }}>
          <div className="app-text3" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 12px 6px" }}>Cover Letter</div>
        </div>
        {sections.map(s => (
          <button key={s.id} className={cn("sidebar-item", section === s.id && "active")} onClick={() => setSection(s.id)}>
            {s.icon}
            <span style={{ fontSize: 13 }}>{s.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="divider" style={{ margin: "8px 0" }} />

        {/* Template switcher */}
        <div style={{ marginBottom: 8 }}>
          <div className="app-text3" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 4px 6px" }}>Template</div>
          <button className="btn btn-secondary btn-sm" style={{ width: "100%", justifyContent: "space-between" }}
            onClick={() => setShowTemplatePicker(p => !p)}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: tpl?.accent || "var(--c-accent)", flexShrink: 0 }} />
              {tpl?.name || "Classic"}
            </span>
            <Icon.ChevronRight />
          </button>

          {showTemplatePicker && (
            <div style={{ marginTop: 8, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {COVER_LETTER_TEMPLATES.map(t => (
                <button key={t.id}
                  onClick={() => { onTemplateChange?.(t.id); setShowTemplatePicker(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                    borderRadius: 7, border: t.id === templateId ? `1.5px solid var(--c-accent)` : "1.5px solid var(--c-border)",
                    background: t.id === templateId ? "var(--c-accent-light)" : "var(--c-surface2)",
                    cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "var(--font-body)",
                    color: t.id === templateId ? "var(--c-accent)" : "var(--c-text2)",
                    width: "100%", textAlign: "left",
                  }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.accent, flexShrink: 0 }} />
                  {t.name}
                  {t.id === templateId && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Color Customizer ── */}
        {(() => {
          const tpl = COVER_LETTER_TEMPLATES.find(t => t.id === templateId);
          const tplAccent = tpl?.accent || "#1A56DB";
          const tplNameDefault = tpl?.nameDefault || "#FFFFFF";
          const anyCustom = customAccent || customBg || customText || customMuted || customNameColor;
          const colorRows = [
            { label: "Accent",     value: customAccent,    set: setCustomAccent,    def: tplAccent,
              presets: ["#1D4ED8","#0D9488","#7C3AED","#059669","#DC2626","#EA580C","#EC4899","#0EA5E9","#111827","#B45309","#0891B2","#9333EA"] },
            { label: "Name Color", value: customNameColor, set: setCustomNameColor, def: tplNameDefault,
              presets: ["#FFFFFF","#F1F5F9","#111827","#1E293B","#1D4ED8","#7C3AED","#0D9488","#DC2626","#F59E0B","#EC4899","#059669","#0891B2"] },
            { label: "Background", value: customBg,        set: setCustomBg,        def: "#FFFFFF",
              presets: ["#FFFFFF","#F8FAFC","#F0F9FF","#FFF7ED","#F5F3FF","#FDF4FF","#F0FDF4","#FFFBF5","#0F172A","#111827","#1C1917","#0C0A09"] },
            { label: "Sub-heading",value: customText,      set: setCustomText,      def: "#111111",
              presets: ["#111827","#1E293B","#0F172A","#374151","#1D4ED8","#065F46","#4C1D95","#7C2D12","#FFFFFF","#F1F5F9","#E2E8F0","#CBD5E1"] },
            { label: "Details",    value: customMuted,     set: setCustomMuted,     def: "#6B7280",
              presets: ["#6B7280","#475569","#94A3B8","#9CA3AF","#374151","#1D4ED8","#0D9488","#7C3AED","#DC2626","#B45309","#059669","#EC4899"] },
          ];
          return (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 8px" }}>
                <div className="app-text3" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Colors</div>
                {anyCustom && (
                  <button onClick={resetColors} style={{ fontSize: 10, color: "var(--c-accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                    Reset all
                  </button>
                )}
              </div>
              {colorRows.map(({ label, value, set, def, presets }) => {
                const isLight = c => ["#FFFFFF","#F8FAFC","#F0F9FF","#FFF7ED","#F5F3FF","#FDF4FF","#F0FDF4","#FFFBF5","#F1F5F9","#E2E8F0","#CBD5E1"].includes(c);
                const active = value || def;
                return (
                  <div key={label} style={{ marginBottom: 12, padding: "0 4px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--c-text3)", fontWeight: 600 }}>{label}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: active, border: "1px solid var(--c-border)" }} />
                        <span style={{ fontSize: 10, color: "var(--c-text3)", fontFamily: "monospace" }}>{active}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 7 }}>
                      <button title="Template default" onClick={() => set("")}
                        style={{ width: 22, height: 22, borderRadius: 4, background: def, border: "none", cursor: "pointer", position: "relative", outline: !value ? "2.5px solid var(--c-accent)" : "1px solid rgba(0,0,0,0.1)", outlineOffset: 1, flexShrink: 0 }}>
                        {!value && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: isLight(def) ? "#111" : "#fff", fontSize: 10, fontWeight: 800 }}>✓</span>}
                      </button>
                      {presets.map(c => (
                        <button key={c} title={c} onClick={() => set(c)}
                          style={{ width: 22, height: 22, borderRadius: 4, background: c, border: "1px solid rgba(0,0,0,0.08)", cursor: "pointer", position: "relative", outline: value === c ? "2.5px solid var(--c-accent)" : "1px solid rgba(0,0,0,0.08)", outlineOffset: 1, transition: "transform 0.1s", transform: value === c ? "scale(1.18)" : "scale(1)", flexShrink: 0 }}>
                          {value === c && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: isLight(c) ? "#111" : "#fff", fontSize: 10, fontWeight: 800 }}>✓</span>}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--c-surface2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "5px 8px" }}>
                      <label title="Pick custom color" style={{ display: "flex", alignItems: "center", cursor: "pointer", flexShrink: 0 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: active, border: "2px solid var(--c-border)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)", position: "relative", overflow: "hidden" }}>
                          <input type="color" value={active} onChange={e => set(e.target.value)}
                            style={{ position: "absolute", inset: 0, width: "200%", height: "200%", opacity: 0, cursor: "pointer", padding: 0, border: "none" }} />
                        </div>
                      </label>
                      <input value={value || def}
                        onChange={e => { const v = e.target.value; if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) set(v); }}
                        onBlur={e => { const v = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(v)) set(v); else set(value); }}
                        maxLength={7} placeholder={def}
                        style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 12, fontFamily: "monospace", color: "var(--c-text)", padding: 0 }} />
                      {value && (
                        <button onClick={() => set("")} title="Reset to default"
                          style={{ fontSize: 13, color: "var(--c-text3)", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <button className="btn btn-primary btn-export-highlight btn-sm" style={{ justifyContent: "center" }} onClick={handleExportCLPDF} disabled={exportingCLPDF}>
          <Icon.Download /> {exportingCLPDF ? "Generating…" : "Export PDF"}
        </button>
      </div>

      {/* Editor */}
      <div className="builder-editor app-bg" style={{ flex: "0 0 420px", borderRight: "1px solid var(--c-border)", overflowY: "auto", padding: 20 }}>
        {section === "sender" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Sender Info</h2>
            <div className="ai-panel">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>ℹ️ Pre-filled from your Resume</div>
              <div style={{ fontSize: 12, color: "var(--c-text2)", lineHeight: 1.6, marginBottom: 8 }}>
                Edit any field below — changes apply only to this cover letter.
              </div>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => {
                  const p = resume?.personal || {};
                  setCoverLetter(prev => ({
                    ...prev,
                    senderName: p.name || "", senderTitle: p.title || "",
                    senderEmail: p.email || "", senderPhone: p.phone || "",
                    senderLocation: p.location || "",
                  }));
                }}>
                ↺ Re-sync from Resume
              </button>
            </div>
            {[
              { key: "senderName",     label: "Full Name",    placeholder: resume?.personal?.name     || "Your Name",          field: "name" },
              { key: "senderTitle",    label: "Title",        placeholder: resume?.personal?.title    || "Professional Title",  field: "title" },
              { key: "senderEmail",    label: "Email",        placeholder: resume?.personal?.email    || "you@example.com",     field: "email" },
              { key: "senderPhone",    label: "Phone",        placeholder: resume?.personal?.phone    || "+1 (555) 000-0000",   field: "phone" },
              { key: "senderLocation", label: "Location",     placeholder: resume?.personal?.location || "City, Country",      field: "location" },
            ].map(({ key, label, placeholder, field }) => {
              const resumeVal = resume?.personal?.[field] || "";
              const clVal = coverLetter[key];
              const displayVal = clVal !== undefined && clVal !== "" ? clVal : resumeVal;
              return (
                <div key={key}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <label className="label" style={{ margin: 0 }}>{label}</label>
                    {clVal && clVal !== resumeVal && (
                      <button onClick={() => update(key, "")} style={{ fontSize: 11, color: "var(--c-text3)", background: "none", border: "none", cursor: "pointer" }}>
                        ↺ Reset
                      </button>
                    )}
                  </div>
                  <input className="input" placeholder={placeholder}
                    value={displayVal}
                    onChange={e => update(key, e.target.value)} />
                </div>
              );
            })}
          </div>
        )}

        {section === "recipient" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Recipient Details</h2>
            {[
              { key: "date",          label: "Date",                      placeholder: "June 2, 2026" },
              { key: "company",       label: "Company Name",               placeholder: "Acme Corp" },
              { key: "role",          label: "Position Applied For",       placeholder: "Senior Software Engineer" },
              { key: "recipientName", label: "Recipient Name",             placeholder: "Hiring Manager" },
              { key: "recipientTitle",label: "Recipient Title (optional)", placeholder: "Head of Engineering" },
            ].map(f => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input className="input" placeholder={f.placeholder} value={coverLetter[f.key] || ""} onChange={e => update(f.key, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label">Salutation</label>
              <input className="input" placeholder="Dear Hiring Manager," value={coverLetter.salutation || ""} onChange={e => update("salutation", e.target.value)} />
            </div>
          </div>
        )}

        {section === "content" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Letter Body</h2>

            {/* JD Input + Generate */}
            <div style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.07), rgba(139,92,246,0.07))", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon.Sparkles />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#6366f1" }}>AI Generate from Job Description</span>
              </div>
              <textarea
                rows={5}
                placeholder="Paste the job description here… AI will tailor your cover letter to match the role's requirements and keywords automatically."
                value={jd}
                onChange={e => setJd(e.target.value)}
                style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid rgba(99,102,241,0.3)", fontSize: 12, fontFamily: "var(--font-body)", resize: "vertical", background: "var(--c-surface)", color: "var(--c-text)", lineHeight: 1.5, outline: "none", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => aiGenerateCL("all")}
                  disabled={aiLoading}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", fontFamily: "var(--font-body)", opacity: aiLoading ? 0.7 : 1 }}>
                  <Icon.Sparkles /> {aiLoading ? "Writing your letter…" : "Generate Cover Letter"}
                </button>
                {jd.trim() && (
                  <button onClick={() => setJd("")} title="Clear JD"
                    style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-text3)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-body)" }}>
                    Clear
                  </button>
                )}
              </div>
              {!jd.trim() && (
                <div style={{ fontSize: 11, color: "var(--c-text3)", textAlign: "center", marginTop: -4 }}>
                  No JD? It will generate based on your resume + recipient details.
                </div>
              )}
            </div>

            {aiError && (
              <div style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, fontSize: 12, color: "#DC2626", fontWeight: 500 }}>
                {aiError}
              </div>
            )}

            {/* Reusable field renderer with remove/restore toggle */}
            {[
              { key: "opening", label: "Opening Paragraph", rows: 4, placeholder: "Introduce yourself and express your interest in the role. Mention where you found the job posting." },
              { key: "body",    label: "Main Body",          rows: 5, placeholder: "Highlight 2-3 specific achievements relevant to the role. Connect your experience to what the company needs." },
              { key: "closing", label: "Closing Paragraph",  rows: 3, placeholder: "Express enthusiasm, request an interview, and thank the reader for their time." },
            ].map(({ key, label, rows, placeholder }) =>
              isHidden(key) ? (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--c-surface2)", border: "1px dashed var(--c-border)", borderRadius: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--c-text3)", fontStyle: "italic" }}>{label} removed</span>
                  <button onClick={() => toggleField(key)} style={{ fontSize: 12, fontWeight: 600, color: "var(--c-accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon.Plus /> Add back
                  </button>
                </div>
              ) : (
                <div key={key}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <label className="label" style={{ margin: 0 }}>
                      {label} <span className="app-text3" style={{ fontWeight: 400 }}>({(coverLetter[key] || "").length} chars)</span>
                    </label>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        onClick={() => aiGenerateCL(key)}
                        disabled={aiLoading || aiLoadingField === key}
                        title={`AI generate ${label}`}
                        style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 6, cursor: (aiLoading || aiLoadingField === key) ? "not-allowed" : "pointer", padding: "2px 8px", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 4, opacity: (aiLoading || aiLoadingField === key) ? 0.6 : 1 }}>
                        <Icon.Sparkles /> {aiLoadingField === key ? "…" : "AI"}
                      </button>
                      <button onClick={() => toggleField(key)} title={`Remove ${label}`}
                        style={{ fontSize: 11, fontWeight: 600, color: "var(--c-danger)", background: "none", border: "1px solid var(--c-border)", borderRadius: 6, cursor: "pointer", padding: "2px 8px", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 4, opacity: 0.7 }}>
                        <Icon.X /> Remove
                      </button>
                    </div>
                  </div>
                  <textarea className="input" rows={rows} placeholder={placeholder}
                    value={coverLetter[key] || ""} onChange={e => update(key, e.target.value)} />
                </div>
              )
            )}

            {/* Sign-off with remove toggle */}
            {isHidden("signoff") ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--c-surface2)", border: "1px dashed var(--c-border)", borderRadius: 8 }}>
                <span style={{ fontSize: 13, color: "var(--c-text3)", fontStyle: "italic" }}>Sign-off removed</span>
                <button onClick={() => toggleField("signoff")} style={{ fontSize: 12, fontWeight: 600, color: "var(--c-accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon.Plus /> Add back
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                  <label className="label" style={{ margin: 0 }}>Sign-off</label>
                  <button onClick={() => toggleField("signoff")} title="Remove Sign-off"
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--c-danger)", background: "none", border: "1px solid var(--c-border)", borderRadius: 6, cursor: "pointer", padding: "2px 8px", fontFamily: "var(--font-body)", display: "flex", alignItems: "center", gap: 4, opacity: 0.7 }}>
                    <Icon.X /> Remove
                  </button>
                </div>
                <input className="input" placeholder="Sincerely," value={coverLetter.signoff || ""} onChange={e => update("signoff", e.target.value)} />
              </div>
            )}

            <div className="ai-panel">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--c-accent)" }}>✍️ Writing Tips</div>
              {[
                "Keep it to one page — 3-4 short paragraphs",
                "Mirror language from the job description",
                "Open with impact — your biggest relevant achievement",
                "Close with a clear call to action",
              ].map((tip, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--c-text2)", marginBottom: 4, display: "flex", gap: 6 }}>
                  <span style={{ color: "var(--c-accent2)", flexShrink: 0 }}>✓</span> {tip}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live Preview */}
      <div className="builder-preview-wrap cl-preview-wrap" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div className="no-print" style={{ flexShrink: 0, background: "var(--c-surface2)", borderBottom: "1px solid var(--c-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text2)" }}>Live Preview</span>
              <div className="badge badge-green" style={{ fontSize: 10 }}>ATS Safe</div>
              <div className="badge badge-gray" style={{ fontSize: 10 }}>{tpl?.name || "Classic"} Cover Letter</div>
            </div>
            <button className="btn btn-export-highlight btn-sm" onClick={handleExportCLPDF} disabled={exportingCLPDF}>
              <Icon.Download /> {exportingCLPDF ? "Generating…" : "Export PDF"}
            </button>
          </div>
          {/* Margin controls — same layout controls as the resume Live Preview toolbar. */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: "10px 20px", alignItems: "center",
            padding: "8px 16px", borderTop: "1px solid var(--c-border)",
          }}>
            {[
              ["Top", clMarginTop, updateClMarginTop],
              ["Bottom", clMarginBottom, updateClMarginBottom],
              ["Left", clMarginLeft, updateClMarginLeft],
              ["Right", clMarginRight, updateClMarginRight],
            ].map(([label, val, onChange]) => (
              <div key={label} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--c-text3)", whiteSpace: "nowrap" }}>{label} margin</span>
                <input
                  type="range" min={0} max={80} step={4} value={val}
                  onChange={e => onChange(Number(e.target.value))}
                  title={`${label} page margin`}
                  style={{ width: 70 }}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-primary)", width: 26, textAlign: "right" }}>{val}px</span>
              </div>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-text3)", cursor: "pointer" }} title="Keep top/bottom equal">
              <input type="checkbox" checked={clLinkTB} onChange={() => setClLinkTB(v => !v)} style={{ margin: 0 }} /> Link T/B
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-text3)", cursor: "pointer" }} title="Keep left/right equal">
              <input type="checkbox" checked={clLinkLR} onChange={() => setClLinkLR(v => !v)} style={{ margin: 0 }} /> Link L/R
            </label>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "24px", background: "var(--c-surface2)" }}>
          <PaginatedResumePreview
            margins={{ top: clMarginTop, bottom: clMarginBottom, left: clMarginLeft, right: clMarginRight }}
            onPageCountChange={setClPageCount}
          >
            <CoverLetterPreview cl={coverLetter} personal={resume?.personal} templateId={templateId}
              customAccent={customAccent} customBg={customBg} customText={customText}
              customMuted={customMuted} customNameColor={customNameColor}
              hiddenFields={hiddenFields} />
          </PaginatedResumePreview>
        </div>
      </div>
    </div>
    </>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

const BLANK_RESUME = {
  personal: { name: "", title: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "", photo: null },
  summary: "",
  experience: [{ id: 1, company: "", role: "", start: "", end: "", location: "", bullets: [""] }],
  education: [{ id: 1, school: "", degree: "", year: "", gpa: "" }],
  skills: [],
  certifications: [{ id: 1, name: "", issuer: "", year: "" }],
  projects: [{ id: 1, name: "", desc: "", start: "", end: "", url: "" }],
};

const BLANK_COVER_LETTER = {
  // Sender overrides (pre-filled from resume on first load)
  senderName: "",
  senderTitle: "",
  senderEmail: "",
  senderPhone: "",
  senderLocation: "",
  // Letter details
  date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  recipientName: "Hiring Manager",
  recipientTitle: "",
  company: "",
  role: "",
  salutation: "Dear Hiring Manager,",
  opening: "",
  body: "",
  closing: "",
  signoff: "Sincerely,",
};

// ─── PLAN SYSTEM ──────────────────────────────────────────────────────────────

const FREE_TEMPLATES = ["clarity", "form", "slate"];

// Pricing is temporarily disabled — every account gets full premium access for free.
function isPremium(user) { return !!user; }

export default function App() {
  const [dark, setDark] = useLocalStorage("ats-dark", false);
  const [user, setUserState] = useLocalStorage("ats-user", null);
  const [page, setPage] = useState(user ? PAGES.DASHBOARD : PAGES.HOME);

  const setUser = (u) => {
    if (typeof u === "function") { setUserState(u); return; }
    if (!u) { signOut(auth).catch(() => {}); return; }
    setUserState(u);
  };

  // Firebase is the source of truth for the session — this keeps `user` in sync
  // with the real auth state (handles sign-out, token expiry, refresh, etc.)
  // rather than trusting whatever was last cached in localStorage.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setUserState(prev => ({
          uid: fbUser.uid,
          name: fbUser.displayName || prev?.name || fbUser.email.split("@")[0],
          email: fbUser.email,
          picture: fbUser.photoURL || undefined,
        }));
      } else {
        setUserState(null);
        setPage(PAGES.HOME);
      }
    });
    return unsub;
  }, []);

  // Restore page on refresh — if user is logged in, go to dashboard
  useEffect(() => {
    if (user?.email && page === PAGES.HOME) setPage(PAGES.DASHBOARD);
  }, [user?.email]);

  // Fix multi-page PDF: remove overflow:auto from preview wrap before printing
  useEffect(() => {
    const fixOverflow = () => {
      document.querySelectorAll(".builder-preview-wrap").forEach(el => {
        el.dataset.prevOverflow = el.style.overflow;
        el.style.overflow = "visible";
        el.style.height = "auto";
      });
    };
    const restoreOverflow = () => {
      document.querySelectorAll(".builder-preview-wrap").forEach(el => {
        el.style.overflow = el.dataset.prevOverflow || "auto";
        el.style.height = "";
      });
    };
    window.addEventListener("beforeprint", fixOverflow);
    window.addEventListener("afterprint", restoreOverflow);
    return () => {
      window.removeEventListener("beforeprint", fixOverflow);
      window.removeEventListener("afterprint", restoreOverflow);
    };
  }, []);

  const [resume, setResumeState] = useState(BLANK_RESUME);
  const [selectedTemplate, setTemplateState] = useState("clarity");
  const [coverLetterTemplate, setCoverLetterTemplate] = useState("cl-classic");
  const [coverLetter, setCoverLetterState] = useState(BLANK_COVER_LETTER);
  const dataLoadedRef = useRef(false); // guards against saving blank state before Firestore load completes
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(null); // edits made before load completes are queued here, not dropped

  // Load the correct user's data from Firestore whenever the account changes
  useEffect(() => {
    dataLoadedRef.current = false;
    pendingSaveRef.current = null;
    if (!user?.uid) return;
    (async () => {
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref).catch(() => null);
      const data = snap?.exists() ? snap.data() : null;

      setResumeState(data?.resume || { ...BLANK_RESUME, personal: { ...BLANK_RESUME.personal, name: user.name || "", email: user.email || "" } });
      setTemplateState(data?.template || "clarity");
      setCoverLetterState(data?.coverLetter || BLANK_COVER_LETTER);

      // Seed premium for whitelisted accounts
      const PREMIUM_EMAILS = ["ravijuneja1986@gmail.com"];
      let plan = data?.plan || "free";
      let planStart = data?.planStart || null;
      if (PREMIUM_EMAILS.includes(user.email) && plan !== "premium") {
        plan = "premium";
        planStart = planStart || new Date().toISOString();
        await setDoc(ref, { plan, planStart }, { merge: true }).catch(() => {});
      }
      setUser(prev => prev ? { ...prev, plan, planStart } : prev);
      dataLoadedRef.current = true;
      // Flush any edit the user made while the load was still in flight —
      // it reflects the latest state, so it should win over what we just loaded.
      if (pendingSaveRef.current) {
        setDoc(ref, pendingSaveRef.current, { merge: true }).catch(() => {});
        pendingSaveRef.current = null;
      }
    })();
  }, [user?.uid]);

  // Debounced save of resume/template/coverLetter to Firestore so rapid edits
  // (typing) don't fire a write per keystroke. Edits that arrive before the
  // initial load finishes are queued rather than dropped (see flush above).
  const scheduleSave = (patch) => {
    if (!user?.uid) return;
    if (!dataLoadedRef.current) {
      pendingSaveRef.current = { ...pendingSaveRef.current, ...patch };
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setDoc(doc(db, "users", user.uid), patch, { merge: true }).catch(() => {});
    }, 600);
  };

  const setResume = (val) => {
    setResumeState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      scheduleSave({ resume: next });
      return next;
    });
  };

  const setSelectedTemplate = (val) => {
    setTemplateState(val);
    scheduleSave({ template: val });
  };

  const setCoverLetter = (val) => {
    setCoverLetterState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      scheduleSave({ coverLetter: next });
      return next;
    });
  };

  useEffect(() => { document.documentElement.className = dark ? "dark" : ""; }, [dark]);

  const renderPage = () => {
    switch (page) {
      case PAGES.HOME: return <HomePage setPage={setPage} user={user} />;
      case PAGES.LOGIN: return user ? <DashboardPage setPage={setPage} user={user} resume={resume} setResume={setResume} template={selectedTemplate} coverLetter={coverLetter} coverLetterTemplate={coverLetterTemplate} /> : <AuthPage mode="login" setPage={setPage} setUser={setUser} dark={dark} setDark={setDark} />;
      case PAGES.REGISTER: return user ? <DashboardPage setPage={setPage} user={user} resume={resume} setResume={setResume} template={selectedTemplate} coverLetter={coverLetter} coverLetterTemplate={coverLetterTemplate} /> : <AuthPage mode="register" setPage={setPage} setUser={setUser} dark={dark} setDark={setDark} />;
      case PAGES.DASHBOARD: return user
        ? <DashboardPage setPage={setPage} user={user} resume={resume} setResume={setResume} template={selectedTemplate} coverLetter={coverLetter} coverLetterTemplate={coverLetterTemplate} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.BUILDER: return user
        ? <BuilderPage key={user.email} resume={resume} setResume={setResume} template={selectedTemplate}
            onTemplateChange={setSelectedTemplate} user={user} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.TEMPLATES: return <TemplatesPage setPage={setPage} onSelectTemplate={setSelectedTemplate}
          currentTemplate={selectedTemplate} user={user}
          onSelectCoverLetterTemplate={setCoverLetterTemplate} />;
      case PAGES.COVER_LETTER: return user
        ? <CoverLetterBuilderPage coverLetter={coverLetter} setCoverLetter={setCoverLetter} resume={resume} templateId={coverLetterTemplate} onTemplateChange={setCoverLetterTemplate} user={user} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.PRICING:
      case PAGES.SUBSCRIPTION: return user
        ? <DashboardPage setPage={setPage} user={user} resume={resume} setResume={setResume} template={selectedTemplate} coverLetter={coverLetter} coverLetterTemplate={coverLetterTemplate} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.PRIVACY: return <PrivacyPage setPage={setPage} />;
      case PAGES.TERMS: return <TermsPage setPage={setPage} />;
      case PAGES.CONTACT: return <ContactPage setPage={setPage} user={user} />;
      case PAGES.ABOUT: return <AboutPage setPage={setPage} user={user} />;
      case PAGES.ADMIN: return user
        ? <AdminFeedbackPage setPage={setPage} user={user} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      default: return <HomePage setPage={setPage} user={user} />;
    }
  };

  // Ambient motion chrome (progress bar, back-to-top, floating background
  // blobs) is scoped to the marketing surfaces — the builder/dashboard are
  // dense working UIs where they'd be noise rather than polish.
  const isMarketingPage = [PAGES.HOME, PAGES.TEMPLATES].includes(page);
  const isAuthPage = (page === PAGES.LOGIN || page === PAGES.REGISTER) && !user;

  return (
    <>
      <style>{styles}</style>
      <div className="app-bg app-text" style={{ minHeight: "100vh", fontFamily: "var(--font-body)" }}>
        {isMarketingPage && <AmbientBackground />}
        {isMarketingPage && <ScrollProgressBar />}
        <BetaBanner setPage={setPage} />
        {!isAuthPage && <Navbar page={page} setPage={setPage} dark={dark} setDark={setDark} user={user} setUser={setUser} />}
        {renderPage()}
        {isMarketingPage && <BackToTop />}
      </div>
    </>
  );
}
