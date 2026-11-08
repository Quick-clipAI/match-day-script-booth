// lib/fd-squads.js  Birth date, nationality and position for players, from football-data.org (free plan: /competitions/{code}/teams
// returns every club WITH its squad; one request per league). It only FILLS EMPTY fields of players we already have: existing
// values are never overwritten, and players it cannot match to exactly one of ours are counted, not added.
import { fdGet, FD_CODES, placeScorers } from './fd-scorers.js';
import { pickPlayer } from './player-match.js';
import { ageOn } from './bank-squad.js';
import { guardStore } from './guard.js';

const POS = { Goalkeeper: 'Goalkeeper', Defence: 'Defender', Midfield: 'Midfielder', Offence: 'Forward' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const SQUAD_LEAGUES = Object.keys(FD_CODES).filter(k => k !== 'UCL');   // the cup squads are the same clubs as the leagues

/** Pure part: teams from the API + our players of one league -> rows to save and a report. */
export function planSquadFill({ teams, roster, aliasMap = new Map(), today }) {
  const clubs = [...new Set(roster.map(p => p.club))];
  const rows = [], rep = { teams: teams.length, players: 0, matched: 0, filled: { dob: 0, nationality: 0, position: 0 }, unmatchedClubs: [], unmatchedPlayers: 0, unmatchedSample: [] };
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
      if (!row.dob && sp.dateOfBirth) { row.dob = sp.dateOfBirth; row.age = ageOn(sp.dateOfBirth, today); row.age_as_of = today; rep.filled.dob++; changed = true; }
      if (!row.nationality && sp.nationality) { row.nationality = sp.nationality; rep.filled.nationality++; changed = true; }
      if (!row.position && POS[sp.position]) { row.position = POS[sp.position]; rep.filled.position++; changed = true; }
      if (changed) byId.set(hit.id, row);
    }
  }
  rows.push(...byId.values());
  return { rows, report: rep };
}

/** Asks football-data.org (1 request per league, 6.2 s apart) and fills the gaps. */
export async function fdSquadsFill(store, { key, leagues = SQUAD_LEAGUES, pauseMs = 6200, today = new Date().toISOString().slice(0, 10), now = Date.now() } = {}) {
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
    const plan = planSquadFill({ teams, roster, aliasMap, today });
    if (plan.rows.length) await store.upsertPlayers(plan.rows);
    await guardStore(process.env).set('fdsq:last:' + league, { t: now }).catch(() => {});
    results.push({ league, ok: true, season, saved: plan.rows.length, ...plan.report });
  }
  const filled = results.reduce((n, r) => n + (r.saved || 0), 0);
  const summary = `football-data.org squads: ${results.filter(r => r.ok).length} of ${results.length} leagues read, ${filled} player(s) completed`;
  await store.addLog({ kind: 'fd-squads', ok: results.some(r => r.ok), summary, detail: { results: results.map(r => ({ league: r.league, ok: r.ok, saved: r.saved, matched: r.matched, unmatched: r.unmatchedPlayers, error: r.error })) } }).catch(() => {});
  return { ok: results.some(r => r.ok), summary, results };
}
