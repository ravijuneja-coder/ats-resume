import { useState, useEffect, useRef } from "react";
import mammoth from "mammoth";

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
    name: "Ravi Juneja",
    title: "AI-Driven Product Designer | UX/UI | Design Systems | Enterprise & SaaS",
    email: "junejauxd@gmail.com",
    phone: "+971-55-1408813",
    location: "Bur Dubai, Dubai, UAE",
    linkedin: "linkedin.com/in/ravi-juneja",
    github: "",
    website: "behance.net/ravijuneja4b4d",
    photo: null,
  },
  summary: "Senior Product Designer (UX/UI) with 10+ years of experience in SaaS and enterprise products, focused on high-quality UI, scalable design systems, and AI-driven design solutions.",
  experience: [
    {
      id: 1, company: "Freelance / Self-Employed", role: "UX/UI & Product Design · AI-Driven Design Upskilling",
      start: "2025", end: "Present", location: "Dubai, UAE",
      bullets: [
        "Designing end-to-end product experiences including user flows, wireframes, and high-fidelity UI for web and mobile applications",
        "Upskilling in AI-assisted UX workflows using Claude and Figma AI",
        "Building scalable design systems and developing portfolio-ready case studies",
      ],
    },
    {
      id: 2, company: "Birlasoft Limited", role: "Senior UI/UX/Product Designer",
      start: "2019", end: "2025", location: "Noida, India",
      bullets: [
        "CMDS Claims: Built WCAG-compliant design system powering 700+ screens, reducing UI support tickets by 67%",
        "MailWave Cloud: Designed SaaS email marketing platform UX, boosting user engagement by 35%",
        "Hotel Hub (United Airlines): Streamlined UX flows reducing gate agent workload by 60%",
      ],
    },
    {
      id: 3, company: "Conduent Business Services India LLP", role: "Senior UI/Product Designer",
      start: "2018", end: "2019", location: "Noida, India",
      bullets: [
        "Designed high-fidelity UI for Electronic Payment Card fintech product covering issuance, validation, payments, and transaction dashboards",
      ],
    },
  ],
  education: [
    { id: 1, school: "HFI (Human Factors International)", degree: "Certified Usability Analyst (CUA)", year: "2020", gpa: "" },
  ],
  skills: [
    "User Interface Design (UI)", "Design Systems", "High-Fidelity UI Design", "Responsive Web & Mobile Design",
    "Accessibility (WCAG 2.1/2.2)", "UX Research", "User Flows & Journey Mapping", "Wireframing & Prototyping",
    "Figma", "Adobe XD", "Figma AI", "Claude Design", "Zeplin", "Axure", "Sketch",
    "AI-Assisted Design Workflows", "Agile/Scrum", "Stakeholder Management", "Team Leadership",
  ],
  certifications: [{ id: 1, name: "Certified Usability Analyst (CUA)", issuer: "HFI", year: "2020" }],
  projects: [
    { id: 1, name: "CMDS Claims – Healthcare Design System", url: "behance.net/ravijuneja4b4d", desc: "700+ screens, WCAG-compliant, 67% reduction in UI support tickets via reusable components and token-driven design", start: "2021", end: "2024" },
    { id: 2, name: "MailWave Cloud – Email Marketing SaaS", url: "behance.net/ravijuneja4b4d", desc: "Simplified automation workflows and boosted user engagement by 35% through intuitive UX flows", start: "2022", end: "2023" },
  ],
};

const PAGES = { HOME: "home", LOGIN: "login", REGISTER: "register", DASHBOARD: "dashboard", BUILDER: "builder", TEMPLATES: "templates", PRICING: "pricing", SUBSCRIPTION: "subscription" };

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

// ─── API HELPER ───────────────────────────────────────────────────────────────

async function callClaude(prompt, systemPrompt = "") {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Add VITE_ANTHROPIC_API_KEY to your .env file to enable AI features.");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt || "You are an expert resume writer and career coach specializing in ATS optimization. Be concise, professional, and impactful. Return plain text only, no markdown formatting unless explicitly asked.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
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
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Add VITE_ANTHROPIC_API_KEY to your .env file to enable AI features.");

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, system: PARSE_SYSTEM, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
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
};

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
  }

  .dark {
    --c-bg: #0C0C0A;
    --c-surface: #161614;
    --c-surface2: #1F1F1C;
    --c-border: #2A2A27;
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
  .btn-danger { background: #FEF2F2; color: var(--c-danger); border: 1px solid #FECACA; }
  .btn-danger:hover { background: #FEE2E2; }
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
    position: sticky; top: 0; z-index: 50;
    background: rgba(248,247,244,0.92);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--c-border);
    transition: background 0.2s;
  }
  .dark .navbar { background: rgba(12,12,10,0.92); }

  /* Hero gradient */
  .hero-grad {
    background: radial-gradient(ellipse 80% 60% at 50% -20%, rgba(26,86,219,0.12) 0%, transparent 70%),
                radial-gradient(ellipse 40% 40% at 80% 60%, rgba(5,150,105,0.08) 0%, transparent 60%),
                var(--c-bg);
  }

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
  @media (max-width: 768px) {
    /* Features grid: 1 col on mobile */
    .features-grid { grid-template-columns: 1fr !important; }

    /* Testimonials: narrower cards */
    .testimonials-row > div { width: calc(80vw) !important; min-width: 260px !important; }

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
    50%  { transform: scale(1.06) rotate(1deg); }
    100% { transform: scale(1) rotate(-2deg); }
  }
  @keyframes freeGlow {
    0%, 100% { box-shadow: 0 0 24px 4px rgba(16,185,129,0.45), 0 4px 24px rgba(5,150,105,0.3); }
    50%       { box-shadow: 0 0 40px 10px rgba(16,185,129,0.65), 0 8px 32px rgba(5,150,105,0.45); }
  }
  .free-badge {
    animation: freePop 2.8s ease-in-out infinite, freeGlow 2.8s ease-in-out infinite;
  }

  /* Print / PDF export */
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .no-print { display: none !important; }
    .navbar { display: none !important; }
    .builder-sidebar { display: none !important; }
    .builder-editor { display: none !important; }
    .builder-preview-wrap {
      position: fixed !important; inset: 0 !important;
      background: white !important; padding: 0 !important;
      display: block !important; overflow: visible !important;
      box-shadow: none !important;
    }
    .builder-preview-wrap > div { box-shadow: none !important; border-radius: 0 !important; }
    .resume-preview {
      transform: none !important;
      width: 100% !important;
      padding: 40px 48px !important;
      font-size: 11pt !important;
    }
  }
