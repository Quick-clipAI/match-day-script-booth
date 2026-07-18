// /api/gemini.js
// Server-side proxy for Gemini's generateContent endpoint.
// The API key lives in a Vercel environment variable (GEMINI_API_KEY),
// never in the browser, so it can't be viewed via "view source" or dev tools.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: { message: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.' }
    });
  }

  // The browser only ever sends the Gemini request body (contents / system_instruction / tools).
  // We forward it as-is to Google and relay the response back unchanged.
  const { contents, system_instruction, tools } = req.body || {};
  if (!contents) {
    return res.status(400).json({ error: { message: 'Missing "contents" in request body.' } });
  }

  // NOTE: gemini-2.5-flash-lite is deprecated (Google-set shutdown July 22, 2026,
  // and already "no longer available to new users" ahead of that). Its same-tier
  // full sibling, gemini-2.5-flash, is further along — that one's shutdown date
  // (June 17, 2026) has already passed. So this isn't a "revert to the previous
  // model" situation; both 2.5-family options are gone or going. gemini-3.1-flash-lite
  // is the current stable lite-tier model (no shutdown date until May 2027) and
  // keeps the same cost/speed profile this app was built around.
  const model = 'gemini-3.1-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, system_instruction, tools })
    });

    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: { message: 'Could not reach Gemini: ' + (err && err.message) } });
  }
}
