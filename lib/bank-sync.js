// lib/bank-sync.js
// The ways data gets INTO the bank: pasted JSON, the daily API-Football pull, and openfootball files.
// Every route ends in applyRows(), so the rules (never overwrite a different final score, never create a
// duplicate club from a spelling variant) are the same everywhere.

import {
  LEAGUES, norm, cleanDisplay, matchKnownClub, matchId, diffRows, dateFitsSeason, parseOpenfootball, parseApiFootball,
  parseUniversal, detectFormat, leagueFromTitle, seasonFromTitle
} from './bank-core.js';

const sample = (arr, n = 8) => arr.slice(0, n);
const brief = m => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, status: m.status });

function suggestionsFor(name, known) {
  const nt = new Set(norm(name).split(' '));
  const scored = [...known.values()].map(d => {
    const dt = norm(d).split(' ');
    const shared = dt.filter(t => nt.has(t)).length;
    const pref = dt.some(t => [...nt].some(x => x.length >= 3 && (t.startsWith(x.slice(0, 3)) || x.startsWith(t.slice(0, 3))))) ? 0.5 : 0;
    return { d, s: shared + pref };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, 3).map(x => x.d);
}

/**
 * rows: clean rows from the parsers (team names still as the source wrote them).
 * opts: { dryRun, interactive, applyConflicts: true | string[] | false, mappings: {rawName: displayName}, today }
 */
export async function applyRows(store, rows, opts = {}) {
  const { dryRun = false, interactive = true, mappings = {}, today = new Date().toISOString().slice(0, 10) } = opts;
  const applyConflicts = opts.applyConflicts || false;
  const aliasRows = await store.listAliases();
  const aliasMap = new Map(aliasRows.map(a => [a.alias, a.canonical]));
  const learned = new Map();
  const groups = new Map();
  rows.forEach(r => { const k = r.league + '|' + r.season; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });

  const report = { groups: [], totals: { fresh: 0, filled: 0, rescheduled: 0, same: 0, conflicts: 0, enriched: 0, unknown: 0, keptVerified: 0 }, unknownTeams: [], warnings: [], applied: !dryRun };
  const writes = [];
  const inbox = [];

  for (const [gk, list] of groups) {
    const [league, seasonStr] = gk.split('|'); const season = Number(seasonStr);
    const cfg = LEAGUES[league];
    const existing = await store.listMatches({ league, season });
    const byId = new Map(existing.map(m => [m.id, m]));
    const batchNames = new Set(); list.forEach(r => { batchNames.add(norm(r.home)); batchNames.add(norm(r.away)); });
    const known = new Map();
    existing.forEach(m => { known.set(norm(m.home), m.home); known.set(norm(m.away), m.away); });
    const full = cfg.type === 'league' && cfg.teams && known.size >= cfg.teams;   // the club list is complete: a new name is suspicious

    const resolved = [];
    const unknownHere = new Map();
    const resolveName = (raw) => {
      if (mappings[raw]) {
        const d = mappings[raw]; known.set(norm(d), known.get(norm(d)) || d);
        learned.set(norm(raw), d); return { name: d };
      }
      const hit = matchKnownClub(raw, known, aliasMap, batchNames);
      if (hit) { if (norm(raw) !== norm(hit) && !aliasMap.has(norm(raw))) learned.set(norm(raw), hit); return { name: hit }; }
      if (full) return { unknown: true };
      const d = cleanDisplay(raw); known.set(norm(d), d); return { name: d };
    };

    const warns = [];
    for (const r of list) {
      const h = resolveName(r.home), a = resolveName(r.away);
      if (h.unknown || a.unknown) {
        const names = [h.unknown && r.home, a.unknown && r.away].filter(Boolean);
        names.forEach(n => { if (!unknownHere.has(n)) unknownHere.set(n, { league, season, name: n, suggestions: suggestionsFor(n, known), rows: 0 }); unknownHere.get(n).rows++; });
        if (!interactive) names.forEach(n => inbox.push({ key: `${league}|${season}|${r.date}|${norm(r.home)}|${norm(r.away)}|${norm(n)}`, league, season, team: n, row: r, reason: 'club name not recognised' }));
        continue;
      }
      if (h.name === a.name) { warns.push(`${r.home} v ${r.away} on ${r.date} was skipped: both sides resolve to the same club (${h.name}).`); continue; }
      const row = { ...r, home: h.name, away: a.name };
      row.id = matchId(cfg, season, row.date, row.home, row.away);
      if (!dateFitsSeason(cfg, season, row.date)) warns.push(`${row.home} v ${row.away} on ${row.date} is outside season ${season}`);
      if (row.status === 'finished' && row.date > addDays(today, 1)) warns.push(`${row.home} v ${row.away} has a result but is dated ${row.date}, which is in the future`);
      resolved.push(row);
    }
    // a repeat inside one batch (same id twice): the later one wins
    const dedup = new Map(); resolved.forEach(r => dedup.set(r.id, r));
    const incoming = [...dedup.values()];
    const diff = diffRows(byId, incoming);

    const gw = [];           // rows to write for this group
    const enriched = [];
    diff.fresh.forEach(r => gw.push(r));
    diff.filled.forEach(({ existing: ex, incoming: r }) => gw.push({ ...ex, hg: r.hg, ag: r.ag, ht_h: r.ht_h ?? ex.ht_h, ht_a: r.ht_a ?? ex.ht_a, status: 'finished', note: r.note || ex.note, kickoff: r.kickoff || ex.kickoff, source: r.source, conflict: null }));
    diff.rescheduled.forEach(({ existing: ex, incoming: r }) => gw.push({ ...ex, date: r.date, time: r.time || ex.time, kickoff: r.kickoff || ex.kickoff, status: r.status, source: ex.source }));
    let keptVerified = 0;
    const applyIds = Array.isArray(applyConflicts) ? new Set(applyConflicts) : null;
    diff.conflicts.forEach(({ existing: ex, incoming: r }) => {
      const take = applyConflicts === true || (applyIds && applyIds.has(ex.id));
      if (take) gw.push({ ...ex, hg: r.hg, ag: r.ag, ht_h: r.ht_h ?? ex.ht_h, ht_a: r.ht_a ?? ex.ht_a, note: r.note || ex.note, source: r.source, verified: false, conflict: null });
      else if (ex.verified) keptVerified++;
      else if (!ex.conflict || ex.conflict.hg !== r.hg || ex.conflict.ag !== r.ag) gw.push({ ...ex, conflict: { hg: r.hg, ag: r.ag, source: r.source, at: new Date().toISOString().slice(0, 10) } });
    });
    diff.same.forEach(r => {
      const ex = byId.get(r.id); if (!ex) return;
      const patch = {};
      if (!ex.time && r.time) patch.time = r.time;
      if (!ex.round && r.round) patch.round = r.round;
      if (!ex.kickoff && r.kickoff) patch.kickoff = r.kickoff;
      if (ex.status === 'finished' && r.status === 'finished' && ex.ht_h == null && r.ht_h != null) { patch.ht_h = r.ht_h; patch.ht_a = r.ht_a; }
      if (Object.keys(patch).length) { enriched.push(r); gw.push({ ...ex, ...patch }); }
    });
    if (cfg.type === 'league' && cfg.teams && known.size > cfg.teams) warns.push(`${known.size} clubs are stored for ${cfg.short} ${season} but a season has ${cfg.teams}. A spelling variant may have created a duplicate club (see Clubs).`);
    writes.push(...gw);

    report.groups.push({
      league, season, name: cfg.short,
      fresh: diff.fresh.length, filled: diff.filled.length, rescheduled: diff.rescheduled.length, same: diff.same.length,
      conflicts: diff.conflicts.length, enriched: enriched.length, unknown: unknownHere.size, keptVerified,
      samples: {
        fresh: sample(diff.fresh.map(brief)),
        filled: sample(diff.filled.map(x => brief(x.incoming))),
        rescheduled: sample(diff.rescheduled.map(x => ({ ...brief(x.incoming), was: x.existing.date }))),
        conflicts: sample(diff.conflicts.map(x => ({ id: x.existing.id, date: x.existing.date, home: x.existing.home, away: x.existing.away, have: `${x.existing.hg}-${x.existing.ag}`, incoming: `${x.incoming.hg}-${x.incoming.ag}` })))
      },
      warnings: sample(warns, 12)
    });
    const T = report.totals;
    T.fresh += diff.fresh.length; T.filled += diff.filled.length; T.rescheduled += diff.rescheduled.length; T.same += diff.same.length;
    T.conflicts += diff.conflicts.length; T.enriched += enriched.length; T.unknown += unknownHere.size; T.keptVerified += keptVerified;
    report.unknownTeams.push(...unknownHere.values());
    report.warnings.push(...sample(warns, 12));
  }

  if (!dryRun) {
    if (writes.length) await store.upsertMatches(dedupeById(writes));
    if (learned.size) await store.upsertAliases([...learned].map(([alias, canonical]) => ({ alias, canonical })));
    if (inbox.length) await store.inboxAdd(inbox);
  }
  report.written = dryRun ? 0 : dedupeById(writes).length;
  report.inboxAdded = dryRun ? 0 : inbox.length;
  return report;
}
function dedupeById(arr) { const m = new Map(); arr.forEach(r => m.set(r.id, r)); return [...m.values()]; }
export function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** Pasted text -> rows -> report. Understands openfootball files, API-Football answers and our own format. */
export async function importText(store, { text, league, season, dryRun = true, applyConflicts = false, mappings = {}, today }) {
  let obj;
  try { obj = JSON.parse(String(text || '').replace(/^﻿/, '').trim()); }
  catch (e) {
    const m = String(e.message || '').match(/position (\d+)/);
    let where = '';
    if (m) { const pos = Number(m[1]); const t = String(text); const line = t.slice(0, pos).split('\n').length; where = ` (around line ${line}: …${JSON.stringify(t.slice(Math.max(0, pos - 25), pos + 25)).slice(1, -1)}…)`; }
    return { error: 'That is not valid JSON' + where + '. Check for a missing comma or quote, or text pasted before/after the JSON.' };
  }
  const format = detectFormat(obj);
  if (!format) return { error: 'I could not tell what this JSON is. Expected an openfootball file, an API-Football "fixtures" answer, or our format (see “Copy format”).' };
  let parsed, ctxLeague = league, ctxSeason = season ? Number(season) : null;
  if (format === 'openfootball') {
    ctxLeague = ctxLeague || leagueFromTitle(obj.name); ctxSeason = ctxSeason || seasonFromTitle(obj.name);
    if (!ctxLeague || !LEAGUES[ctxLeague]) return { error: `The file is called “${obj.name || ''}” and I cannot tell which league that is. Pick the league and season above and try again.`, needs: ['league', 'season'], format };
    if (!ctxSeason) return { error: 'I cannot tell the season from the file name. Pick the season above.', needs: ['season'], format };
    parsed = parseOpenfootball(obj, { league: ctxLeague, season: ctxSeason, source: 'paste' });
  } else if (format === 'api-football') {
    parsed = parseApiFootball(obj, { source: 'paste' });
  } else {
    parsed = parseUniversal(obj, { league: ctxLeague, season: ctxSeason, source: 'paste' });
  }
  const report = await applyRows(store, parsed.rows, { dryRun, interactive: true, applyConflicts, mappings, today });
  report.format = format; report.problems = sample(parsed.problems || [], 20); report.problemCount = (parsed.problems || []).length;
  if (parsed.skipped) report.skippedCompetitions = parsed.skipped;
  report.rowsRead = parsed.rows.length;
  if (!parsed.rows.length && !(parsed.problems || []).length) report.error = 'The file had no matches I could use.';
  if (!dryRun) await store.addLog({ kind: 'import', ok: true, summary: `Import (${format}): ${report.totals.fresh} new, ${report.totals.filled} results filled, ${report.totals.conflicts} conflicts`, detail: { totals: report.totals, groups: report.groups.map(g => `${g.league} ${g.season}`) } });
  return report;
}

/** Daily pull from API-Football. getFixtures(dateISO) must return the parsed JSON of /fixtures?date= . */
export async function syncApiFootball(store, { getFixtures, today }) {
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const per = [], allRows = [];
  const seen = {};
  for (const date of dates) {
    try {
      const json = await getFixtures(date);
      const errs = json && json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : [];
      if (errs.length) { per.push({ date, error: errs.join('; ').slice(0, 200) }); continue; }
      const p = parseApiFootball(json, { source: 'api-football' });
      per.push({ date, fixtures: (json.response || []).length, kept: p.rows.length, problems: p.problems.length });
      p.rows.forEach(r => { seen[r.league] = (seen[r.league] || 0) + 1; });
      allRows.push(...p.rows);
    } catch (e) { per.push({ date, error: String(e && e.message || e).slice(0, 200) }); }
  }
  const ok = per.some(x => !x.error);
  let report = null;
  if (allRows.length) report = await applyRows(store, allRows, { dryRun: false, interactive: false, today });
  const t = report ? report.totals : null;
  const summary = ok
    ? `API-Football: ${allRows.length} matches in our competitions over ${per.filter(x => !x.error).length} days` + (t ? ` — ${t.fresh} new, ${t.filled} results filled, ${t.rescheduled} rescheduled, ${t.conflicts} conflicts${report.inboxAdded ? ', ' + report.inboxAdded + ' need a club name mapped' : ''}` : '')
    : 'API-Football sync failed: ' + per.map(x => `${x.date}: ${x.error}`).join(' | ');
  await store.addLog({ kind: 'sync-api', ok, summary, detail: { per, seen, totals: t } });
  return { ok, summary, per, seen, report };
}

export function openfootballUrl(league, season) {
  const cfg = LEAGUES[league];
  if (!cfg || !cfg.of) return null;
  return `https://raw.githubusercontent.com/openfootball/football.json/master/${season}-${String(season + 1).slice(-2)}/${cfg.of}.json`;
}

/** Pull openfootball files for the given leagues (domestic only) and apply them. */
export async function syncOpenfootball(store, { fetchText, season, leagues, today, dryRun = false, interactive = false, applyConflicts = false }) {
  const keys = (leagues && leagues.length ? leagues : Object.keys(LEAGUES)).filter(k => LEAGUES[k].of);
  const per = [], allRows = [];
  for (const league of keys) {
    const url = openfootballUrl(league, season);
    try {
      const text = await fetchText(url);
      const obj = JSON.parse(text);
      const p = parseOpenfootball(obj, { league, season, source: 'openfootball' });
      per.push({ league, rows: p.rows.length, problems: p.problems.length });
      allRows.push(...p.rows);
    } catch (e) { per.push({ league, error: String(e && e.message || e).slice(0, 160), url }); }
  }
  let report = null;
  if (allRows.length) report = await applyRows(store, allRows, { dryRun, interactive, today, applyConflicts });
  const ok = per.some(x => !x.error);
  const t = report && report.totals;
  const summary = `openfootball ${season}/${String(season + 1).slice(-2)}: ` + per.map(x => x.error ? `${x.league} ✗ (${x.error})` : `${x.league} ${x.rows} rows`).join(', ') + (t ? ` — ${t.fresh} new, ${t.filled} results filled, ${t.conflicts} conflicts` : '');
  if (!dryRun) await store.addLog({ kind: 'sync-openfootball', ok, summary, detail: { per, totals: t } });
  return { ok, summary, per, report };
}

/** Rename/merge a club inside one league: every match is rewritten and given its new id. */
export async function mergeTeams(store, { league, from, to }) {
  const cfg = LEAGUES[league];
  if (!cfg) return { error: 'unknown league' };
  if (!from || !to || norm(from) === norm(to) && from === to) return { error: 'choose two different names' };
  const all = await store.listMatches({ league });
  const target = new Map(all.map(m => [m.id, m]));
  const touched = all.filter(m => norm(m.home) === norm(from) || norm(m.away) === norm(from));
  const del = [], put = [];
  let dropped = 0;
  for (const m of touched) {
    const nm = { ...m, home: norm(m.home) === norm(from) ? to : m.home, away: norm(m.away) === norm(from) ? to : m.away };
    nm.id = matchId(cfg, nm.season, nm.date, nm.home, nm.away);
    if (nm.id === m.id) { put.push(nm); continue; }
    del.push(m.id);
    const clash = target.get(nm.id);
    if (clash && clash !== m) {
      // the club already has this match under the right name: keep the better row
      const score = x => (x.verified ? 4 : 0) + (x.status === 'finished' ? 2 : 0);
      if (score(m) > score(clash)) put.push(nm); else dropped++;
    } else put.push(nm);
  }
  if (del.length) await store.deleteMatches(del);
  if (put.length) await store.upsertMatches(put);
  await store.upsertAliases([{ alias: norm(from), canonical: to }]);
  await store.addLog({ kind: 'merge', ok: true, summary: `Renamed “${from}” to “${to}” in ${cfg.short}: ${touched.length} matches${dropped ? `, ${dropped} duplicates dropped` : ''}` });
  return { moved: touched.length, dropped };
}

/** The daily job could not place a club name. Once a person says what it is, replay those rows. */
export async function resolveInbox(store, { team, mapTo, today }) {
  const items = (await store.inboxList()).filter(x => x.team === team);
  if (!items.length) return { error: 'nothing waiting for that name' };
  const rows = items.map(i => i.row);
  const report = await applyRows(store, rows, { dryRun: false, interactive: true, mappings: { [team]: mapTo }, today });
  await store.inboxResolve([...new Set(items.map(i => i.key))]);
  await store.addLog({ kind: 'inbox', ok: true, summary: `Mapped “${team}” to “${mapTo}”: ${report.totals.fresh} new, ${report.totals.filled} results filled` });
  return { report };
}