`;

// ─── RESUME PREVIEW COMPONENT ─────────────────────────────────────────────────

// Shared body sections (summary, experience, skills, education, certs, projects)
function ResumeSections({ r, accent, text, muted, skillBg }) {
  const sh = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: accent, borderBottom: `1.5px solid ${accent}`, paddingBottom: 3, marginBottom: 8 };
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
            <div key={exp.id} style={{ marginBottom: 10 }}>
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
            <div key={edu.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
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
            <div key={p.id} style={{ marginBottom: 8 }}>
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

function ResumePreview({ resume, scale = 1, templateId = "clarity", customAccent = "", customBg = "", customText = "", customHeaderBg = "", customMuted = "", customNameColor = "" }) {
  const r = resume;
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
  if (["axiom", "portrait", "prism"].includes(templateId)) {
    const isDarkSide = ["portrait", "prism"].includes(templateId);
    const sideBg = customHeaderBg || (templateId === "axiom" ? "#4C1D95" : templateId === "prism" ? "#5B21B6" : "#13113A");
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
                <div key={e.id} style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 10, color: "#fff" }}>{e.degree}</div>
                  <div style={{ fontSize: 9, color: sideText }}>{e.school}{e.year ? ` · ${e.year}` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Content */}
        <div style={{ flex: 1, padding: "28px 24px", fontFamily: font, fontSize: 11, lineHeight: 1.5 }}>
          <ResumeSections r={r} accent={sideAccent} text={contentText} muted={contentMuted} skillBg={sideAccent + "22"} />
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
        <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg="#1C1917" />
      </div>
    );
  }

  // ── PHOTO HEADER BAND (vista, lens) ─────────────────────────────────────────
  if (["vista", "lens"].includes(templateId)) {
    const isVista = templateId === "vista";
    const grad = isVista ? "linear-gradient(135deg,#EC4899,#BE185D)" : "linear-gradient(135deg,#0EA5E9,#0369A1)";
    const headerText = "#fff"; const headerMuted = isVista ? "#FBCFE8" : "#BAE6FD";
    const bg = customBg || (isVista ? "#FFF1F2" : "#F0F9FF"); const text = customText || "#1F2937"; const muted = customMuted || "#6B7280";
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
          <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={isVista ? "#FCE7F3" : "#E0F2FE"} />
        </div>
      </div>
    );
  }

  // ── COLORED HEADER BAND (echo, flow, summit, bloom) ─────────────────────────
  if (["echo", "flow", "summit", "bloom"].includes(templateId)) {
    const grads = {
      echo: accent, flow: accent,
      summit: "linear-gradient(135deg,#1D4ED8,#1E40AF)",
      bloom: "linear-gradient(135deg,#D946EF,#9333EA)",
    };
    const bgs = { echo: "#F0F9FF", flow: "#FFFFFF", summit: "#EFF6FF", bloom: "#FDF4FF" };
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
          <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "22"} />
        </div>
      </div>
    );
  }

  // ── DARK TEMPLATES (apex, nova, edge, spark) ─────────────────────────────────
  if (["apex", "nova", "edge", "spark"].includes(templateId)) {
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
          <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "22"} />
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
        <ResumeSections r={r} accent="#1E293B" text={text} muted={muted} skillBg="#F1F5F9" />
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
        <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "18"} />
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
                <div key={exp.id} style={{ marginBottom: 12 }}>
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
                <div key={edu.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
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
                <div key={p.id} style={{ marginBottom: 8 }}>
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
      <ResumeSections r={r} accent={accent} text={text} muted={muted} skillBg={accent + "22"} />
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
              {isPremium(user) ? (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "linear-gradient(135deg, #F59E0B, #D97706)",
                  color: "#fff", fontSize: 11, fontWeight: 700,
                  padding: "3px 10px", borderRadius: 99, letterSpacing: "0.03em",
                }}>
                  ⭐ Premium Plan
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    background: "var(--c-surface2)", border: "1px solid var(--c-border)",
                    color: "var(--c-text2)", fontSize: 11, fontWeight: 600,
                    padding: "3px 10px", borderRadius: 99,
                  }}>
                    Free Plan
                  </div>
                  <button onClick={() => { setPage(PAGES.PRICING); setOpen(false); }}
                    style={{
                      fontSize: 11, fontWeight: 700, color: "var(--c-accent)",
                      background: "var(--c-accent-light)", border: "none",
                      padding: "3px 10px", borderRadius: 99, cursor: "pointer",
                      fontFamily: "var(--font-body)",
                    }}>
                    Upgrade ↗
                  </button>
                </div>
              )}
            </div>
            {[
              { label: "Dashboard", icon: <Icon.LayoutTemplate />, action: () => { setPage(PAGES.DASHBOARD); setOpen(false); } },
              { label: "Open Builder", icon: <Icon.Zap />, action: () => { setPage(PAGES.BUILDER); setOpen(false); } },
              { label: "Templates", icon: <Icon.FileText />, action: () => { setPage(PAGES.TEMPLATES); setOpen(false); } },
              { label: "Subscription", icon: <Icon.Star />, action: () => { setPage(PAGES.SUBSCRIPTION); setOpen(false); } },
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

function Navbar({ page, setPage, dark, setDark, user, setUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isBuilder = page === PAGES.BUILDER || page === PAGES.DASHBOARD;

  return (
    <nav className="navbar">
      <div style={{ padding: "0 24px", display: "flex", alignItems: "center", height: 58 }}>
        {/* Logo */}
        <button onClick={() => setPage(PAGES.HOME)} className="btn btn-ghost" style={{ padding: "6px 8px", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon.FileText />
          </div>
          <span className="font-display" style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text)" }}>ResumeAI</span>
        </button>

        <div style={{ flex: 1 }} />

        {/* Desktop nav */}
        <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {!isBuilder && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.TEMPLATES)}>Templates</button>
              {(!user || !isPremium(user)) && <button className="btn btn-ghost btn-sm" onClick={() => setPage(PAGES.PRICING)}>Pricing</button>}
            </>
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
          {(!user || !isPremium(user)) && <button className="sidebar-item" onClick={() => { setPage(PAGES.PRICING); setMobileOpen(false); }}>Pricing</button>}
          {user ? (
            <>
              <button className="sidebar-item" onClick={() => { setPage(PAGES.DASHBOARD); setMobileOpen(false); }}>Dashboard</button>
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
    </nav>
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────

function HomePage({ setPage }) {
  const [homeFilter, setHomeFilter] = useState("all");
  const features = [
    { icon: <Icon.Target />, title: "ATS Optimization", desc: "Real-time scoring against 98% of ATS systems used by Fortune 500 companies" },
    { icon: <Icon.Sparkles />, title: "AI-Powered Writing", desc: "Generate professional summaries, rewrite bullets, and get keyword suggestions instantly" },
    { icon: <Icon.Eye />, title: "Live Preview", desc: "See exactly how your resume looks as you type — no refresh, no surprises" },
    { icon: <Icon.Download />, title: "One-Click Export", desc: "Download ATS-safe PDF or DOCX in seconds, print-ready and perfectly formatted" },
    { icon: <Icon.LayoutTemplate />, title: "Pro Templates", desc: "Dozens of recruiter-approved templates designed by HR professionals" },
    { icon: <Icon.TrendingUp />, title: "Job Match Score", desc: "Paste any job description and get an instant compatibility score with fix suggestions" },
  ];

  const testimonials = [
    { name: "Priya S.", role: "Product Manager @ Google", text: "Got 3x more callbacks after optimizing with ResumeAI. The ATS score feature is a game-changer.", rating: 5 },
    { name: "Marcus T.", role: "SWE @ Stripe", text: "The AI bullet rewriter saved me hours. My resume went from generic to outstanding in 20 minutes.", rating: 5 },
    { name: "Ana L.", role: "Data Scientist @ Meta", text: "Finally a resume builder that actually explains what ATS looks for. Landed my dream job!", rating: 5 },
    { name: "James K.", role: "Frontend Engineer @ Netflix", text: "Switched from another builder and immediately noticed the difference. Got an interview at my dream company within two weeks.", rating: 5 },
    { name: "Sofia R.", role: "UX Designer @ Airbnb", text: "The templates are stunning and the ATS tips are genuinely useful. I felt so much more confident applying.", rating: 5 },
    { name: "David W.", role: "Backend Engineer @ Shopify", text: "The job description matcher is brilliant. It told me exactly which keywords I was missing and my callback rate jumped.", rating: 5 },
    { name: "Meera P.", role: "ML Engineer @ OpenAI", text: "I used to spend hours tweaking my resume. ResumeAI cut that down to 20 minutes and the result was way better.", rating: 5 },
    { name: "Tyler N.", role: "DevOps Engineer @ AWS", text: "Clean UI, smart AI suggestions, and the ATS score gives real peace of mind before hitting submit.", rating: 5 },
    { name: "Isabelle F.", role: "Product Designer @ Figma", text: "Love that it tells you WHY your score is low, not just that it is. Actionable feedback every step of the way.", rating: 5 },
    { name: "Kevin O.", role: "Full-Stack Dev @ Coinbase", text: "Three offers in a month after rebuilding my resume here. The AI summary generator alone is worth it.", rating: 5 },
  ];

  return (
    <div className="app-bg">
      {/* Hero */}
      <section className="hero-grad" style={{ padding: "80px 20px 100px", textAlign: "center" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="badge badge-blue fade-in" style={{ marginBottom: 20, fontSize: 13 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-accent)", display: "inline-block" }}></span>
            AI-powered · ATS-optimized · Free to start
          </div>

          <h1 className="font-display fade-in-delay-1" style={{ fontSize: "clamp(40px, 6vw, 72px)", fontWeight: 800, lineHeight: 1.1, margin: "0 0 20px" }}>
            <span style={{ whiteSpace: "normal" }}>
              Build a{" "}
              <span className="free-badge" style={{
                display: "inline-block",
                background: "linear-gradient(135deg, #34D399 0%, #059669 50%, #047857 100%)",
                color: "#fff",
                fontSize: "clamp(32px, 5vw, 68px)",
                fontWeight: 400,
                padding: "2px 22px 6px",
                borderRadius: 16,
                lineHeight: 1.25,
                letterSpacing: "-0.03em",
                verticalAlign: "middle",
                transform: "rotate(-2deg)",
                position: "relative",
                border: "3px solid rgba(255,255,255,0.25)",
              }}>✦ Free</span>
              {" "}Resume
            </span><br />
            that actually gets<br />
            <span className="grad-text">noticed</span>
          </h1>

          <p className="app-text2 fade-in-delay-2" style={{ fontSize: "clamp(16px, 2vw, 20px)", lineHeight: 1.6, margin: "0 0 36px" }}>
            ResumeAI helps you create ATS-optimized resumes in minutes using AI. Beat applicant tracking systems, impress recruiters, and land more interviews.
          </p>

          <div className="fade-in-delay-3" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-xl" onClick={() => setPage(PAGES.REGISTER)}>
              Build Your Resume — It's Free <Icon.ArrowRight />
            </button>
            <button className="btn btn-secondary btn-xl" onClick={() => setPage(PAGES.TEMPLATES)}>
              View Templates <Icon.Eye />
            </button>
          </div>

          <div className="app-text3 fade-in-delay-3" style={{ marginTop: 20, fontSize: 13 }}>
            ✓ No credit card required &nbsp;·&nbsp; ✓ 50,000+ resumes created &nbsp;·&nbsp; ✓ 4.9★ rating
          </div>
        </div>

        {/* Hero Resume Card */}
        {/* ── Hero Mockup ── */}
        <div className="hero-mockup" style={{ margin: "64px 24px 0", position: "relative" }}>

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
          <div style={{
            position: "relative", zIndex: 1,
            borderRadius: 16, overflow: "hidden",
            border: "1px solid var(--c-border)",
            boxShadow: "0 2px 0 rgba(255,255,255,0.8) inset, 0 32px 80px rgba(15,14,12,0.14), 0 8px 24px rgba(26,86,219,0.08)",
            background: "var(--c-surface)",
          }}>
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
                <span style={{ fontSize: 12, color: "var(--c-text2)", fontWeight: 500 }}>resumeai.app/builder</span>
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

                {/* Score ring row */}
                <div style={{
                  background: "linear-gradient(135deg,#ECFDF5,#D1FAE5)",
                  border: "1px solid #A7F3D0",
                  borderRadius: 12, padding: "12px 14px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {/* Mini ring */}
                  <div style={{ position: "relative", width: 46, height: 46, flexShrink: 0 }}>
                    <svg width="46" height="46" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="23" cy="23" r="18" fill="none" stroke="#A7F3D0" strokeWidth="4"/>
                      <circle cx="23" cy="23" r="18" fill="none" stroke="#059669" strokeWidth="4"
                        strokeDasharray={`${2*Math.PI*18}`}
                        strokeDashoffset={`${2*Math.PI*18*(1-0.94)}`}
                        strokeLinecap="round"/>
                    </svg>
                    <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center", fontWeight:800,fontSize:11,color:"#059669" }}>94</div>
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

                {/* Suggestion cards */}
                {[
                  { text: "Add metrics to bullet #3", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
                  { text: "Include 'TypeScript' in skills", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
                  { text: "Summary could be stronger", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
                  { text: "Consider adding a project section", color: "#F59E0B", bg: "#FFFBEB", border: "#FDE68A" },
                ].map((s, i) => (
                  <div key={i} style={{
                    padding: "9px 11px", borderRadius: 10, fontSize: 12, fontWeight: 500,
                    display: "flex", gap: 9, alignItems: "center",
                    background: s.bg, border: `1px solid ${s.border}`,
                    transition: "transform 0.15s",
                    animationDelay: `${i * 0.08}s`,
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>⚡</span>
                    <span style={{ color: "#78350F", lineHeight: 1.4 }}>{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

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
        </div>

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
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, margin: "0 0 12px" }}>
            Everything you need to land the job
          </h2>
          <p className="app-text2" style={{ fontSize: 17, maxWidth: 500, margin: "0 auto" }}>
            Built for modern job seekers who want an unfair advantage.
          </p>
        </div>
        <div className="features-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {features.map((f, i) => (
            <div key={i} className="card card-hover shine" style={{ padding: 24 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--c-accent-light)", color: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                {f.icon}
              </div>
              <h3 className="font-display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px" }}>{f.title}</h3>
              <p className="app-text2" style={{ fontSize: 14, margin: 0, lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Templates showcase */}
      {(() => {
        const filters = ["all", "minimal", "modern", "corporate", "creative", "with photo"];
        const filtered = TEMPLATES.filter(t => {
          if (homeFilter === "all") return true;
          if (homeFilter === "minimal") return ["clarity","form","slate","pure"].includes(t.id);
          if (homeFilter === "modern") return ["apex","echo","edge","flow"].includes(t.id);
          if (homeFilter === "corporate") return ["axiom","form","summit","prestige"].includes(t.id);
          if (homeFilter === "creative") return ["nova","axiom","spark","bloom"].includes(t.id);
          if (homeFilter === "with photo") return t.photo === true;
          return true;
        });
        return (
      <section style={{ padding: "90px 24px", borderTop: "1px solid var(--c-border)", borderBottom: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div className="badge badge-blue" style={{ marginBottom: 12, fontSize: 12 }}>
              <Icon.LayoutTemplate /> {TEMPLATES.length} professional templates
            </div>
            <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.1 }}>
              Pick your perfect resume
            </h2>
            <p className="app-text2" style={{ fontSize: 16, maxWidth: 480, margin: "0 auto" }}>
              Every template is ATS-optimized, recruiter-approved, and fully customizable.
            </p>
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 40 }}>
            {filters.map(f => (
              <button key={f} onClick={() => setHomeFilter(f)}
                style={{ padding: "8px 20px", borderRadius: 99, border: homeFilter === f ? "none" : "1.5px solid var(--c-border)", background: homeFilter === f ? "var(--c-accent)" : "var(--c-surface)", color: homeFilter === f ? "#fff" : "var(--c-text2)", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)", transition: "all 0.15s", textTransform: "capitalize" }}>
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Uniform template grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
            {filtered.map(t => {
              const MiniPreview = MINI_PREVIEWS[t.id];
              const isPremiumTemplate = !FREE_TEMPLATES.includes(t.id);
              return (
                <div key={t.id} className="card-hover" onClick={() => { setPage(PAGES.REGISTER); }}
                  style={{ borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "2px solid var(--c-border)", boxShadow: "0 2px 8px var(--c-shadow)", transition: "all 0.2s ease", position: "relative" }}>
                  <div style={{ height: 300, overflow: "hidden", position: "relative" }}>
                    <div style={{ height: "100%" }}>
                      {MiniPreview && (t.photo ? <MiniPreview photo={DUMMY_AVATAR} /> : <MiniPreview />)}
                    </div>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: `linear-gradient(transparent, ${t.bg === "#0F172A" || t.bg === "#0F0F0F" || t.bg === "#0A0A0A" || t.bg === "#0C0C0C" || t.bg === "#0F0F23" || t.bg === "#0C0A09" ? "#0F172A" : "#ffffff"})`, pointerEvents: "none" }} />
                    {isPremiumTemplate && (
                      <div style={{ position: "absolute", top: 10, left: 10, background: "linear-gradient(135deg,#F59E0B,#D97706)", borderRadius: 99, padding: "3px 9px", display: "flex", alignItems: "center", gap: 4, boxShadow: "0 2px 8px rgba(217,119,6,0.35)" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>⭐ Premium</span>
                      </div>
                    )}
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
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: "center", marginTop: 48 }}>
            <button className="btn btn-primary btn-lg" onClick={() => setPage(PAGES.REGISTER)} style={{ marginRight: 12 }}>
              <Icon.Sparkles /> Start Building Free
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => setPage(PAGES.TEMPLATES)}>
              View All Templates <Icon.ArrowRight />
            </button>
          </div>
        </div>
      </section>
        );
      })()}

      {/* Testimonials */}
      <section style={{ padding: "80px 0" }}>
        <div style={{ textAlign: "center", marginBottom: 48, padding: "0 24px" }}>
          <h2 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px" }}>
            Trusted by 50,000+ job seekers
          </h2>
        </div>
        <div className="testimonials-row" style={{
          display: "flex", gap: 16, overflowX: "auto", scrollbarWidth: "none",
          paddingLeft: 24, paddingRight: 24, paddingBottom: 8,
          WebkitOverflowScrolling: "touch",
          scrollSnapType: "x mandatory",
        }}>
          {testimonials.map((t, i) => (
            <div key={i} className="card" style={{
              padding: 24, flexShrink: 0,
              width: "calc(20% - 13px)",
              minWidth: 240,
              scrollSnapAlign: "start",
            }}>
              <div style={{ display: "flex", gap: 2, marginBottom: 12, color: "#F59E0B" }}>
                {Array(t.rating).fill(0).map((_, j) => <Icon.Star key={j} />)}
              </div>
              <p className="app-text2" style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>"{t.text}"</p>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                <div className="app-text3" style={{ fontSize: 12 }}>{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "60px 20px", textAlign: "center", background: "var(--c-accent)", color: "#fff" }}>
        <h2 className="font-display" style={{ fontSize: "clamp(24px, 4vw, 40px)", fontWeight: 800, margin: "0 0 12px" }}>
          Your next interview is one resume away.
        </h2>
        <p style={{ fontSize: 17, opacity: 0.85, margin: "0 0 28px" }}>Start free. No credit card. Build in minutes.</p>
        <button className="btn btn-xl" onClick={() => setPage(PAGES.REGISTER)}
          style={{ background: "#fff", color: "var(--c-accent)", fontWeight: 700 }}>
          Create My Resume Now <Icon.ArrowRight />
        </button>
      </section>

      {/* Footer */}
      <footer className="app-surface" style={{ borderTop: "1px solid var(--c-border)", padding: "32px 20px" }}>
        <div style={{ padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon.FileText />
            </div>
            <span className="font-display" style={{ fontWeight: 700 }}>ResumeAI</span>
          </div>
          <div className="app-text3" style={{ fontSize: 13 }}>© 2025 ResumeAI. Made with ♥ for job seekers everywhere.</div>
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            {["Privacy", "Terms", "Contact"].map(l => <a key={l} href="#" className="app-text3" style={{ textDecoration: "none" }}>{l}</a>)}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────

function AuthPage({ mode, setPage, setUser }) {
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isLogin = mode === "login";

  // Load Google GSI script once
  useEffect(() => {
    if (document.getElementById("gsi-script")) return;
    const s = document.createElement("script");
    s.id = "gsi-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, []);

  const handle = async () => {
    if (!form.email || !form.password || (!isLogin && !form.name)) {
      setError("Please fill in all fields"); return;
    }
    setLoading(true); setError("");
    await new Promise(r => setTimeout(r, 800));
    setUser({ name: form.name || form.email.split("@")[0], email: form.email });
    setPage(PAGES.DASHBOARD);
    setLoading(false);
  };

  const googleAuth = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError("Google Sign-In is not configured. Please contact support.");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setError("Google Sign-In is still loading — please try again in a moment.");
      return;
    }
    setLoading(true);
    setError("");
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: async (tokenResponse) => {
        if (tokenResponse.error) {
          setError("Google Sign-In was cancelled.");
          setLoading(false);
          return;
        }
        try {
          const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          });
          const info = await res.json();
          setUser({ name: info.name, email: info.email, picture: info.picture });
          setPage(PAGES.DASHBOARD);
        } catch {
          setError("Failed to fetch Google profile. Please try again.");
        }
        setLoading(false);
      },
    });
    tokenClient.requestAccessToken({ prompt: "select_account" });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} className="hero-grad">
      <div className="card fade-in" style={{ width: "100%", maxWidth: 420, padding: 36 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "#fff" }}>
            <Icon.FileText />
          </div>
          <h1 className="font-display" style={{ fontSize: 24, fontWeight: 800, margin: "0 0 6px" }}>
            {isLogin ? "Welcome back" : "Create account"}
          </h1>
          <p className="app-text2" style={{ fontSize: 14, margin: 0 }}>
            {isLogin ? "Sign in to your ResumeAI account" : "Start building ATS-optimized resumes"}
          </p>
        </div>

        {/* Google */}
        <button onClick={googleAuth} disabled={loading} className="btn btn-secondary" style={{ width: "100%", justifyContent: "center", marginBottom: 16, padding: "11px", fontSize: 14 }}>
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

        {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#DC2626", marginBottom: 12 }}>{error}</div>}

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
        </div>

        <button onClick={handle} disabled={loading} className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "11px", fontSize: 15, fontWeight: 600 }}>
          {loading ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
        </button>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 14 }} className="app-text2">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 4px", color: "var(--c-accent)", fontWeight: 600 }}
            onClick={() => setPage(isLogin ? PAGES.REGISTER : PAGES.LOGIN)}>
            {isLogin ? "Sign up free" : "Sign in"}
          </button>
        </div>
      </div>
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

function DashboardPage({ setPage, user, resume, setResume, template }) {
  const [showCVPreview, setShowCVPreview] = useState(false);
  const { score } = computeATSScore(resume);
  const stats = [
    { label: "ATS Score", value: `${score}`, unit: "/100", color: "var(--c-accent)" },
    { label: "Sections", value: `${computeSectionCount(resume)}`, unit: "filled", color: "var(--c-accent2)" },
    { label: "Word Count", value: `${computeWordCount(resume)}`, unit: "words", color: "var(--c-amber)" },
    { label: "Completeness", value: `${computeCompleteness(resume)}`, unit: "%", color: "#8B5CF6" },
  ];

  return (
    <div className="app-bg" style={{ minHeight: "100vh" }}>
      {showCVPreview && <CVPreviewModal resume={resume} templateId={template} customAccent={customAccent} customBg={customBg} customText={customText} customHeaderBg={customHeaderBg} customMuted={customMuted} customNameColor={customNameColor} onClose={() => setShowCVPreview(false)} />}
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
        <div className="dashboard-main" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>
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
                <button className="btn btn-ghost btn-sm"><Icon.Download /> Download</button>
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
    } catch (err) {
      setImportError(err.message || "Failed to import CV. Please try again.");
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
    } catch (e) {
      setAiText("Error calling AI. Please check your connection.");
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

  const handleExportPDF = () => {
    if (!premium && !FREE_TEMPLATES.includes(template)) { onNeedUpgrade?.("pdf_export"); return; }
    window.print();
  };

  return (
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

        <button className="btn btn-primary btn-sm" style={{ justifyContent: "center" }} onClick={handleExportPDF}>
          <Icon.Download /> Export PDF
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
                  <button className="btn btn-secondary btn-sm" onClick={addExperience}><Icon.Plus /> Add</button>
                </div>
                {resume.experience.map((exp, ei) => (
                  <div key={exp.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span className="font-display" style={{ fontWeight: 600, fontSize: 14 }}>Position {ei + 1}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => removeExp(exp.id)} style={{ color: "var(--c-danger)" }}><Icon.Trash /></button>
                    </div>
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
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Education</h2>
                {resume.education.map(edu => (
                  <div key={edu.id} className="card" style={{ padding: 16 }}>
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
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm" onClick={() => setResume({ ...resume, education: [...resume.education, { id: Date.now(), school: "", degree: "", year: "", gpa: "" }] })}>
                  <Icon.Plus /> Add Education
                </button>
              </div>
            )}

            {/* Certifications */}
            {section === "certifications" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Certifications</h2>
                {resume.certifications.map(cert => (
                  <div key={cert.id} className="card" style={{ padding: 16 }}>
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
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setResume({ ...resume, certifications: [...resume.certifications, { id: Date.now(), name: "", issuer: "", year: "" }] })}>
                  <Icon.Plus /> Add Certification
                </button>
              </div>
            )}

            {/* Projects */}
            {section === "projects" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Projects</h2>
                {resume.projects.map(proj => (
                  <div key={proj.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span className="font-display" style={{ fontWeight: 600, fontSize: 14 }}>Project</span>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--c-danger)" }}
                        onClick={() => setResume({ ...resume, projects: resume.projects.filter(p => p.id !== proj.id) })}>
                        <Icon.Trash />
                      </button>
                    </div>
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
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setResume({ ...resume, projects: [...resume.projects, { id: Date.now(), name: "", desc: "", start: "", end: "", url: "" }] })}>
                  <Icon.Plus /> Add Project
                </button>
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
        <div className="no-print" style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 16px", flexShrink: 0,
          background: "var(--c-surface2)", borderBottom: "1px solid var(--c-border)",
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text2)" }}>Live Preview</span>
            <div className="badge badge-green" style={{ fontSize: 10 }}>ATS Safe</div>
            <div className="badge badge-gray" style={{ fontSize: 10, textTransform: "capitalize" }}>
              {TEMPLATES.find(t => t.id === template)?.name || "Clarity"}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}><Icon.Download /> Export PDF</button>
        </div>

        {/* Resume — fills remaining space */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <ResumePreview resume={resume} templateId={template} customAccent={customAccent} customBg={customBg} customText={customText} customHeaderBg={customHeaderBg} customMuted={customMuted} customNameColor={customNameColor} />
        </div>
      </div>
    </div>
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

const MINI_PREVIEWS = {
  apex: MiniApex, clarity: MiniClarity, axiom: MiniAxiom, nova: MiniNova,
  echo: MiniEcho, form: MiniForm,
  slate: MiniSlate, pure: MiniPure, edge: MiniEdge, flow: MiniFlow,
  summit: MiniSummit, prestige: MiniPrestige, spark: MiniSpark, bloom: MiniBloom,
  portrait: MiniPortrait, vista: MiniVista, pulse: MiniPulse, prism: MiniPrism, lens: MiniLens,
};

// ─── TEMPLATES PAGE ───────────────────────────────────────────────────────────

function TemplatesPage({ setPage, onSelectTemplate, currentTemplate = "clarity", user, onNeedUpgrade }) {
  const premium = isPremium(user);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [hovered, setHovered] = useState(null);
  const [previewing, setPreviewing] = useState(null); // template id being previewed
  const filters = ["all", "minimal", "modern", "corporate", "creative", "with photo"];

  const filteredTemplates = TEMPLATES.filter(t => {
    if (filter === "all") return true;
    if (filter === "minimal") return ["clarity", "form", "slate", "pure"].includes(t.id);
    if (filter === "modern") return ["apex", "echo", "edge", "flow"].includes(t.id);
    if (filter === "corporate") return ["axiom", "form", "summit", "prestige"].includes(t.id);
    if (filter === "creative") return ["nova", "axiom", "spark", "bloom"].includes(t.id);
    if (filter === "with photo") return t.photo === true;
    return true;
  });

  const selectedTpl = TEMPLATES.find(t => t.id === selected);

  return (
    <div className="app-bg" style={{ minHeight: "100vh", padding: "40px 20px", paddingBottom: selected ? 100 : 40 }}>
      <div style={{ padding: "0 24px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div className="badge badge-blue" style={{ marginBottom: 12, fontSize: 13 }}>19 professional templates</div>
          <h1 className="font-display" style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, margin: "0 0 12px" }}>
            Pick your perfect resume
          </h1>
          <p className="app-text2" style={{ fontSize: 17, maxWidth: 460, margin: "0 auto 24px" }}>
            Every template is ATS-optimized, recruiter-approved, and fully customizable.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {filters.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={f === filter ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                style={{ textTransform: "capitalize" }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Template grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 24 }}>
          {filteredTemplates.map(t => {
            const MiniPreview = MINI_PREVIEWS[t.id];
            const isSelected = selected === t.id;
            const isHovered = hovered === t.id;
            const isPremiumTemplate = !FREE_TEMPLATES.includes(t.id);
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
                  {isPremiumTemplate && (
                    <div style={{
                      position: "absolute", top: 10, left: 10,
                      background: "linear-gradient(135deg,#F59E0B,#D97706)",
                      borderRadius: 99, padding: "3px 9px",
                      display: "flex", alignItems: "center", gap: 4,
                      boxShadow: "0 2px 8px rgba(217,119,6,0.35)",
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>⭐ Premium</span>
                    </div>
                  )}
                  {isSelected && (
                    <div style={{
                      position: "absolute", top: 12, right: 12,
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
              <div style={{ position: "absolute", top: 10, right: 10, background: "linear-gradient(135deg,#F59E0B,#D97706)", borderRadius: 99, padding: "3px 9px", display: "flex", alignItems: "center", gap: 4, boxShadow: "0 2px 8px rgba(217,119,6,0.35)" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>⭐ Premium</span>
              </div>
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
        </div>

        {/* CTA bar — fixed at bottom, appears only after user picks a template */}
        {selected === "ravi" && (
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

        {/* CTA bar — fixed at bottom, appears only after user picks a template */}
        {selected && (
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

// ─── PRICING PAGE ─────────────────────────────────────────────────────────────

function PricingPage({ setPage, user, onUpgrade, onDowngrade, onStripeCheckout }) {
  const [annual, setAnnual] = useState(true);
  const premiumPrice = annual ? 9 : 12;
  const currentPlan = user?.plan || "free";
  const isCurrentPremium = isPremium(user);

  const features = [
    { label: "Resumes",                  free: "1 resume",          premium: "Unlimited resumes" },
    { label: "Templates",                free: "3 basic templates",  premium: "All 19 premium templates" },
    { label: "ATS Score",                free: "Basic check",        premium: "Full ATS analysis" },
    { label: "Export",                   free: "PDF only",           premium: "PDF & DOCX" },
    { label: "AI Summary Generator",     free: false,                premium: true },
    { label: "AI Bullet Rewriter",       free: false,                premium: true },
    { label: "CV Import (AI parsing)",   free: false,                premium: true },
    { label: "Job Description Matcher",  free: false,                premium: true },
    { label: "Keyword Optimizer",        free: false,                premium: true },
    { label: "Photo Templates",          free: false,                premium: true },
    { label: "Priority Support",         free: false,                premium: true },
    { label: "Early Access to Features", free: false,                premium: true },
  ];

  const Tick = ({ ok, text }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--c-border)" }}>
      {ok === true ? (
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" style={{ width: 12, height: 12 }}><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      ) : ok === false ? (
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--c-surface2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-text3)" strokeWidth="2" style={{ width: 10, height: 10 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>
      ) : (
        <div style={{ width: 22, flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 14, color: ok === false ? "var(--c-text3)" : "var(--c-text)" }}>{text}</span>
    </div>
  );

  return (
    <div className="app-bg" style={{ minHeight: "100vh" }}>

      {/* Hero */}
      <div className="hero-grad" style={{ padding: "64px 24px 48px", textAlign: "center" }}>
        <div className="badge badge-blue" style={{ marginBottom: 16, fontSize: 13 }}>Simple, transparent pricing</div>
        <h1 className="font-display" style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 800, margin: "0 0 14px", lineHeight: 1.1 }}>
          Start free.<br />
          <span className="grad-text">Upgrade when you're ready.</span>
        </h1>
        <p className="app-text2" style={{ fontSize: 18, maxWidth: 480, margin: "0 auto 28px" }}>
          No credit card required. Cancel anytime. Every plan includes ATS scoring and live preview.
        </p>

        {/* Billing toggle */}
        <div style={{ display: "inline-flex", background: "var(--c-surface2)", borderRadius: 12, padding: 4, gap: 4 }}>
          {[true, false].map(a => (
            <button key={String(a)} onClick={() => setAnnual(a)} style={{
              padding: "9px 22px", borderRadius: 9, border: "none", cursor: "pointer",
              fontSize: 14, fontWeight: 600, fontFamily: "var(--font-body)",
              background: annual === a ? "var(--c-surface)" : "transparent",
              color: annual === a ? "var(--c-text)" : "var(--c-text2)",
              boxShadow: annual === a ? "0 2px 8px var(--c-shadow)" : "none",
              transition: "all 0.15s",
            }}>
              {a ? "Annual billing" : "Monthly billing"}
              {a && <span className="badge badge-green" style={{ fontSize: 11, marginLeft: 8 }}>Save 25%</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 24px 80px" }}>

        {/* Plan cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24, maxWidth: 860, margin: "-32px auto 48px", position: "relative", zIndex: 2, paddingTop: 20 }}>

          {/* Free */}
          <div className="card" style={{ padding: 32 }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--c-surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon.FileText />
                </div>
                <h2 className="font-display" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Free</h2>
              </div>
              <p className="app-text2" style={{ fontSize: 14, margin: "0 0 20px" }}>Everything you need to get started building your first resume.</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="font-display" style={{ fontSize: 48, fontWeight: 800, lineHeight: 1 }}>$0</span>
                <span className="app-text2" style={{ fontSize: 15 }}>/month</span>
              </div>
              <div className="app-text3" style={{ fontSize: 13, marginTop: 6 }}>Free forever · No card needed</div>
            </div>
            {isCurrentPremium ? (
              <button className="btn btn-secondary btn-lg" style={{ width: "100%", justifyContent: "center", marginBottom: 28, fontSize: 15 }}
                onClick={onDowngrade}>
                Downgrade to Free
              </button>
            ) : user ? (
              <button className="btn btn-secondary btn-lg" style={{ width: "100%", justifyContent: "center", marginBottom: 28, fontSize: 15, border: "2px solid var(--c-accent2)", color: "var(--c-accent2)" }}
                disabled>
                ✓ Your current plan
              </button>
            ) : (
              <button className="btn btn-secondary btn-lg" style={{ width: "100%", justifyContent: "center", marginBottom: 28, fontSize: 15 }}
                onClick={() => setPage(PAGES.REGISTER)}>
                Get Started Free
              </button>
            )}
            <div>
              {["1 resume", "3 basic templates", "PDF export", "Basic ATS score check", "Live resume preview", "Google Sign-In"].map((f, i) => (
                <Tick key={i} ok={true} text={f} />
              ))}
              {["AI writing features", "CV import", "All templates", "Job match scoring"].map((f, i) => (
                <Tick key={i} ok={false} text={f} />
              ))}
            </div>
          </div>

          {/* Premium */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* Badge sits ABOVE the card, overlaps top border via negative margin */}
            <div style={{
              background: "linear-gradient(135deg, var(--c-accent), #7C3AED)",
              color: "#fff", fontSize: 12, fontWeight: 700,
              padding: "6px 22px", borderRadius: 99,
              whiteSpace: "nowrap", letterSpacing: "0.04em",
              boxShadow: "0 4px 16px rgba(26,86,219,0.35)",
              marginBottom: -14, zIndex: 1, position: "relative",
            }}>⭐ Most Popular</div>

          <div className="card shine" style={{
            width: "100%", padding: 32,
            border: "2px solid var(--c-accent)",
            boxShadow: "0 24px 64px var(--c-glow)",
          }}>
            <div style={{ marginBottom: 24, marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--c-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                  <Icon.Sparkles />
                </div>
                <h2 className="font-display" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Premium</h2>
              </div>
              <p className="app-text2" style={{ fontSize: 14, margin: "0 0 20px" }}>Full AI power, unlimited resumes and every template — land the job faster.</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="font-display" style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, color: "var(--c-accent)" }}>${premiumPrice}</span>
                <span className="app-text2" style={{ fontSize: 15 }}>/month</span>
              </div>
              <div className="app-text3" style={{ fontSize: 13, marginTop: 6 }}>
                {annual ? `Billed $${premiumPrice * 12}/year · Save $36` : "Billed monthly · Switch to annual to save 25%"}
              </div>
            </div>

            {isCurrentPremium ? (
              <button className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center", marginBottom: 28, fontSize: 15, background: "var(--c-accent2)" }}
                disabled>
                ✓ You're on Premium
              </button>
            ) : (
              <button className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center", marginBottom: 28, fontSize: 15 }}
                onClick={() => user ? onStripeCheckout() : setPage(PAGES.REGISTER)}>
                <Icon.Sparkles /> {user ? "Upgrade to Premium" : "Get Started — Sign Up Free"}
              </button>
            )}

            <div>
              {[
                "Unlimited resumes",
                "All 19 premium templates",
                "PDF & DOCX export",
                "Full ATS analysis & scoring",
                "Live resume preview",
                "AI summary generator",
                "AI bullet rewriter",
                "CV import (AI parsing)",
                "Job description matcher",
                "Keyword optimizer",
                "Photo templates",
                "Priority support",
              ].map((f, i) => <Tick key={i} ok={true} text={f} />)}
            </div>
          </div>
          </div>{/* end Premium wrapper */}
        </div>

        {/* Feature comparison table */}
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <h2 className="font-display" style={{ fontSize: 24, fontWeight: 800, textAlign: "center", margin: "0 0 32px" }}>Full feature comparison</h2>

          <div className="card" style={{ overflow: "hidden" }}>
            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", background: "var(--c-surface2)", borderBottom: "1px solid var(--c-border)" }}>
              <div style={{ padding: "14px 20px", fontWeight: 700, fontSize: 14 }}>Feature</div>
              <div style={{ padding: "14px 20px", fontWeight: 700, fontSize: 14, textAlign: "center", borderLeft: "1px solid var(--c-border)" }}>Free</div>
              <div style={{ padding: "14px 20px", fontWeight: 700, fontSize: 14, textAlign: "center", borderLeft: "1px solid var(--c-border)", color: "var(--c-accent)" }}>Premium</div>
            </div>

            {features.map((f, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid var(--c-border)", background: i % 2 === 0 ? "var(--c-surface)" : "var(--c-surface2)" }}>
                <div style={{ padding: "13px 20px", fontSize: 14, fontWeight: 500 }}>{f.label}</div>
                <div style={{ padding: "13px 20px", textAlign: "center", borderLeft: "1px solid var(--c-border)", fontSize: 13 }}>
                  {f.free === false
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-text3)" strokeWidth="2" style={{ width: 16, height: 16, margin: "0 auto", display: "block" }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    : f.free === true
                      ? <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" style={{ width: 16, height: 16, margin: "0 auto", display: "block" }}><polyline points="20 6 9 17 4 12"/></svg>
                      : <span className="app-text2">{f.free}</span>
                  }
                </div>
                <div style={{ padding: "13px 20px", textAlign: "center", borderLeft: "1px solid var(--c-border)", fontSize: 13 }}>
                  {f.premium === true
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" style={{ width: 16, height: 16, margin: "0 auto", display: "block" }}><polyline points="20 6 9 17 4 12"/></svg>
                    : <span style={{ color: "var(--c-accent)", fontWeight: 600 }}>{f.premium}</span>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ / trust strip */}
        <div style={{ maxWidth: 860, margin: "40px auto 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {[
            { icon: "🔒", title: "No card required", desc: "Start free with zero payment info. Upgrade anytime from your dashboard." },
            { icon: "↩️", title: "Cancel anytime", desc: "No lock-in. Cancel your subscription in one click, no questions asked." },
            { icon: "⚡", title: "Instant access", desc: "Premium activates the moment you pay. All features available immediately." },
          ].map((item, i) => (
            <div key={i} className="card" style={{ padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{item.icon}</div>
              <div className="font-display" style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{item.title}</div>
              <div className="app-text2" style={{ fontSize: 13, lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
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

// ─── PLAN SYSTEM ──────────────────────────────────────────────────────────────

const FREE_TEMPLATES = ["clarity", "form", "slate"];

const PLAN_FEATURES = {
  ai_writing:      { label: "AI Writing Tools",      desc: "Generate summaries, rewrite bullets, optimize for job descriptions" },
  cv_import:       { label: "CV Import (AI)",         desc: "Upload a PDF or DOCX and let AI fill in all your resume fields" },
  all_templates:   { label: "All 19 Templates",       desc: "Access every template including photo, creative and corporate styles" },
  photo_templates: { label: "Photo Templates",        desc: "Portrait, Vista, Pulse, Prism and Lens templates with photo support" },
  pdf_export:      { label: "PDF Export",             desc: "Download your resume as a print-ready PDF file" },
};

function isPremium(user) { return user?.plan === "premium"; }

function SubscriptionPage({ user, setPage }) {
  const premium = isPremium(user);

  // If premium but no planStart saved, use today and persist it
  const resolvedStart = (() => {
    if (!premium) return null;
    if (user?.planStart) return user.planStart;
    const today = new Date().toISOString();
    if (user?.email) localStorage.setItem(`ats-plan-start-${user.email}`, today);
    return today;
  })();

  const planStart = resolvedStart ? new Date(resolvedStart) : null;
  const nextBilling = planStart ? new Date(new Date(planStart).setMonth(planStart.getMonth() + 1)) : null;
  const validTill = planStart ? new Date(new Date(planStart).setFullYear(planStart.getFullYear() + 1)) : null;

  const fmt = (d) => d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—";

  return (
    <div className="app-bg" style={{ minHeight: "100vh", padding: "40px 24px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 24 }} onClick={() => setPage(PAGES.DASHBOARD)}>
          ← Back to Dashboard
        </button>
        <h1 className="font-display" style={{ fontSize: 26, fontWeight: 800, margin: "0 0 24px" }}>Subscription</h1>

        <div className="card" style={{ padding: 28, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--c-text3)", marginBottom: 4 }}>Current Plan</div>
              <div className="font-display" style={{ fontSize: 22, fontWeight: 800 }}>
                {premium ? "Premium" : "Free"}
              </div>
            </div>
            <div style={{
              background: premium ? "linear-gradient(135deg, #F59E0B, #D97706)" : "var(--c-surface2)",
              color: premium ? "#fff" : "var(--c-text2)",
              padding: "6px 16px", borderRadius: 99, fontSize: 13, fontWeight: 700,
            }}>
              {premium ? "⭐ Active" : "Free Tier"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Account", value: user?.email },
              { label: "Plan started", value: planStart ? fmt(planStart) : "—" },
              { label: "Next billing", value: nextBilling ? fmt(nextBilling) : "—" },
              { label: "Valid till", value: validTill ? fmt(validTill) : "—" },
              { label: "Price", value: premium ? "$9 / month" : "Free forever" },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--c-border)" }}>
                <span style={{ fontSize: 14, color: "var(--c-text3)" }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {premium ? (
          <div className="card" style={{ padding: 20, background: "var(--c-accent-light)", border: "1px solid var(--c-accent)22" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>✓ You have full Premium access</div>
            <div style={{ fontSize: 13, color: "var(--c-text2)" }}>All templates, AI features, unlimited resumes and CV import are unlocked.</div>
          </div>
        ) : (
          <button className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center" }} onClick={() => setPage(PAGES.PRICING)}>
            <Icon.Sparkles /> Upgrade to Premium — $9/mo
          </button>
        )}
      </div>
    </div>
  );
}

function UpgradeModal({ feature, onClose, onUpgrade }) {
  const info = PLAN_FEATURES[feature] || { label: "Premium Feature", desc: "This feature is available on the Premium plan." };
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div className="card fade-in" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 420, width: "100%", padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>⭐</div>
        <h2 className="font-display" style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>Premium Feature</h2>
        <p className="app-text2" style={{ fontSize: 14, margin: "0 0 20px", lineHeight: 1.6 }}>
          <strong>{info.label}</strong> — {info.desc}
        </p>
        <div style={{ background: "var(--c-accent-light)", border: "1px solid var(--c-accent)22", borderRadius: 12, padding: 16, marginBottom: 24, textAlign: "left" }}>
          {["All 19 premium templates", "AI summary & bullet writer", "CV import with AI parsing", "Job description matcher", "Unlimited resumes"].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 14 }}>
              <span style={{ color: "var(--c-accent)", fontWeight: 700 }}>✓</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={onUpgrade}>
          <Icon.Sparkles /> Upgrade to Premium — $9/mo
          <span style={{ fontSize: 11, opacity: 0.8, marginLeft: 4 }}>via Stripe</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 10, fontSize: 12, color: "var(--c-text3)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secured by Stripe · Cancel anytime
        </div>
        <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center", color: "var(--c-text2)" }} onClick={onClose}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useLocalStorage("ats-dark", false);
  const [user, setUserState] = useLocalStorage("ats-user", null);
  const [page, setPage] = useState(user ? PAGES.DASHBOARD : PAGES.HOME);

  const setUser = (u) => {
    setUserState(u);
    if (!u) setPage(PAGES.HOME);
  };

  // Restore page on refresh — if user is logged in, go to dashboard
  useEffect(() => {
    if (user?.email && page === PAGES.HOME) setPage(PAGES.DASHBOARD);
  }, [user?.email]);

  const [resume, setResumeState] = useState(BLANK_RESUME);
  const [selectedTemplate, setTemplateState] = useState("clarity");
  const [upgradeModal, setUpgradeModal] = useState(null); // feature key or null

  // Load the correct user's data from localStorage whenever the account changes
  useEffect(() => {
    if (!user?.email) return;
    const rKey = `ats-resume-${user.email}`;
    const tKey = `ats-template-${user.email}`;
    const pKey = `ats-plan-${user.email}`;
    try {
      const saved = localStorage.getItem(rKey);
      if (saved) setResumeState(JSON.parse(saved));
      else setResumeState({ ...BLANK_RESUME, personal: { ...BLANK_RESUME.personal, name: user.name || "", email: user.email || "" } });
    } catch { setResumeState(BLANK_RESUME); }
    try { const savedT = localStorage.getItem(tKey); setTemplateState(savedT ? JSON.parse(savedT) : "clarity"); }
    catch { setTemplateState("clarity"); }
    // Load plan
    const savedPlan = localStorage.getItem(pKey) || "free";
    const savedPlanStart = localStorage.getItem(`ats-plan-start-${user.email}`) || null;
    setUser(prev => prev ? { ...prev, plan: savedPlan, planStart: savedPlanStart } : prev);
  }, [user?.email]);

  const setResume = (val) => {
    setResumeState(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      if (user?.email) { try { localStorage.setItem(`ats-resume-${user.email}`, JSON.stringify(next)); } catch {} }
      return next;
    });
  };

  const setSelectedTemplate = (val) => {
    setTemplateState(val);
    if (user?.email) { try { localStorage.setItem(`ats-template-${user.email}`, JSON.stringify(val)); } catch {} }
  };

  const [paymentToast, setPaymentToast] = useState(""); // success / cancelled

  const upgradePlan = (plan = "premium") => {
    if (!user?.email) return;
    localStorage.setItem(`ats-plan-${user.email}`, plan);
    if (plan === "premium") {
      const start = user.planStart || new Date().toISOString();
      localStorage.setItem(`ats-plan-start-${user.email}`, start);
      setUser(prev => ({ ...prev, plan, planStart: start }));
    } else {
      setUser(prev => ({ ...prev, plan, planStart: null }));
    }
    setUpgradeModal(null);
    if (plan === "premium") setPage(PAGES.DASHBOARD);
  };

  // Open Stripe Payment Link, appending user email for pre-fill + success redirect
  const openStripeCheckout = () => {
    const stripeLink = import.meta.env.VITE_STRIPE_PAYMENT_LINK;
    if (!stripeLink) {
      alert("Add VITE_STRIPE_PAYMENT_LINK to your .env file to enable payments.");
      return;
    }
    const successUrl = `${window.location.origin}?payment=success`;
    const cancelUrl  = `${window.location.origin}?payment=cancelled`;
    const params = new URLSearchParams({
      prefilled_email: user?.email || "",
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    window.open(`${stripeLink}?${params}`, "_blank");
  };

  // Detect return from Stripe payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      upgradePlan("premium");
      setPaymentToast("success");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (payment === "cancelled") {
      setPaymentToast("cancelled");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!paymentToast) return;
    const t = setTimeout(() => setPaymentToast(""), 5000);
    return () => clearTimeout(t);
  }, [paymentToast]);

  const needUpgrade = (feature) => setUpgradeModal(feature);

  useEffect(() => { document.documentElement.className = dark ? "dark" : ""; }, [dark]);

  const renderPage = () => {
    switch (page) {
      case PAGES.HOME: return <HomePage setPage={setPage} />;
      case PAGES.LOGIN: return <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.REGISTER: return <AuthPage mode="register" setPage={setPage} setUser={setUser} />;
      case PAGES.DASHBOARD: return user
        ? <DashboardPage setPage={setPage} user={user} resume={resume} setResume={setResume} template={selectedTemplate} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.BUILDER: return user
        ? <BuilderPage key={user.email} resume={resume} setResume={setResume} template={selectedTemplate}
            onTemplateChange={setSelectedTemplate} user={user} onNeedUpgrade={needUpgrade} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      case PAGES.TEMPLATES: return <TemplatesPage setPage={setPage} onSelectTemplate={setSelectedTemplate}
          currentTemplate={selectedTemplate} user={user} onNeedUpgrade={needUpgrade} />;
      case PAGES.PRICING: return (user && isPremium(user))
        ? <DashboardPage setPage={setPage} user={user} resume={resume} setResume={setResume} template={selectedTemplate} />
        : <PricingPage setPage={setPage} user={user} onUpgrade={upgradePlan} onDowngrade={() => upgradePlan("free")} onStripeCheckout={openStripeCheckout} />;
      case PAGES.SUBSCRIPTION: return user
        ? <SubscriptionPage user={user} setPage={setPage} />
        : <AuthPage mode="login" setPage={setPage} setUser={setUser} />;
      default: return <HomePage setPage={setPage} />;
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="app-bg app-text" style={{ minHeight: "100vh", fontFamily: "var(--font-body)" }}>
        <Navbar page={page} setPage={setPage} dark={dark} setDark={setDark} user={user} setUser={setUser} />
        {renderPage()}
        {upgradeModal && (
          <UpgradeModal feature={upgradeModal} onClose={() => setUpgradeModal(null)}
            onUpgrade={() => { setUpgradeModal(null); openStripeCheckout(); }} />
        )}

        {/* Payment result toast */}
        {paymentToast && (
          <div style={{
            position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
            zIndex: 2000, display: "flex", alignItems: "center", gap: 12,
            padding: "14px 24px", borderRadius: 14,
            background: paymentToast === "success" ? "#059669" : "#DC2626",
            color: "#fff", fontWeight: 600, fontSize: 15,
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            animation: "fadeInUp 0.3s ease",
            whiteSpace: "nowrap",
          }}>
            {paymentToast === "success" ? (
              <><span style={{ fontSize: 20 }}>🎉</span> Payment successful! You're now on Premium.</>
            ) : (
              <><span style={{ fontSize: 20 }}>↩</span> Payment cancelled — you're still on Free.</>
            )}
            <button onClick={() => setPaymentToast("")} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 18, marginLeft: 8, lineHeight: 1 }}>×</button>
          </div>
        )}
      </div>
    </>
  );
}
