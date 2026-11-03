// /api/striker — server-side proxy to StrikerAPI (Champions League match data test).
// The key lives only in the Vercel env var STRIKERAPI_KEY. Every call costs StrikerAPI credits (free plan: 500 a month),
// so the proxy needs the admin key and only forwards a short list of read-only tools.
import https from 'node:https';
import { safeEq } from '../lib/sync-run.js';

const HOST = 'mcp.strikerapi.com';
const COSTS = { list_games: 2, get_standings: 2, get_game: 5, get_lineups: 5, get_leaders: 5, get_events: 10 };

function post(path, key, body, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ host: HOST, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-api-key': key } }, resp => {
      const chunks = []; resp.on('data', c => chunks.push(c)); resp.on('error', reject);
      resp.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(raw); } catch (_) { /* not JSON */ }
        resolve({ status: resp.statusCode || 0, json, raw, headers: resp.headers || {} }); });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('StrikerAPI did not answer within ' + Math.round(timeoutMs / 1000) + 's')));
    req.on('error', reject); req.write(data); req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  const admin = (process.env.ADMIN_KEY || '').trim(), given = String(req.headers['x-admin-key'] || '');
  if (!admin || !given || !safeEq(admin, given)) return res.status(401).json({ error: 'Not allowed (admin key needed)' });
  const key = (process.env.STRIKERAPI_KEY || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!key) return res.status(500).json({ error: 'STRIKERAPI_KEY is not set on the server' });
  const b = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (_) { return {}; } })() : (req.body || {});
  const tool = String(b.tool || '');
  if (!COSTS[tool]) return res.status(400).json({ error: 'Tool not allowed here', allowed: Object.keys(COSTS) });
  const args = b.args && typeof b.args === 'object' ? b.args : {};
  try {
    const r = await post('/v1/ucl/' + tool, key, args);
    const h = r.headers;
    return res.status(200).json({ ok: r.status >= 200 && r.status < 300, status: r.status, tool, cost: COSTS[tool],
      creditsUsed: h['x-credits-used'] != null ? Number(h['x-credits-used']) : null, creditsLeft: h['x-credits-remaining'] != null ? Number(h['x-credits-remaining']) : null,
      data: r.json != null ? r.json : { raw_response: r.raw.slice(0, 2000) } });
  } catch (e) { return res.status(502).json({ error: 'Could not reach StrikerAPI: ' + String(e && e.message || e) }); }
}
