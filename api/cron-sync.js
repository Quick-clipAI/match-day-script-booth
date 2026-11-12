// Runs daily from Vercel Cron (vercel.json) and on demand from the admin page ("Run sync now").
// Auth: Vercel sends  Authorization: Bearer <CRON_SECRET>  when that env var exists.
import { storeFromEnv } from '../lib/bank-store.js';
import { runSync, safeEq } from '../lib/sync-run.js';
import { checkAdminKey, guardStore } from '../lib/guard.js';
import { syncDue, stampKickoffs, queueMissingStubs } from '../lib/sync-due.js';
import { fixturesGetter, detailGetter, teamsGetter, transfersGetter, squadGetter, seasonFixturesGetter, coachGetter } from '../lib/apisports.js';
import { syncSquads } from '../lib/sync-squads.js';
import { syncCoaches } from '../lib/sync-coaches.js';
import { syncTransfers } from '../lib/sync-transfers.js';
import { syncDetails } from '../lib/match-detail.js';
import { hlFetch } from '../lib/highlightly.js';
import { fdRefresh } from '../lib/fd-scorers.js';
import { backfillIds } from '../lib/backfill-ids.js';


export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // ?mode=due : check matches that should be over by now. Safe to leave open: it only ever reads the matches we already
  // store, makes at most 2 API requests per run, and will not ask for the same date again within 25 minutes.
  if (req.query && req.query.mode === 'due') {
    const { store, error } = storeFromEnv();
    if (error) return res.status(500).json({ error });
    // Open to everyone, so it is throttled for the whole site: once per 5 minutes, otherwise anybody repeating the
    // address could spend the daily API-Football and Highlightly requests. Calls with the cron secret skip the throttle.
    const dueSecret = (process.env.CRON_SECRET || '').trim(), dueBearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!(dueSecret && dueBearer && safeEq(dueBearer, dueSecret))) {
      const gs = guardStore(process.env), last = await gs.get('due:last'), nowMs = Date.now();
      if (last && nowMs - Number(last.t || 0) < 5 * 60 * 1000) return res.status(200).json({ ok: true, skipped: 'ran less than 5 minutes ago' });
      await gs.set('due:last', { t: nowMs });
    }
    try {
      const key = (process.env.API_SPORTS_KEY || '').trim();
      const r = await syncDue(store, { getFixtures: fixturesGetter(key) });
      let k = { summary: 'skipped' };
      try { k = await stampKickoffs(store, { getFixtures: fixturesGetter(key) }); } catch (e) { k = { summary: 'kick-off stamping failed: ' + String(e && e.message || e).slice(0, 120) }; }
      let qd = { summary: 'skipped' };
      try { qd = await queueMissingStubs(store, { getFixtures: fixturesGetter(key) }); } catch (e) { qd = { summary: 'queueing failed: ' + String(e && e.message || e).slice(0, 120) }; }
      let d = { summary: 'skipped' };
      try { d = await syncDetails(store, { getDetail: detailGetter(key), max: 8 }); } catch (e) { d = { summary: 'details failed: ' + String(e && e.message || e).slice(0, 120) }; }
      // squads first (they feed the player cards), then transfers with whatever is left of this run's 3 requests
      let q = { summary: 'skipped', calls: 0 };
      try { q = await syncSquads(store, { getSquad: squadGetter(key), maxRun: 3 }); } catch (e) { q = { summary: 'squads failed: ' + String(e && e.message || e).slice(0, 120), calls: 0 }; }
      let co = { summary: 'skipped', calls: 0 };      // coach photo ids: its own daily cap (half the clubs a day), never below 15 requests left
      try { co = await syncCoaches(store, { getCoach: coachGetter(key), maxRun: Math.max(0, 3 - (q.calls || 0)), dailyCap: Number(process.env.COACH_DAILY_CAP) || 72, reserve: 15 }); } catch (e) { co = { summary: 'coaches failed: ' + String(e && e.message || e).slice(0, 120), calls: 0 }; }
      let t = { summary: 'skipped' };
      if (process.env.SYNC_TRANSFERS !== 'on') t = { summary: 'transfers paused (set SYNC_TRANSFERS=on to resume)' };
      else try { t = await syncTransfers(store, { getTeams: teamsGetter(key), getTransfers: transfersGetter(key), maxRun: Math.max(0, 3 - (q.calls || 0) - (co.calls || 0)) }); } catch (e) { t = { summary: 'transfers failed: ' + String(e && e.message || e).slice(0, 120) }; }
      // older matches from Highlightly (its own free quota): 2 matches per run, at most 48 a day (96 of its 100 requests); does nothing until the lists were loaded
      let hl = { summary: 'skipped' };
      try { const hk = (process.env.HIGHLIGHTLY_API_KEY || '').trim(); if (hk) hl = await hlFetch(store, { key: hk, max: 6, dailyCap: 48, budgetMs: 20000 }); } catch (e) { hl = { summary: 'highlightly failed: ' + String(e && e.message || e).slice(0, 120) }; }
      let fd = { summary: 'off' };
      try { const fk = (process.env.FOOTBALL_DATA_API_KEY || '').trim(); if (fk) fd = await fdRefresh(store, { key: fk, max: 1, pauseMs: 0 }); } catch (e) { fd = { summary: 'football-data failed: ' + String(e && e.message || e).slice(0, 120) }; }
      return res.status(200).json({ ok: true, scorers: fd.summary, highlightly: hl.summary, ran: r.ran, filled: r.filled, pending: r.pending, summary: r.summary, kickoffs: k.summary, queued: qd.summary, details: d.summary, squads: q.summary, coaches: co.summary, transfers: t.summary });
    } catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 200) }); }
  }
  const secret = (process.env.CRON_SECRET || '').trim();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let ok = !!(secret && bearer && safeEq(bearer, secret));
  if (!ok && req.headers['x-admin-key']) {       // the admin key goes through the same wrong-key time-outs as /api/admin
    const gate = await checkAdminKey(req, process.env);
    if (!gate.ok) { if (gate.retryAfter) res.setHeader('Retry-After', String(gate.retryAfter)); return res.status(gate.status === 500 ? 500 : gate.status).json({ error: gate.error }); }
    ok = true;
  }
  if (!ok) return res.status(401).json({ error: 'Not allowed' });
  const { store, error } = storeFromEnv();
  if (error) return res.status(500).json({ error });
  // ?mode=backfill&league=UCL&season=2026 : ONE request that queues every finished match of that season for details
  if (req.query && req.query.mode === 'backfill') {
    try { const r = await backfillIds(store, { getSeasonFixtures: seasonFixturesGetter((process.env.API_SPORTS_KEY || '').trim()), league: String(req.query.league || 'UCL').toUpperCase(), season: Number(req.query.season) }); return res.status(200).json({ ok: !r.error, ...r }); }
    catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 200) }); }
  }
  try {
    const out = await runSync(store);
    return res.status(200).json({ ok: !!(out.api.ok || (out.openfootball && out.openfootball.ok)), api: out.api.summary, openfootball: out.openfootball.summary });
  } catch (e) {
    try { await store.addLog({ kind: 'sync', ok: false, summary: 'Daily sync crashed: ' + String(e && e.message || e).slice(0, 300) }); } catch (_) { /* nothing more to do */ }
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
