// /api/gemini.js
// Server-side proxy for Gemini's generateContent endpoint.
// The API key lives in a Vercel environment variable (GEMINI_API_KEY),
// never in the browser, so it can't be viewed via "view source" or dev tools.

import { checkAi } from '../lib/guard.js';

const HOUR = 3600 * 1000;
const GONE = new Map();          // model name -> time until which it is skipped (it answered 404)
let LEARNED = { model: '', at: 0 };   // last model that answered

export default async function handler(req, res) {
  // CORS: needed now that the Android app (bundled locally, different origin) calls this same
  // endpoint via its absolute URL instead of a same-origin relative path. The website itself is
  // unaffected — same-origin requests don't look at these headers at all.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-msg-id');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const g = await checkAi(req, process.env);
  if (!g.ok) return res.status(g.status).json({ error: { message: g.message, code: g.code } });

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

  // A model that answered recently is tried first, and one that returned 404 is skipped for an hour (module memory).
  const now = Date.now();
  if (LEARNED.model && now - LEARNED.at < HOUR && chain.indexOf(LEARNED.model) === -1) chain.unshift(LEARNED.model);
  else if (LEARNED.model && now - LEARNED.at < HOUR) { chain.splice(chain.indexOf(LEARNED.model), 1); chain.unshift(LEARNED.model); }
  for (const m of [...chain]) if (GONE.get(m) > now && chain.length > 1) chain.splice(chain.indexOf(m), 1);

  // When every listed model is gone (Google retires models without much notice), ask Google which Flash models this key
  // can use now and try the newest stable ones. Plain stable names only: no preview, image, audio or live variants.
  const discover = async (tried) => {
    const out = [];
    try {
      const lr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
      const ld = await lr.json().catch(() => ({}));
      for (const m of (ld.models || [])) {
        const name = String(m.name || '').replace(/^models\//, '');
        const mm = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/.exec(name);
        if (!mm || tried.includes(name) || GONE.get(name) > Date.now()) continue;
        if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
        out.push({ name, v: parseFloat(mm[1]), lite: !!mm[2] });
      }
    } catch (e) { /* no list, nothing more to try */ }
    return out.sort((x, y) => (y.v - x.v) || (Number(x.lite) - Number(y.lite))).map(x => x.name);
  };

  try {
    let r = null; const tried = [];
    for (let i = 0; i < chain.length && i < 4; i++) {
      r = await call(chain[i]); tried.push(chain[i]);
      if (r.status === 404) GONE.set(chain[i], Date.now() + HOUR);
      else if (r.status === 200) LEARNED = { model: chain[i], at: Date.now() };
      // 404 = model gone, 5xx = Google busy, 429 = this model's own free quota is used up. In each case the next
      // model in the list (which has its own quota) may still answer. If every model refuses a request that carries
      // the search tool, the app retries without it and says live search was not used.
      const retry = [404, 500, 502, 503, 429].includes(r.status);
      if (!retry) break;
    }
    if (r.status === 404) {
      for (const m of (await discover(tried)).slice(0, 3)) {
        r = await call(m); tried.push(m);
        if (r.status === 404) GONE.set(m, Date.now() + HOUR);
        if (r.status === 200) LEARNED = { model: m, at: Date.now() };
        if (![404, 429, 500, 502, 503].includes(r.status)) break;   // answered, or a real error: stop here
      }
    }
    res.setHeader('x-gemini-model', r.model);
    return res.status(r.status).json(r.data);
  } catch (err) {
    return res.status(502).json({ error: { message: 'Could not reach Gemini: ' + (err && err.message) } });
  }
}
