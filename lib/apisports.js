// lib/apisports.js  — GET to API-Football with exactly one header (see api/football/[...path].js for why).
import https from 'node:https';
import zlib from 'node:zlib';

const API_BASE = process.env.API_SPORTS_BASE || 'https://v3.football.api-sports.io';

export function minimalGet(urlStr, key, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(u, { method: 'GET', headers: { 'x-apisports-key': key } }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('error', reject);
      resp.on('end', () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = String(resp.headers['content-encoding'] || '').toLowerCase();
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) { /* JSON parse below fails and data stays null */ }
        let data = null; try { data = JSON.parse(buf.toString('utf8')); } catch (e) { /* not JSON */ }
        resolve({ status: resp.statusCode || 0, data });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('API-Football did not answer within ' + Math.round(timeoutMs / 1000) + 's')));
    req.on('error', reject);
    req.end();
  });
}

export function fixturesGetter(key) {
  return async (date) => {
    if (!key) throw new Error('API_SPORTS_KEY is not set on the server');
    const r = await minimalGet(`${API_BASE}/fixtures?date=${encodeURIComponent(date)}`, key);
    if (!r.data) throw new Error('API-Football answered HTTP ' + r.status + ' with something that is not JSON');
    return r.data;
  };
}

/** One finished match in full: events + line-ups + statistics + player ratings, 1 credit. */
export function detailGetter(key) {
  return async (id) => {
    if (!key) throw new Error('API_SPORTS_KEY is not set on the server');
    const r = await minimalGet(`${API_BASE}/fixtures?id=${encodeURIComponent(id)}`, key);
    if (!r.data) throw new Error('API-Football answered HTTP ' + r.status + ' with something that is not JSON');
    return r.data;
  };
}

export async function fetchText(url, timeoutMs = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).host);
    return await r.text();
  } finally { clearTimeout(t); }
}
