// /api/groq.js
// Server-side proxy for Groq's OpenAI-compatible chat completions endpoint.
// Used as an automatic fallback from /api/gemini when Gemini's free-tier quota
// is exhausted — Groq's free tier (console.groq.com) needs no card and no
// deposit, and comfortably outpaces Gemini's free RPD.
// The key lives in a Vercel environment variable (GROQ_API_KEY), never in the browser.

export default async function handler(req, res) {
  // CORS: needed now that the Android app (bundled locally, different origin) calls this same
  // endpoint via its absolute URL instead of a same-origin relative path.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: { message: 'Server is missing GROQ_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.' }
    });
  }

  // Only the two models that work on our free key, plain chat only (no tools, no search): Groq's search models
  // were retired and cost far more than the free daily allowance. Anything else is refused so the open endpoint
  // cannot be used to burn the daily token budget on other models.
  const ALLOWED = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  const { model, messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: { message: 'Missing "messages" in request body.' } });
  }
  if (model && !ALLOWED.includes(model)) {
    return res.status(400).json({ error: { message: 'Model not allowed: ' + String(model).slice(0, 60) } });
  }
  if (JSON.stringify(messages).length > 120000) {
    return res.status(413).json({ error: { message: 'Request too large.' } });
  }

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: model || ALLOWED[0], messages })
    });

    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: { message: 'Could not reach Groq: ' + (err && err.message) } });
  }
}
