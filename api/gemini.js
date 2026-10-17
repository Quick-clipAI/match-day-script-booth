// /api/gemini.js
// Server-side proxy for Gemini's generateContent endpoint.
// The API key lives in a Vercel environment variable (GEMINI_API_KEY),
// never in the browser, so it can't be viewed via "view source" or dev tools.

export default async function handler(req, res) {
  // CORS: needed now that the Android app (bundled locally, different origin) calls this same
  // endpoint via its absolute URL instead of a same-origin relative path. The website itself is
  // unaffected — same-origin requests don't look at these headers at all.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

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

  // Model names live in Vercel environment variables, so a model retirement needs no code change.
  //   GEMINI_MODEL           one name, or several separated by commas in priority order, e.g.
  //                          gemini-2.5-flash,gemini-2.5-flash-lite
  //   GEMINI_FALLBACK_MODEL  optional extra model appended to the end of that list
  // If a model is gone (404) or Google is overloaded (503/500), the next one in the list is tried.
  const chain = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.5-flash-lite')
    .split(',').map(x => x.trim()).filter(Boolean);
  const extra = (process.env.GEMINI_FALLBACK_MODEL || '').trim();
  if (extra && chain.indexOf(extra) === -1) chain.push(extra);

  const call = async (model) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, system_instruction, tools })
    });
    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, data, model };
  };

  try {
    let r = null;
    for (let i = 0; i < chain.length && i < 4; i++) {
      r = await call(chain[i]);
      // 404 = model gone, 5xx = Google busy, 429 = this model's own free quota is used up. In each case the next
      // model in the list (which has its own quota) may still answer. If every model refuses a request that carries
      // the search tool, the app retries without it and says live search was not used.
      const retry = [404, 500, 502, 503, 429].includes(r.status);
      if (!retry) break;
    }
    res.setHeader('x-gemini-model', r.model);
    return res.status(r.status).json(r.data);
  } catch (err) {
    return res.status(502).json({ error: { message: 'Could not reach Gemini: ' + (err && err.message) } });
  }
}
