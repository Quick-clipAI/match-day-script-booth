// lib/striker.js — StrikerAPI (Champions League match data test). Called from the admin function (action "striker") so the
// site stays within the free plan's 12 serverless functions. The key lives only in the Vercel env var STRIKERAPI_KEY.
import https from 'node:https';

const HOST = 'mcp.strikerapi.com';
export const STRIKER_COSTS = { list_games: 2, get_standings: 2, get_game: 5, get_lineups: 5, get_leaders: 5, get_events: 10 };

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

/** -> { status, body } for the admin function to send. */
export async function strikerCall(tool, args, env = process.env) {
  const key = String(env.STRIKERAPI_KEY || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!key) return { status: 500, body: { error: 'STRIKERAPI_KEY is not set on the server' } };
  if (!STRIKER_COSTS[tool]) return { status: 400, body: { error: 'Tool not allowed here', allowed: Object.keys(STRIKER_COSTS) } };
  try {
    const r = await post('/v1/ucl/' + tool, key, args && typeof args === 'object' ? args : {});
    const h = r.headers;
    return { status: 200, body: { ok: r.status >= 200 && r.status < 300, status: r.status, tool, cost: STRIKER_COSTS[tool],
      creditsUsed: h['x-credits-used'] != null ? Number(h['x-credits-used']) : null, creditsLeft: h['x-credits-remaining'] != null ? Number(h['x-credits-remaining']) : null,
      data: r.json != null ? r.json : { raw_response: r.raw.slice(0, 2000) } } };
  } catch (e) { return { status: 502, body: { error: 'Could not reach StrikerAPI: ' + String(e && e.message || e) } }; }
}
