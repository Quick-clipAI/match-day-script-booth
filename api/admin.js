// POST /api/admin   header: x-admin-key = ADMIN_KEY   body: { action, ... }
// Everything the admin page does goes through here. Nothing is public: no key, no access.
import { storeFromEnv } from '../lib/bank-store.js';
import { LEAGUES, LEAGUE_KEYS, norm, makeRow, matchId, isIsoDate, currentSeason, coverageOf, computeTable } from '../lib/bank-core.js';
import { applyRows, importText, syncOpenfootball, mergeTeams, resolveInbox } from '../lib/bank-sync.js';
import { runSync, safeEq } from '../lib/sync-run.js';
import { fetchText } from '../lib/apisports.js';
import { normalizeSquad, staleVariants } from '../lib/bank-squad.js';
import { normalizeProfile, mergeProfile, findStored, careerId, describe as describeCareer } from '../lib/bank-career.js';

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
      case 'players': {
        const f = { league: body.league || undefined, season: body.season !== undefined && body.season !== '' ? Number(body.season) : undefined, club: body.club || undefined };
        const [all, coaches] = await Promise.all([store.listPlayers(f), store.listCoaches(f).catch(() => [])]);
        const byClub = new Map();
        for (const x of all) {
          const k = x.league + '|' + x.season + '|' + x.club;
          if (!byClub.has(k)) byClub.set(k, { league: x.league, season: x.season, club: x.club, players: 0, retired: 0, noBirth: 0, coach: null });
          const c = byClub.get(k); c.players++; if (x.club_status === 'retired') c.retired++; if (!x.dob && x.age == null) c.noBirth++;
        }
        for (const c of coaches) { const k = c.league + '|' + c.season + '|' + c.club; if (!byClub.has(k)) byClub.set(k, { league: c.league, season: c.season, club: c.club, players: 0, retired: 0, noBirth: 0, coach: null }); byClub.get(k).coach = c.name; }
        const q = String(body.q || '').trim().toLowerCase();
        const rows = (q || f.club) ? all.filter(x => !q || x.name.toLowerCase().includes(q)).slice(0, Number(body.limit) || 200) : [];
        return res.status(200).json({ total: all.length, clubs: [...byClub.values()].sort((a, b) => a.league.localeCompare(b.league) || b.season - a.season || a.club.localeCompare(b.club)), rows, coachTotal: coaches.length });
      }
      case 'importPlayers': {
        let parsed; try { parsed = typeof body.text === 'string' ? JSON.parse(body.text) : body.data; } catch (e) { return fail(res, 400, 'Invalid JSON. Check commas and quotation marks.'); }
        const packs = Array.isArray(parsed) ? parsed : [parsed];
        const problems = [], warnings = [], notes = [], incoming = [], coachRows = [];
        // club names the bank already knows, per league (so a spelling variant joins the existing club)
        const clubRows = await store.clubIndex(); const aliasRows = await store.listAliases();
        const known = new Map(); clubRows.forEach(c => { if (!known.has(c.league)) known.set(c.league, new Map()); known.get(c.league).set(norm(c.club), c.club); });
        const aliasMap = new Map(aliasRows.map(a => [a.alias, a.canonical]));
        const ctx = { today: now, known, aliasMap, league: body.league, season: body.season };
        let noBirthInfo = 0;
        for (let pi = 0; pi < packs.length; pi++) {
          const r = normalizeSquad(packs[pi], pi, ctx);
          problems.push(...r.problems); warnings.push(...r.warnings); notes.push(...r.notes);
          incoming.push(...r.rows); if (r.coach) coachRows.push(r.coach); noBirthInfo += r.noBirthInfo || 0;
        }
        const existing = await store.listPlayers(); const stale = staleVariants(existing, incoming); const staleIds = new Set(stale.map(x => x.id));
        const merged = new Map(existing.filter(p => !staleIds.has(p.id)).map(p => [p.id, p])); incoming.forEach(p => merged.set(p.id, p));
        const seenShirts = new Map(), seenPlayer = new Map(), shirtDupes = [], multiClub = [];
        for (const p of merged.values()) {
          if (p.club_status === 'retired') continue;
          if (p.shirt != null) { const k = `${p.league}|${p.season}|${p.club.toLowerCase()}|${p.shirt}`; if (seenShirts.has(k)) shirtDupes.push(`${p.club}: shirt ${p.shirt} is used by ${seenShirts.get(k)} and ${p.name} in ${p.season}/${String(p.season + 1).slice(-2)}.`); else seenShirts.set(k, p.name); }
          const k = `${p.season}|${p.name.toLowerCase()}|${p.dob || ''}`; if (seenPlayer.has(k) && seenPlayer.get(k).club.toLowerCase() !== p.club.toLowerCase()) multiClub.push(`${p.name}: listed for both ${seenPlayer.get(k).club} and ${p.club} in ${p.season}/${String(p.season + 1).slice(-2)}.`); else seenPlayer.set(k, p);
        }
        const mine = new Set(incoming.map(p => p.id));
        const mineWarn = x => incoming.some(p => x.includes(p.name) || x.includes(p.club));   // only report clashes that involve this import
        const report = { ok: problems.length === 0, preview: body.dryRun !== false, received: incoming.length, coaches: coachRows.length, noBirthInfo, problems, warnings: [...new Set([...warnings, ...shirtDupes.filter(mineWarn), ...multiClub.filter(mineWarn)])], notes: [...new Set(notes)], duplicates: incoming.length - mine.size, created: incoming.filter(p => !existing.some(e => e.id === p.id)).length };
        report.replaced = stale.length;
        report.updated = incoming.length - report.created - report.duplicates;
        if (problems.length) return res.status(400).json(report);
        if (body.dryRun === false) {
          const uniq = [...new Map(incoming.map(p => [p.id, p])).values()];
          if (stale.length) await store.deletePlayers(stale.map(x => x.id));   // older copies spelled differently (accents)
          await store.upsertPlayers(uniq);
          if (coachRows.length) await store.upsertCoaches([...new Map(coachRows.map(c => [c.id, c])).values()]);
          await store.addLog({ kind: 'players-import', ok: true, summary: `Imported ${uniq.length} players and ${coachRows.length} coaches across ${new Set(uniq.map(p => p.club)).size} club(s).` });
          report.saved = uniq.length;
        }
        return res.status(200).json(report);
      }
      case 'deleteClubSquad': {              // remove one club's squad (e.g. imported under the wrong club name)
        const rows = await store.listPlayers({ league: body.league, season: Number(body.season), club: body.club });
        await store.deletePlayers(rows.map(r => r.id));
        return res.status(200).json({ ok: true, deleted: rows.length });
      }
      case 'career': {
        const rows = await store.listCareer();
        return res.status(200).json({ total: rows.length, rows: rows.slice(0, Number(body.limit) || 500).map(r => ({ id: r.id, name: r.name, dob: r.dob, as_of: r.as_of, summary: describeCareer({ ...r.data, as_of: r.as_of }), source: r.data && r.data.source || null })) });
      }
      case 'deleteCareer': {
        const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).filter(i => typeof i === 'string' && i);
        if (!ids.length) return fail(res, 400, 'Nothing to delete.');
        await store.deleteCareer(ids); await store.addLog({ kind: 'career-delete', ok: true, summary: `Deleted ${ids.length} career profile(s).` });
        return res.status(200).json({ deleted: ids.length });
      }
      case 'importCareer': {
        let parsed; try { parsed = typeof body.text === 'string' ? JSON.parse(body.text) : body.data; } catch (e) { return fail(res, 400, 'Invalid JSON. Check commas and quotation marks.'); }
        const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.profiles) ? parsed.profiles : [parsed]);
        const problems = [], warnings = [], changes = [], notes = [];
        const stored = await store.listCareer();
        const work = new Map(stored.map(r => [r.id, { ...r.data, name: r.name, dob: r.dob, as_of: r.as_of }]));
        const touched = new Map(), dropIds = new Set(); let created = 0, updated = 0;
        for (let i = 0; i < list.length; i++) {
          const r = normalizeProfile(list[i], { today: today() });
          problems.push(...r.problems.map(x => `Profile ${i + 1}: ${x}`)); warnings.push(...r.warnings);
          if (!r.profile) continue;
          const rows = [...work.entries()].map(([id, p]) => ({ id, name: p.name, dob: p.dob }));
          const f = findStored(rows, r.profile);
          if (f.ambiguous) { problems.push(`Profile ${i + 1}: ${r.profile.name} matches more than one stored player. Add dob to say which.`); continue; }
          const old = f.match ? work.get(f.match.id) : null;
          const { merged, changes: ch, notes: nt } = mergeProfile(old, r.profile);
          const newId = careerId(merged.name, merged.dob);
          if (f.match && f.match.id !== newId) { work.delete(f.match.id); touched.delete(f.match.id); dropIds.add(f.match.id); }
          dropIds.delete(newId); work.set(newId, merged); touched.set(newId, merged);
          changes.push(...ch); notes.push(...nt); if (old) updated++; else created++;
        }
        const report = { ok: problems.length === 0, preview: body.dryRun !== false, received: list.length, created, updated, problems, warnings: [...new Set([...warnings, ...notes])], changes: changes.slice(0, 200), changesTotal: changes.length };
        if (problems.length) return res.status(400).json(report);
        if (body.dryRun === false) {
          const rows = [...touched.entries()].map(([id, p]) => { const { name, dob, as_of, ...data } = p; return { id, name, dob: dob || null, as_of: as_of || null, data, updated_at: new Date().toISOString() }; });
          if (dropIds.size) await store.deleteCareer([...dropIds]);
          await store.upsertCareer(rows);
          await store.addLog({ kind: 'career-import', ok: true, summary: `Career profiles: ${created} new, ${updated} updated${changes.length ? `, ${changes.length} existing value(s) changed` : ''}.` });
          report.saved = rows.length;
        }
        return res.status(200).json(report);
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
