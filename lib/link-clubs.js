// lib/link-clubs.js  Links our clubs to API-Football team ids so their squads can be fetched.
// 1) a league with no "teams" list yet: one request (teams?league&season=2024)
// 2) free: re-match API teams we already know but could not name-match, using a looser name rule
// 3) optional, 1 request per club: teams?search=<name>, accepted ONLY when exactly one plausible club comes back.
import { LEAGUE_API } from './sync-transfers.js';
import { mapTeamsToClubs } from './sync-transfers.js';
import { norm } from './bank-core.js';

const COUNTRY = { EPL: 'england', LALIGA: 'spain', LIGUE1: 'france', BUNDESLIGA: 'germany', SERIEA: 'italy', SPL: 'saudi-arabia' };
const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'rc', 'rcd', 'fk', 'sv', 'tsg', 'vfb', 'vfl', 'fsv', 'afc', 'al', 'de', 'club', 'calcio', 'bc', 'ud', 'cd', 'sd', 'real']);
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(t => t && !/^\d+$/.test(t) && !STOP.has(t));
/** "Leverkusen" ~ "Bayer 04 Leverkusen", "Leeds" ~ "Leeds United", "Lazio" ~ "SS Lazio". One name's words must all appear in the other. */
export function looseSame(a, b) {
  const x = tokens(a), y = tokens(b); if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every(t => l.includes(t));
}
const BAD = /\b(w|women|u\d\d|ii|iii|b|reserves|youth)\b/i;

export function rematch(ids, clubs, league) {
  const unnamed = ids.filter(i => i.league === league && !i.club && i.api_name);
  const taken = new Set(ids.filter(i => i.league === league && i.club).map(i => i.club));
  const out = [];
  for (const club of clubs) {
    if (taken.has(club)) continue;
    const hits = unnamed.filter(u => looseSame(u.api_name, club));
    if (hits.length === 1 && clubs.filter(c => !taken.has(c) && looseSame(hits[0].api_name, c)).length === 1) out.push({ api_team_id: hits[0].api_team_id, league, club, api_name: hits[0].api_name, source: 'teams' });
  }
  return out;
}

export async function linkClubs(store, { getTeams, searchTeams, search = false, maxCalls = 5, reserve = 30, tried = [] } = {}) {
  const triedSet = new Set(tried);
  const idx = await store.clubIndex(); const season = Math.max(0, ...idx.map(c => c.last_season || 0));
  const clubsBy = new Map();
  for (const c of idx) if (LEAGUE_API[c.league] && c.last_season >= season) (clubsBy.get(c.league) || clubsBy.set(c.league, []).get(c.league)).push(c.club);
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  let ids = await store.listTeamIds(), calls = 0, left = null, error = null; const linked = [], skipped = [];
  const err = j => { const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : []; return e.length ? e.join('; ').slice(0, 140) : ''; };
  const room = () => calls < maxCalls && !(left != null && left <= reserve) && !error;
  for (const [league, clubs] of clubsBy) {                                   // 1) leagues with no teams list yet
    if (ids.some(i => i.league === league && i.source === 'teams') || !room()) continue;
    try {
      const j = await getTeams(LEAGUE_API[league], 2024); calls++; if (j && j.__left != null) left = j.__left;
      const e = err(j); if (e) { error = `${league}: ${e}`; break; }
      await store.upsertTeamIds(mapTeamsToClubs(j.response || [], clubs, aliasMap).map(r => ({ ...r, league, source: 'teams' }))); ids = await store.listTeamIds();
    } catch (x) { error = `${league}: ${String(x && x.message || x).slice(0, 120)}`; }
  }
  for (const [league, clubs] of clubsBy) {                                   // 2) free re-match
    const rows = rematch(ids, clubs, league);
    if (rows.length) { await store.upsertTeamIds(rows); ids = await store.listTeamIds(); rows.forEach(r => linked.push({ league, club: r.club, api_name: r.api_name, how: 'name' })); }
  }
  if (search && searchTeams) {                                               // 3) search by name, one request per club
    for (const [league, clubs] of clubsBy) {
      if (!COUNTRY[league]) continue;
      for (const club of clubs) {
        if (ids.some(i => i.league === league && i.club === club) || triedSet.has(league + '|' + club)) continue;
        if (!room()) break;
        try {
          const j = await searchTeams(club); calls++; if (j && j.__left != null) left = j.__left;
          const e = err(j); if (e) { error = `${club}: ${e}`; break; }
          const c = (j.response || []).filter(r => r.team && !r.team.national && String(r.team.country || '').toLowerCase() === COUNTRY[league] && !BAD.test(r.team.name) && looseSame(r.team.name, club));
          if (c.length === 1) { const row = { api_team_id: c[0].team.id, league, club, api_name: c[0].team.name, source: 'search' }; await store.upsertTeamIds([row]); ids = await store.listTeamIds(); linked.push({ league, club, api_name: row.api_name, how: 'search' }); }
          else skipped.push({ league, club, why: c.length ? `${c.length} possible clubs` : 'no clear match' });
        } catch (x) { error = `${club}: ${String(x && x.message || x).slice(0, 120)}`; }
      }
    }
  }
  const unlinked = []; for (const [league, clubs] of clubsBy) for (const club of clubs) if (!ids.some(i => i.league === league && i.club === club)) unlinked.push({ league, club });
  const summary = `Linked ${linked.length} club(s), ${calls} request(s)${left != null ? ', ' + left + ' left today' : ''}; ${unlinked.length} still not linked` + (error ? ' — ' + error : '');
  if (calls || linked.length) await store.addLog({ kind: 'link-clubs', ok: !error, summary, detail: { calls, linked: linked.length, left, error } });
  return { calls, left, linked, skipped, unlinked, error, summary };
}
