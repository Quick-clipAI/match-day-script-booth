// lib/fd-scorers.js  Season top scorers from football-data.org (free plan: PL, PD, SA, FL1, BL1, CL; 10 requests a minute).
// One request per league covers EVERY match of the season, so these lists are complete, unlike our own count which only
// covers matches whose details we have saved. Saved in striker_results (tool 'fd_scorers') only when the list changed.
import { guardStore } from './guard.js';
import { sameTeam } from './sync-due.js';

export const FD_CODES = { EPL: 'PL', LALIGA: 'PD', SERIEA: 'SA', LIGUE1: 'FL1', BUNDESLIGA: 'BL1', UCL: 'CL' };
const FRESH_MS = 6 * 3600e3;

async function fdGet(path, key, ms = 9000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch('https://api.football-data.org/v4' + path, { headers: { 'X-Auth-Token': key, Accept: 'application/json' }, signal: ac.signal }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } return { status: r.status, json, text }; }
  catch (e) { return { status: 0, json: null, text: String(e && e.message || e) }; }
  finally { clearTimeout(t); }
}

/** Asks for one league. Returns { league, ok, saved, changed, count, error }. */
export async function fdFetchLeague(store, { key, league, now = Date.now() }) {
  const code = FD_CODES[league]; if (!code) return { league, ok: false, error: 'no football-data code' };
  const r = await fdGet(`/competitions/${code}/scorers?limit=100`, key);
  const list = r.json && Array.isArray(r.json.scorers) ? r.json.scorers : null;
  if (r.status !== 200 || !list) return { league, ok: false, status: r.status, error: (r.json && (r.json.message || r.json.error)) || r.text.slice(0, 120) };
  const season = r.json.season && r.json.season.startDate ? Number(String(r.json.season.startDate).slice(0, 4)) : null;
  const scorers = list.map(x => ({ name: x.player && x.player.name, team: x.team && (x.team.shortName || x.team.name), teamFull: x.team && x.team.name, played: x.playedMatches, goals: x.goals, assists: x.assists == null ? null : x.assists, penalties: x.penalties == null ? null : x.penalties })).filter(x => x.name && x.goals != null);
  const prev = await fdLatest(store, league, season);
  const same = prev && JSON.stringify(prev.scorers) === JSON.stringify(scorers);
  if (!same) await store.saveStriker({ tool: 'fd_scorers', args: { league, season }, ok: true, data: { league, season, fetchedAt: new Date(now).toISOString(), scorers } });
  await guardStore(process.env).set('fd:last:' + league, { t: now });
  return { league, ok: true, count: scorers.length, changed: !same, season };
}

/** The newest saved list for a league and season. */
export async function fdLatest(store, league, season) {
  const rows = await store.strikerRows('fd_scorers').catch(() => []);
  for (let i = rows.length - 1; i >= 0; i--) { const d = rows[i]; if (d && d.league === league && (season == null || d.season === season)) return d; }
  return null;
}

/** Refreshes every league whose list is older than 6 hours (or all, when force). Called by the automatic sync and by the admin button. */
export async function fdRefresh(store, { key, now = Date.now(), force = false, leagues = Object.keys(FD_CODES), max = Infinity, pauseMs = 6500 } = {}) {
  if (!key) return { ok: false, summary: 'FOOTBALL_DATA_API_KEY is not set', results: [] };
  const gs = guardStore(process.env), results = []; let fetched = 0;
  for (const league of leagues) {
    if (fetched >= max) break;
    if (!force) { const last = await gs.get('fd:last:' + league); if (last && now - Number(last.t || 0) < FRESH_MS) { results.push({ league, ok: true, skipped: 'fresh' }); continue; } }
    results.push(await fdFetchLeague(store, { key, league, now })); fetched++;
    if (fetched < max && league !== leagues[leagues.length - 1] && pauseMs) await new Promise(r => setTimeout(r, pauseMs));      // the free plan allows 10 requests a minute
  }
  const done = results.filter(r => r.ok && !r.skipped), bad = results.filter(r => !r.ok);
  return { ok: !bad.length, results, summary: `football-data.org: ${done.length} list${done.length === 1 ? '' : 's'} checked (${done.filter(r => r.changed).length} changed)${results.filter(r => r.skipped).length ? ', ' + results.filter(r => r.skipped).length + ' still fresh' : ''}${bad.length ? ', failed: ' + bad.map(b => b.league + ' (' + (b.error || b.status) + ')').join(', ') : ''}` };
}

/** Our club names for the scorers' teams, using the same matching as the other imports. */
export function placeScorers(list, clubs, aliasMap = new Map()) {
  return list.map(s => { const club = clubs.find(c => sameTeam(s.team, c, aliasMap) || sameTeam(s.teamFull || '', c, aliasMap)) || null; return { ...s, club }; });
}
