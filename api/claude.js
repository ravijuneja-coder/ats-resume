// Vercel serverless function — proxies requests to Anthropic's API so the
// API key stays server-side and is never shipped in the browser bundle.
// The client sends { system, messages, max_tokens, betaHeader? } and this
// forwards it to Anthropic with the real key attached.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an Anthropic API key." });
    return;
  }

  const { system, messages, max_tokens, betaHeader } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Request must include a non-empty messages array." });
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (betaHeader) headers["anthropic-beta"] = betaHeader;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: max_tokens || 1000,
        system: system || undefined,
        messages,
      }),
    });

    const data = await anthropicRes.json().catch(() => ({}));
    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({ error: data.error?.message || `API error ${anthropicRes.status}` });
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: "Failed to reach Anthropic API." });
  }
}
