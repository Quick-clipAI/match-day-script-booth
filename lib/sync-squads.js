// lib/sync-squads.js  Current squads from API-Football (players/squads?team=, 1 request per club) on SPARE quota only,
// matched to the Transfermarkt profiles to get full names, birth dates and nationalities.
// A club that already has a squad for the season in our bank is NOT overwritten: the API snapshot is stored and compared instead.
import { LEAGUE_API, planBudget } from './sync-transfers.js';
import { sameApiName } from './bank-profiles.js';
import { sameClub } from './bank-profiles.js';
import { ageOn } from './bank-squad.js';
import { norm } from './bank-core.js';

const REFRESH_DAYS = 7, PAUSE_MIN = 60;
const iso = ms => new Date(ms).toISOString();
const POS = { goalkeeper: 'Goalkeeper', defender: 'Defender', midfielder: 'Midfielder', attacker: 'Forward', forward: 'Forward' };
export const usedTodayOf = (logs, today) => logs.filter(l => (l.kind === 'sync-transfers' || l.kind === 'sync-squads') && String(l.at || '').slice(0, 10) === today).reduce((n, l) => n + (Number(l.detail && l.detail.calls) || 0), 0);

/** API answer -> compact list [{id, n, name, age, pos, num}] */
export function compactSquad(json) {
  const r = json && json.response && json.response[0];
  return ((r && r.players) || []).map(p => ({ id: p.id, name: p.name, age: Number.isInteger(p.age) ? p.age : null, pos: p.position || null, num: Number.isInteger(p.number) ? p.number : null }));
}

/** Match each API player to ONE Transfermarkt profile. Strong: name pattern + club + age. Fallback: name pattern + age, only if unique (he may have moved since the snapshot). */
export function matchSquad(players, profiles, club, asOf, aliasMap = new Map()) {
  const ageOk = (pr, a) => a == null || !pr.dob || Math.abs(ageOn(String(pr.dob).slice(0, 10), asOf) - a) <= 1;
  const atClub = pr => [pr.tm_club, pr.club].some(c => c && sameClub(c, club, aliasMap));
  return players.map(p => {
    const named = profiles.filter(pr => sameApiName(p.name, pr.name) && ageOk(pr, p.age));
    const here = named.filter(atClub);
    const hit = here.length === 1 ? here[0] : (here.length === 0 && named.length === 1 ? named[0] : null);
    return { p, profile: hit, how: hit ? (here.length === 1 ? 'club' : 'name+age') : (named.length > 1 ? 'ambiguous' : 'none') };
  });
}

export function squadRows({ players, matches, league, season, club, asOf }) {
  const rows = [];
  for (const m of matches) {
    const pr = m.profile, d = (pr && pr.data) || {};
    const name = pr ? pr.name : m.p.name;
    const dob = pr && pr.dob ? String(pr.dob).slice(0, 10) : null;
    rows.push({
      id: `${league}|${season}|${club.toLowerCase()}|${name.toLowerCase()}`, league, season, club, name, shirt: m.p.num, dob, age: m.p.age, age_as_of: m.p.age != null ? asOf : null,
      position: POS[String(m.p.pos || '').toLowerCase()] || null, joined: null, joined_from: null, nationality: d.nat || null,
      club_status: 'active', club_retired_year: null, on_loan: null, loan_from: null, national_status: null, national_retired_year: null, updated_at: new Date().toISOString()
    });
  }
  // one row per id
  return [...new Map(rows.map(r => [r.id, r])).values()];
}

