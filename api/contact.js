// Vercel serverless function — sends the contact form as an email over SMTP
// through the site's own mailbox, so no third-party email API is needed.
// The client sends { name, email, subject, message } and this relays it to
// support@atsresumepilot.com via the SMTP credentials configured below.

import nodemailer from "nodemailer";

const MAX_FIELD_LENGTH = 5000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, CONTACT_TO_EMAIL } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    res.status(500).json({ error: "Server is not configured to send email." });
    return;
  }

  const { name, email, subject, message } = req.body || {};
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Name, email, and message are required." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: "Please provide a valid email address." });
    return;
  }
  if ([name, email, subject, message].some(v => typeof v === "string" && v.length > MAX_FIELD_LENGTH)) {
    res.status(400).json({ error: "One of the fields is too long." });
    return;
  }

  const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const port = Number(SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/others = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    await transporter.verify();
  } catch (err) {
    console.error("SMTP verify failed:", err?.message, err?.code, err?.response);
    res.status(502).json({ error: "Couldn't send your message. Please try again later." });
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"ATS Resume Pilot" <${SMTP_USER}>`,
      to: CONTACT_TO_EMAIL || "support@atsresumepilot.com",
      replyTo: email.trim(),
      subject: `[Contact form] ${subject?.trim() || "New message from ATS Resume Pilot"}`,
      text: `From: ${name.trim()} <${email.trim()}>\n\n${message.trim()}`,
      html: `<p><strong>From:</strong> ${escapeHtml(name.trim())} &lt;${escapeHtml(email.trim())}&gt;</p><p>${escapeHtml(message.trim()).replace(/\n/g, "<br>")}</p>`,
    });
    console.log("Contact email sent:", info.messageId, info.response, "accepted:", info.accepted, "rejected:", info.rejected);
    if (!info.accepted?.length) {
      // sendMail() resolved but the server didn't actually accept the
      // recipient — surface this as a failure instead of a false "sent".
      res.status(502).json({ error: "Couldn't send your message. Please try again later." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("SMTP sendMail failed:", err?.message, err?.code, err?.response);
    res.status(502).json({ error: "Couldn't send your message. Please try again later." });
  }
}
