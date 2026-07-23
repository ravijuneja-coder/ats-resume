// Vercel serverless function — sends the contact form as an email via Resend
// so the API key stays server-side. The client sends { name, email, subject,
// message } and this forwards it to Resend, addressed to our support inbox.

const MAX_FIELD_LENGTH = 5000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
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

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "ATS Resume Pilot <contact@atsresumepilot.com>",
        to: ["support@atsresumepilot.com"],
        reply_to: email.trim(),
        subject: `[Contact form] ${subject?.trim() || "New message from ATS Resume Pilot"}`,
        text: `From: ${name.trim()} <${email.trim()}>\n\n${message.trim()}`,
        html: `<p><strong>From:</strong> ${escapeHtml(name.trim())} &lt;${escapeHtml(email.trim())}&gt;</p><p>${escapeHtml(message.trim()).replace(/\n/g, "<br>")}</p>`,
      }),
    });

    if (!resendRes.ok) {
      res.status(502).json({ error: "Couldn't send your message. Please try again later." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: "Couldn't send your message. Please try again later." });
  }
}