export async function syncSquads(store, { getSquad, now = Date.now(), force = false, maxRun = 3, emptyOnly = false, reserve = 0 } = {}) {
  const today = iso(now).slice(0, 10), tomorrow = iso(now + 864e5).slice(0, 10);
  const logs = await store.recentLogs(150).catch(() => []);
  const usedToday = usedTodayOf(logs, today);
  const lastErr = logs.find(l => l.kind === 'sync-squads' && l.detail && l.detail.error);
  if (!force && lastErr && now - Date.parse(lastErr.at) < PAUSE_MIN * 60000) return { ran: false, calls: 0, summary: 'squads paused after an API error (retry within the hour)' };
  const busy = (await store.listMatches({ fromDate: today, toDate: tomorrow })).length;
  const plan = force ? { run: maxRun, why: '' } : planBudget({ now, usedToday, busy, force, maxRun });   // a forced run is the person's own call; `reserve` below protects the live-score quota
  if (plan.run <= 0) return { ran: false, calls: 0, summary: plan.why || 'no budget', plan };

  const ids = (await store.listTeamIds()).filter(i => i.club && LEAGUE_API[i.league]);
  const idx = await store.clubIndex(); const season = Math.max(0, ...idx.map(c => c.last_season || 0));
  const current = new Set(idx.filter(c => c.last_season >= season).map(c => c.league + '|' + c.club));
  const done = new Map((await store.listApiSquads(false)).map(x => [x.api_team_id, Date.parse(x.fetched_at) || 0]));
  const todo = ids.filter(i => current.has(i.league + '|' + i.club)).map(i => ({ ...i, at: done.get(i.api_team_id) || 0 })).filter(i => emptyOnly ? i.at === 0 : (force || now - i.at >= REFRESH_DAYS * 864e5)).sort((a, b) => a.at - b.at);
  let calls = 0, fetched = 0, applied = 0, kept = 0, errors = [], lastLeft = null, stopped = false; const notes = [];
  let profiles = null; const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  for (const t of todo) {
    if (calls >= plan.run || errors.length || stopped) break;
    try {
      if (emptyOnly && (await store.listPlayers({ league: t.league, season, club: t.club })).length) { kept++; continue; }   // costs no request
      const j = await getSquad(t.api_team_id); calls++; if (j && j.__left != null) lastLeft = j.__left;
      const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : [];
      if (e.length) { errors.push(`${t.club}: ${e.join('; ').slice(0, 140)}`); break; }
      const players = compactSquad(j); fetched++;
      if (lastLeft != null && lastLeft <= reserve) stopped = true;
      const have = await store.listPlayers({ league: t.league, season, club: t.club });
      let didApply = false;
      if (!have.length && players.length) {
        profiles = profiles || await store.listProfiles();
        const m = matchSquad(players, profiles, t.club, today, aliasMap);
        await store.upsertPlayers(squadRows({ players, matches: m, league: t.league, season, club: t.club, asOf: today }));
        const un = m.filter(x => !x.profile).length; didApply = true; applied++;
        notes.push(`${t.club}: ${players.length} players, ${un} without a Transfermarkt match`);
      } else if (have.length) kept++;
      await store.saveApiSquad({ api_team_id: t.api_team_id, league: t.league, club: t.club, fetched_at: iso(now), players, applied: didApply });
    } catch (err) { errors.push(`${t.club}: ${String(err && err.message || err).slice(0, 120)}`); break; }
  }
  const remaining = Math.max(0, todo.length - fetched - (emptyOnly ? kept : 0));
  const summary = `Squads: ${fetched} club(s) fetched (${applied} filled in, ${kept} already had a squad and were kept), ${calls} request(s)${lastLeft != null ? ', ' + lastLeft + ' left today' : ''}; ${remaining} still to fetch${stopped ? ` — stopped to keep ${reserve} requests for live scores` : ''}` + (errors.length ? ' — ' + errors.join(' | ') : '');
  if (calls || errors.length) await store.addLog({ kind: 'sync-squads', ok: !errors.length || calls > 0, summary, detail: { calls, fetched, applied, kept, remaining, left: lastLeft, error: errors[0] || null, notes: notes.slice(0, 6) } });
  return { ran: calls > 0, calls, fetched, applied, kept, remaining, left: lastLeft, stopped, summary, plan };
}

export async function squadStatus(store) {
  const ids = (await store.listTeamIds()).filter(i => i.club && LEAGUE_API[i.league]);
  const got = await store.listApiSquads(false);
  const logs = await store.recentLogs(150).catch(() => []);
  const t0 = new Date().toISOString().slice(0, 10), t1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const ms = await store.listMatches({ fromDate: t0, toDate: t1 }).catch(() => []);
  const lastLeft = (logs.find(l => (l.kind === 'sync-squads' || l.kind === 'sync-transfers') && l.detail && l.detail.left != null && String(l.at || '').slice(0, 10) === t0) || { detail: {} }).detail.left;
  return { today: t0, matchesToday: ms.filter(m => m.date === t0).length, matchesTomorrow: ms.filter(m => m.date === t1).length, left: lastLeft == null ? null : lastLeft, clubs: ids.length, fetched: got.length, applied: got.filter(g => g.applied).length, lastLog: (logs.find(l => l.kind === 'sync-squads') || {}).summary || null };
}

/** API coach answer -> { name, nationality } of the person whose career has an open entry at this team. */
export function compactCoach(json, teamId) {
  const list = (json && json.response) || [];
  const cur = list.find(c => (c.career || []).some(x => x.team && x.team.id === Number(teamId) && !x.end)) || null;
  return cur && cur.name ? { name: String(cur.name), nationality: cur.nationality || null } : null;
}

