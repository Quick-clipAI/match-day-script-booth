// lib/fd-squads.js  Birth date, nationality and position for players, from football-data.org (free plan: /competitions/{code}/teams
// returns every club WITH its squad; one request per league). It only FILLS EMPTY fields of players we already have: existing
// values are never overwritten, and players it cannot match to exactly one of ours are counted, not added.
import { fdGet, FD_CODES, placeScorers } from './fd-scorers.js';
import { pickPlayer } from './player-match.js';
import { ageOn } from './bank-squad.js';
import { guardStore } from './guard.js';

// Same country, different spelling: not a conflict.
const NAT = { 'korea, south': 'south korea', 'korea south': 'south korea', 'ivory coast': "cote d'ivoire", "côte d'ivoire": "cote d'ivoire", 'korea republic': 'south korea', 'republic of korea': 'south korea', 'turkiye': 'turkey', 'türkiye': 'turkey', 'czechia': 'czech republic', 'bosnia-herzegovina': 'bosnia and herzegovina', 'congo dr': 'dr congo', 'dr congo': 'dr congo', 'cape verde islands': 'cape verde', 'cabo verde': 'cape verde', 'the gambia': 'gambia', 'united states': 'usa', 'united states of america': 'usa' };
const natKey = x => { const k = String(x || '').trim().toLowerCase(); return NAT[k] || k; };
const POS = { Goalkeeper: 'Goalkeeper', Defence: 'Defender', Midfield: 'Midfielder', Offence: 'Forward' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const SQUAD_LEAGUES = Object.keys(FD_CODES).filter(k => k !== 'UCL');   // the cup squads are the same clubs as the leagues

/** Pure part: teams from the API + our players of one league -> rows to save and a report. */
export function planSquadFill({ teams, roster, aliasMap = new Map(), today, mode = 'fill' }) {   // mode: 'fill' (empty fields only) | 'overwrite' (football-data.org wins) | 'preview' (change nothing, list conflicts)
  const clubs = [...new Set(roster.map(p => p.club))];
  const rows = [], rep = { teams: teams.length, players: 0, matched: 0, filled: { dob: 0, nationality: 0, position: 0 }, unmatchedClubs: [], unmatchedPlayers: 0, unmatchedSample: [], conflicts: { dob: 0, nationality: 0 }, conflictSample: [], conflictAll: [], backup: [] };
  const changing = mode === 'overwrite', keep = new Map(roster.map(p => [p.id, { id: p.id, dob: p.dob || null, nationality: p.nationality || null, age: p.age ?? null, age_as_of: p.age_as_of || null }]));
  const byId = new Map();
  for (const t of teams) {
    const club = placeScorers([{ name: 'x', team: t.shortName || t.name, teamFull: t.name }], clubs, aliasMap)[0].club;
    if (!club) { rep.unmatchedClubs.push(t.name); continue; }
    const mine = roster.filter(p => p.club === club);
    for (const sp of t.squad || []) {
      rep.players++;
      const hit = pickPlayer(sp.name, mine);
      if (!hit) { rep.unmatchedPlayers++; if (rep.unmatchedSample.length < 8) rep.unmatchedSample.push(`${sp.name} (${club})`); continue; }
      rep.matched++;
      const row = byId.get(hit.id) || { ...hit }; let changed = false;
      const was = String(row.dob || '').slice(0, 10);
      if (was && sp.dateOfBirth && was !== sp.dateOfBirth) { rep.conflicts.dob++; { const c = { player: hit.name, club, field: 'born', was, now: sp.dateOfBirth }; rep.conflictAll.push(c); if (rep.conflictSample.length < 80) rep.conflictSample.push(c); } if (changing) { row.dob = sp.dateOfBirth; row.age = ageOn(sp.dateOfBirth, today); row.age_as_of = today; rep.filled.dob++; changed = true; } }
      if (row.nationality && sp.nationality && natKey(row.nationality) !== natKey(sp.nationality)) { rep.conflicts.nationality++; { const c = { player: hit.name, club, field: 'nationality', was: row.nationality, now: sp.nationality }; rep.conflictAll.push(c); if (rep.conflictSample.length < 80) rep.conflictSample.push(c); } if (changing) { row.nationality = sp.nationality; rep.filled.nationality++; changed = true; } }
      if (!row.dob && sp.dateOfBirth) { row.dob = sp.dateOfBirth; row.age = ageOn(sp.dateOfBirth, today); row.age_as_of = today; rep.filled.dob++; changed = true; }
      if (!row.nationality && sp.nationality) { row.nationality = sp.nationality; rep.filled.nationality++; changed = true; }
      if (!row.position && POS[sp.position]) { row.position = POS[sp.position]; rep.filled.position++; changed = true; }
      if (changed) byId.set(hit.id, row);
    }
  }
  if (mode === 'preview') byId.clear();
  rows.push(...byId.values());
  rep.backup = rows.map(r => keep.get(r.id));
  return { rows, report: rep };
}

/** Asks football-data.org (1 request per league, 6.2 s apart) and fills the gaps. */
export async function fdSquadsFill(store, { key, mode = 'fill', leagues = SQUAD_LEAGUES, pauseMs = 6200, today = new Date().toISOString().slice(0, 10), now = Date.now() } = {}) {
  if (!key) return { ok: false, error: 'FOOTBALL_DATA_API_KEY is not set on the server', results: [] };
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const results = [];
  for (let i = 0; i < leagues.length; i++) {
    const league = leagues[i], code = FD_CODES[league];
    if (!code || league === 'UCL') { results.push({ league, ok: false, error: 'not a domestic league' }); continue; }
    if (i > 0 && pauseMs) await sleep(pauseMs);
    const r = await fdGet(`/competitions/${code}/teams`, key, 20000);
    const teams = r.json && Array.isArray(r.json.teams) ? r.json.teams : null;
    if (r.status !== 200 || !teams) { results.push({ league, ok: false, status: r.status, error: (r.json && (r.json.message || r.json.error)) || String(r.text || '').slice(0, 120) }); continue; }
    const season = r.json.season && r.json.season.startDate ? Number(String(r.json.season.startDate).slice(0, 4)) : null;
    const roster = await store.listPlayers({ league, season });
    if (!roster.length) { results.push({ league, ok: false, error: `no stored players for ${league} ${season}` }); continue; }
    const plan = planSquadFill({ teams, roster, aliasMap, today, mode });
    if (mode === 'overwrite' && plan.report.backup.length) await store.saveStriker({ tool: 'fd_squads_backup', args: { league, season }, ok: true, data: { at: new Date(now).toISOString(), before: plan.report.backup } });   // the old values, so this can be undone
    if (plan.rows.length) await store.upsertPlayers(plan.rows);
    if (mode === 'preview') await store.saveStriker({ tool: 'fd_squads_preview', args: { league, season }, ok: true, data: { at: new Date(now).toISOString(), league, season, conflicts: plan.report.conflictAll, unmatched: plan.report.unmatchedSample } }).catch(() => {});   // full list kept in Supabase so it can be reviewed without copying
    delete plan.report.backup; delete plan.report.conflictAll;
    await guardStore(process.env).set('fdsq:last:' + league, { t: now }).catch(() => {});
    results.push({ league, ok: true, season, saved: plan.rows.length, ...plan.report });
  }
  const filled = results.reduce((n, r) => n + (r.saved || 0), 0);
  const conf = results.reduce((n, r) => n + ((r.conflicts && (r.conflicts.dob + r.conflicts.nationality)) || 0), 0);
  const summary = `football-data.org squads (${mode}): ${results.filter(r => r.ok).length} of ${results.length} leagues read, ${filled} player(s) ${mode === 'preview' ? 'would change' : 'saved'}, ${conf} conflict(s) with our data`;
  await store.addLog({ kind: 'fd-squads', ok: results.some(r => r.ok), summary, detail: { results: results.map(r => ({ league: r.league, ok: r.ok, saved: r.saved, matched: r.matched, unmatched: r.unmatchedPlayers, error: r.error })) } }).catch(() => {});
  return { ok: results.some(r => r.ok), summary, results };
}
