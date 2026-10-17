// POST /api/admin   header: x-admin-key = ADMIN_KEY   body: { action, ... }
// Everything the admin page does goes through here. Nothing is public: no key, no access.
import { storeFromEnv } from '../lib/bank-store.js';
import { LEAGUES, LEAGUE_KEYS, makeRow, matchId, isIsoDate, currentSeason, coverageOf, computeTable } from '../lib/bank-core.js';
import { applyRows, importText, syncOpenfootball, mergeTeams, resolveInbox } from '../lib/bank-sync.js';
import { runSync, safeEq } from '../lib/sync-run.js';
import { fetchText } from '../lib/apisports.js';

const today = () => new Date().toISOString().slice(0, 10);
const fail = (res, code, msg) => res.status(code).json({ error: msg });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 405, 'POST only');

  const admin = (process.env.ADMIN_KEY || '').trim();
  if (!admin) return fail(res, 500, 'ADMIN_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.');
  const given = String(req.headers['x-admin-key'] || '');
  if (!given || !safeEq(given, admin)) return fail(res, 401, 'Wrong admin key.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return fail(res, 400, 'Body is not JSON'); } }
  body = body || {};
  const action = String(body.action || '');

  if (action === 'ping') {
    return res.status(200).json({
      ok: true,
      env: { SUPABASE_URL: !!process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY, API_SPORTS_KEY: !!process.env.API_SPORTS_KEY, CRON_SECRET: !!process.env.CRON_SECRET, GEMINI_API_KEY: !!(process.env.GEMINI_API_KEY || process.env.GEMINI_KEY), GROQ_API_KEY: !!process.env.GROQ_API_KEY }
    });
  }

  const { store, error } = storeFromEnv();
  if (error) return fail(res, 500, error);
  const t = String(body.today || '');
  const now = isIsoDate(t) ? t : today();

  try {
    switch (action) {
      case 'overview': {
        const [summary, logs, inbox] = await Promise.all([store.summary(now), store.recentLogs(15), store.inboxList()]);
        const lastSync = (await store.recentLogs(60)).find(l => l.kind === 'sync-api');
        return res.status(200).json({ today: now, summary, logs, inboxCount: inbox.length, lastSync: lastSync || null, leagues: LEAGUE_KEYS.map(k => ({ key: k, name: LEAGUES[k].name, short: LEAGUES[k].short, type: LEAGUES[k].type, teams: LEAGUES[k].teams || null, hasOf: !!LEAGUES[k].of, currentSeason: currentSeason(null, now) })) });
      }
      case 'matches': {
        const f = { league: body.league || undefined, season: body.season != null && body.season !== '' ? Number(body.season) : undefined, club: body.club || undefined };
        let rows = await store.listMatches(f);
        const mode = body.mode || 'all';
        if (mode === 'gaps') rows = rows.filter(m => m.status === 'scheduled' && m.date < now);
        else if (mode === 'conflicts') rows = rows.filter(m => m.conflict);
        else if (mode === 'unverified') rows = rows.filter(m => m.status === 'finished' && !m.verified);
        const total = rows.length;
        return res.status(200).json({ total, rows: rows.slice(0, Number(body.limit) || 300) });
      }
      case 'saveMatch': {
        const m = body.match || {};
        const cfg = LEAGUES[m.league];
        if (!cfg) return fail(res, 400, 'Pick a league.');
        const made = makeRow(cfg, { ...m, source: 'manual', verified: true });
        if (made.error) return fail(res, 400, made.error);
        const row = made.row;
        row.id = matchId(cfg, row.season, row.date, row.home, row.away);
        row.conflict = null;
        if (m.id && m.id !== row.id) await store.deleteMatches([m.id]);      // team or date edited: the id changes
        await store.upsertMatches([row]);
        await store.addLog({ kind: 'manual', ok: true, summary: `Saved ${cfg.short}: ${row.home} ${row.hg ?? '–'}-${row.ag ?? '–'} ${row.away} (${row.date})` });
        return res.status(200).json({ ok: true, row });
      }
      case 'setStatus': {                    // postponed / cancelled / back to scheduled, without touching anything else
        const rows = (await store.listMatches({ league: body.league, season: Number(body.season) })).filter(x => x.id === body.id);
        if (!rows.length) return fail(res, 404, 'Match not found.');
        if (!['scheduled', 'postponed', 'cancelled'].includes(body.status)) return fail(res, 400, 'Bad status.');
        const r = { ...rows[0], status: body.status, hg: null, ag: null, verified: true, conflict: null, source: 'manual' };
        await store.upsertMatches([r]);
        return res.status(200).json({ ok: true, row: r });
      }
      case 'resolveConflict': {              // keep the stored score (clear the flag) or take the other source's
        const rows = (await store.listMatches({ league: body.league, season: Number(body.season) })).filter(x => x.id === body.id);
        if (!rows.length || !rows[0].conflict) return fail(res, 404, 'No conflict on that match.');
        const r = { ...rows[0] };
        if (body.take === 'other') { r.hg = r.conflict.hg; r.ag = r.conflict.ag; r.source = r.conflict.source || r.source; }
        r.conflict = null; r.verified = true;
        await store.upsertMatches([r]);
        return res.status(200).json({ ok: true, row: r });
      }
      case 'deleteMatch': {
        await store.deleteMatches([].concat(body.ids || []).slice(0, 200));
        return res.status(200).json({ ok: true });
      }
      case 'import': {
        const rep = await importText(store, { text: body.text, league: body.league || undefined, season: body.season || undefined, dryRun: body.dryRun !== false, applyConflicts: body.applyConflicts || false, mappings: body.mappings || {}, today: now });
        return res.status(rep.error ? 400 : 200).json(rep);
      }
      case 'importOpenfootball': {
        const season = Number(body.season);
        if (!Number.isInteger(season)) return fail(res, 400, 'Pick a season.');
        const out = await syncOpenfootball(store, { fetchText, season, leagues: body.leagues && body.leagues.length ? body.leagues : undefined, today: now, dryRun: body.dryRun !== false, interactive: true, applyConflicts: body.applyConflicts || false });
        return res.status(200).json(out);
      }
      case 'sync': {
        const out = await runSync(store, process.env, now);
        return res.status(200).json({ api: out.api.summary, openfootball: out.openfootball.summary, ok: !!(out.api.ok || out.openfootball.ok) });
      }
      case 'teams': {
        const rows = await store.clubIndex();
        const aliases = await store.listAliases();
        return res.status(200).json({ clubs: rows.filter(r => !body.league || r.league === body.league).sort((a, b) => a.club.localeCompare(b.club)), aliases });
      }
      case 'mergeTeams': {
        const out = await mergeTeams(store, { league: body.league, from: body.from, to: body.to });
        return res.status(out.error ? 400 : 200).json(out);
      }
      case 'inbox': return res.status(200).json({ items: await store.inboxList() });
      case 'resolveInbox': {
        const out = await resolveInbox(store, { team: body.team, mapTo: body.mapTo, today: now });
        return res.status(out.error ? 400 : 200).json(out);
      }
      case 'table': {
        const cfg = LEAGUES[body.league];
        if (!cfg) return fail(res, 400, 'Pick a league.');
        const rows = await store.listMatches({ league: body.league, season: Number(body.season) });
        return res.status(200).json({ table: computeTable(rows, cfg), coverage: (({ gapList, ...c }) => c)(coverageOf(rows, cfg, now)) });
      }
      case 'facts': return res.status(200).json({ facts: await store.listFacts() });
      case 'saveFact': {
        const f = body.fact || {};
        if (!String(f.title || '').trim() || !String(f.body || '').trim()) return fail(res, 400, 'A fact needs a title and text.');
        const tags = (Array.isArray(f.tags) ? f.tags : String(f.tags || '').split(',')).map(x => String(x).trim()).filter(Boolean).slice(0, 20);
        const id = await store.upsertFact({ id: f.id, title: String(f.title).trim().slice(0, 200), body: String(f.body).trim().slice(0, 3000), tags, as_of: isIsoDate(f.as_of) ? f.as_of : null, source: f.source ? String(f.source).slice(0, 300) : null });
        return res.status(200).json({ ok: true, id });
      }
      case 'deleteFact': await store.deleteFact(body.id); return res.status(200).json({ ok: true });
      case 'log': return res.status(200).json({ logs: await store.recentLogs(Number(body.n) || 60) });
      default: return fail(res, 400, 'Unknown action: ' + action);
    }
  } catch (e) {
    return fail(res, 500, String(e && e.message || e).slice(0, 400));
  }
}