/** The clubs the person can tick: one row per club with an API id in the current season. */
export async function squadPicker(store) {
  const ids = (await store.listTeamIds()).filter(i => i.club && LEAGUE_API[i.league]);
  const idx = await store.clubIndex(); const season = Math.max(0, ...idx.map(c => c.last_season || 0));
  const current = new Set(idx.filter(c => c.last_season >= season).map(c => c.league + '|' + c.club));
  const got = new Map((await store.listApiSquads(false)).map(x => [x.api_team_id, x.fetched_at]));
  const [players, coaches] = await Promise.all([store.listPlayers({ season }), store.listCoaches({ season }).catch(() => [])]);
  const n = new Map(); for (const p of players) { const k = p.league + '|' + p.club; n.set(k, (n.get(k) || 0) + 1); }
  const co = new Set(coaches.map(c => c.league + '|' + c.club));
  const clubs = ids.filter(i => current.has(i.league + '|' + i.club)).map(i => ({ api_team_id: i.api_team_id, league: i.league, club: i.club, players: n.get(i.league + '|' + i.club) || 0, coach: co.has(i.league + '|' + i.club), fetched_at: got.get(i.api_team_id) || null }));
  clubs.sort((a, b) => a.league.localeCompare(b.league) || a.club.localeCompare(b.club));
  return { season, clubs };
}

/** Fetches the clubs the person ticked, one after the other. Never overwrites an existing squad. Returns one result per club. */
export async function syncSquadClubs(store, { getSquad, getCoach, teamIds, withCoach = false, now = Date.now(), reserve = 0 } = {}) {
  const today = iso(now).slice(0, 10);
  const ids = (await store.listTeamIds()).filter(i => i.club && LEAGUE_API[i.league]);
  const idx = await store.clubIndex(); const season = Math.max(0, ...idx.map(c => c.last_season || 0));
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  let profiles = null, calls = 0, left = null, stopped = false; const results = [];
  for (const tid of teamIds) {
    const t = ids.find(i => i.api_team_id === Number(tid)); if (!t) continue;
    if (stopped) break;
    const res = { api_team_id: t.api_team_id, league: t.league, club: t.club, api_players: 0, applied: false, kept: false, unmatched: 0, coach: null, error: null, players: [] };
    try {
      const j = await getSquad(t.api_team_id); calls++; if (j && j.__left != null) left = j.__left;
      const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : [];
      if (e.length) throw new Error(e.join('; ').slice(0, 140));
      const players = compactSquad(j); res.api_players = players.length;
      const have = await store.listPlayers({ league: t.league, season, club: t.club });
      let didApply = false;
      if (!have.length && players.length) {
        profiles = profiles || await store.listProfiles();
        const m = matchSquad(players, profiles, t.club, today, aliasMap);
        await store.upsertPlayers(squadRows({ players, matches: m, league: t.league, season, club: t.club, asOf: today }));
        res.unmatched = m.filter(x => !x.profile).length; didApply = true; res.applied = true;
      } else if (have.length) res.kept = true;
      await store.saveApiSquad({ api_team_id: t.api_team_id, league: t.league, club: t.club, fetched_at: iso(now), players, applied: didApply });
      if (withCoach && getCoach && !(left != null && left <= reserve)) {
        try {
          const c = await getCoach(t.api_team_id); calls++; if (c && c.__left != null) left = c.__left;
          const co = compactCoach(c, t.api_team_id);
          if (co) { await store.upsertCoaches([{ id: `${t.league}|${season}|${t.club.toLowerCase()}`, league: t.league, season, club: t.club, name: co.name.slice(0, 120), nationality: co.nationality ? String(co.nationality).slice(0, 80) : null, as_of: today, updated_at: iso(now) }]); res.coach = co.name; }
        } catch (err) { res.coach_error = String(err && err.message || err).slice(0, 100); }
      }
      res.players = (await store.listPlayers({ league: t.league, season, club: t.club })).map(p => ({ name: p.name, shirt: p.shirt, position: p.position, age: p.age })).sort((a, b) => (a.shirt ?? 999) - (b.shirt ?? 999));
      if (!res.coach) { const cs = await store.listCoaches({ league: t.league, season }).catch(() => []); const c = cs.find(x => x.club === t.club); if (c) res.coach = c.name; }
    } catch (err) { res.error = String(err && err.message || err).slice(0, 140); stopped = true; }
    results.push(res);
    if (left != null && left <= reserve) stopped = true;
  }
  const done = results.filter(r => !r.error).length;
  const summary = `Squads (picked): ${done} club(s), ${calls} request(s)${left != null ? ', ' + left + ' left today' : ''}` + (results.find(r => r.error) ? ' — ' + results.find(r => r.error).club + ': ' + results.find(r => r.error).error : '');
  if (calls) await store.addLog({ kind: 'sync-squads', ok: !results.some(r => r.error) || done > 0, summary, detail: { calls, fetched: done, left, error: (results.find(r => r.error) || {}).error || null, picked: true } });
  return { results, calls, left, stopped, summary };
}
