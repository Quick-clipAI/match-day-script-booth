// lib/striker.js — StrikerAPI (Champions League match data test). Called from the admin function (action "striker") so the
// site stays within the free plan's 12 serverless functions. The key lives only in the Vercel env var STRIKERAPI_KEY.
import https from 'node:https';
import { importUpcoming } from './striker-upcoming.js';

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
export async function strikerCall(tool, args, env = process.env, poster = post) {
  const key = String(env.STRIKERAPI_KEY || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!key) return { status: 500, body: { error: 'STRIKERAPI_KEY is not set on the server' } };
  if (!STRIKER_COSTS[tool]) return { status: 400, body: { error: 'Tool not allowed here', allowed: Object.keys(STRIKER_COSTS) } };
  try {
    const r = await poster('/v1/ucl/' + tool, key, args && typeof args === 'object' ? args : {});
    const h = r.headers;
    return { status: 200, body: { ok: r.status >= 200 && r.status < 300, status: r.status, tool, cost: STRIKER_COSTS[tool],
      creditsUsed: h['x-credits-used'] != null ? Number(h['x-credits-used']) : null, creditsLeft: h['x-credits-remaining'] != null ? Number(h['x-credits-remaining']) : null,
      data: r.json != null ? r.json : { raw_response: r.raw.slice(0, 2000) } } };
  } catch (e) { return { status: 502, body: { error: 'Could not reach StrikerAPI: ' + String(e && e.message || e) } }; }
}

const gamesOf = d => { const x = d && (d.games || (d.data && d.data.games)); return Array.isArray(x) ? x : []; };
export const gamesInList = gamesOf;

/** Calls StrikerAPI and keeps the full answer in the striker_results table (so it can be read without copying). */
export async function strikerSaved(store, tool, args, env = process.env, poster = post) {
  const r = await strikerCall(tool, args, env, poster);
  const b = r.body || {};
  try { await store.saveStriker({ tool, args, game_id: args && args.game_id ? String(args.game_id) : null, ok: !!b.ok, http_status: b.status ?? r.status, credits_used: b.creditsUsed, credits_left: b.creditsLeft, data: b.data ?? (b.error ? { error: b.error } : null) }); b.saved = true; }
  catch (e) { b.saved = false; b.saveError = String(e && e.message || e).slice(0, 120); }
  return { status: r.status, body: b };
}

/** Bulk: step "list" asks for the whole season once (2 credits); step "games" fetches up to `max` not-yet-saved matches (5 credits each),
 *  stopping when fewer than `reserve` credits are left or the time budget is used. */
export async function strikerBulk(store, { step, season, max = 6, reserve = 60, budgetMs = 40000, dryRun = false, status, save = false } = {}, env = process.env, poster = post) {
  if (step === 'upcoming') {        // PROBE ONLY (2 credits, not saved, so it cannot replace the saved season list): does the list also give matches that are not played yet?
    const st = String(status || 'scheduled').replace(/[^a-z_]/gi, '').slice(0, 20) || 'scheduled';
    const r = await strikerCall('list_games', { season: Number(season) || 2026, status: st, limit: 100 }, env, poster);
    const b = r.body || {}, g = gamesOf(b.data);
    const imp = save && b.ok && g.length ? await importUpcoming(store, g, { league: 'UCL', season: Number(season) || 2026 }) : null;
    return { imported: imp, step, asked: st, ok: !!b.ok, http: b.status ?? r.status, matches: g.length, statuses: [...new Set(g.map(x => x && x.status))], from: g.length ? g.map(x => x.date).sort()[0] : null, to: g.length ? g.map(x => x.date).sort().pop() : null,
      sample: g.slice(0, 3).map(x => `${x.date} ${x.home && x.home.name} v ${x.away && x.away.name} (${x.status})`), creditsLeft: b.creditsLeft ?? null, error: b.error || (b.data && b.data.error) || (!b.ok ? String(JSON.stringify(b.data || '')).slice(0, 240) : null) };
  }

  if (step === 'list') {
    const r = await strikerSaved(store, 'list_games', { season: Number(season) || 2026, status: 'final', limit: 100 }, env, poster);
    const g = gamesOf(r.body.data);
    return { step, ok: !!r.body.ok, matches: g.length, creditsLeft: r.body.creditsLeft ?? null, error: r.body.error, saved: r.body.saved };
  }
  if (step === 'events') {          // get_events (10 credits) for saved games whose key_events do not add up to the score; max 3 a press, stops at the reserve
    const games = await store.strikerGames();
    const have = new Set((await store.strikerDoneIds('get_events').catch(() => [])).map(String));
    const need = [];
    for (const g of games) {
      const d = g && (g.data && g.data.game ? g.data : g); const game = d && d.game; if (!game || have.has(String(game.game_id))) continue;
      const goals = (Array.isArray(d.key_events) ? d.key_events : []).filter(e => e.type === 'goal' && !e.shootout).length;
      if (goals !== (Number(game.home.score) || 0) + (Number(game.away.score) || 0) && !need.some(x => x === String(game.game_id))) need.push(String(game.game_id));
    }
    if (dryRun || !need.length) return { step, need: need.length, cost: need.length * 10, fetched: 0 };
    let fetched = 0, left = null, stopped = null; const t0 = Date.now();
    for (const id of need.slice(0, Math.max(1, Math.min(max, 3)))) {
      if (Date.now() - t0 > budgetMs) { stopped = 'time'; break; }
      if (left != null && left - 10 < reserve) { stopped = 'credits'; break; }
      const r = await strikerSaved(store, 'get_events', { game_id: id }, env, poster);
      if (!r.body.ok) { stopped = 'error: ' + String(r.body.error || ('HTTP ' + r.body.status)).slice(0, 100); break; }
      fetched++; if (r.body.creditsLeft != null) left = r.body.creditsLeft;
    }
    return { step, need: need.length - fetched, cost: (need.length - fetched) * 10, fetched, creditsLeft: left, stopped };
  }
  const list = await store.strikerLatestList();
  const all = gamesOf(list).filter(g => g && g.game_id != null && (!g.status || g.status === 'final'));
  const done = new Set((await store.strikerDoneIds('get_game')).map(String));
  const todo = all.filter(g => !done.has(String(g.game_id)));
  if (dryRun || !todo.length) return { step: 'games', total: all.length, saved: done.size, remaining: todo.length, cost: todo.length * 5, fetched: 0 };
  const t0 = Date.now(); let fetched = 0, left = null, stopped = null;
  for (const g of todo.slice(0, Math.max(1, Math.min(max, 20)))) {
    if (Date.now() - t0 > budgetMs) { stopped = 'time'; break; }
    if (left != null && left - 5 < reserve) { stopped = 'credits'; break; }
    const r = await strikerSaved(store, 'get_game', { game_id: String(g.game_id) }, env, poster);
    if (!r.body.ok) { stopped = 'error: ' + String(r.body.error || ('HTTP ' + r.body.status)).slice(0, 100); break; }
    fetched++; if (r.body.creditsLeft != null) left = r.body.creditsLeft;
  }
  return { step: 'games', total: all.length, saved: done.size + fetched, remaining: todo.length - fetched, cost: (todo.length - fetched) * 5, fetched, creditsLeft: left, stopped };
}
