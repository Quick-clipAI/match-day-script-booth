// lib/sync-transfers.js  Pulls each club's recent transfers (with dates and loan/free/fee type) from API-Football, 1 request per club,
// spending only SPARE quota: early in the UTC day (just after the daily reset), never on a busy match day, never more than the day's cap.
// Matching of club names to API team ids is learned two ways: free, from the fixtures the match sync already sees, and from one
// "teams of this league" request per league (season 2024: the newest season the free plan allows).
import { norm } from './bank-core.js';
import { sameClub } from './bank-profiles.js';

export const LEAGUE_API = { EPL: 39, LALIGA: 140, SERIEA: 135, BUNDESLIGA: 78, LIGUE1: 61, SPL: 307, INTERMIAMI: 253 };
const TEAMS_SEASON = 2024, SINCE = '2025-07-01', REFRESH_DAYS = 14, PAUSE_MIN = 60;
const iso = ms => new Date(ms).toISOString();

/** Only moves since `since` that involve this club, in a compact form. */
export function compactMoves(json, teamId, since = SINCE) {
  const out = [];
  for (const row of (json && json.response) || []) {
    const pid = row.player && row.player.id, name = row.player && row.player.name;
    for (const t of row.transfers || []) {
      if (!t || !t.date || t.date < since) continue;
      const inn = t.teams && t.teams.in || {}, out_ = t.teams && t.teams.out || {};
      if (inn.id !== teamId && out_.id !== teamId) continue;
      out.push({ p: pid, n: name, d: t.date, t: t.type || null, f: out_.name || null, to: inn.name || null, fi: out_.id || null, ti: inn.id || null });
    }
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : -1));
}

/** How many requests may be spent now. busy = matches stored for today and tomorrow. */
export function planBudget({ now, usedToday, busy, force = false, maxRun = 3 }) {
  const hour = new Date(now).getUTCHours();
  const cap = busy >= 30 ? 0 : busy >= 15 ? 12 : 36;           // busy match days leave the whole quota to results
  if (!force && (hour < 2 || hour >= 7)) return { run: 0, cap, why: 'outside the quiet hours (02:00-07:00 UTC)' };
  const left = Math.max(0, cap - usedToday);
  return { run: Math.min(maxRun, left), cap, why: left ? '' : (cap ? `today's allowance of ${cap} is used` : `busy match day (${busy} matches), none spent on transfers`) };
}

export function mapTeamsToClubs(apiTeams, clubs, aliasMap) {
  const rows = [];
  for (const t of apiTeams) {
    const nm = t.team && t.team.name; if (!nm) continue;
    const hit = clubs.find(c => norm(c) === norm(nm) || sameClub(nm, c, aliasMap) || (aliasMap.get(norm(nm)) && norm(aliasMap.get(norm(nm))) === norm(c)));
    rows.push({ api_team_id: t.team.id, club: hit || null, api_name: nm });
  }
  return rows;
}

/** Learns team ids from fixtures we already fetched (free). pairs: [{ league, homeClub, awayClub, fx }] */
export function idsFromFixtures(pairs) {
  const out = new Map();
  for (const { league, home, away, fx } of pairs) {
    const h = fx && fx.teams && fx.teams.home, a = fx && fx.teams && fx.teams.away;
    if (h && h.id && LEAGUE_API[league]) out.set(h.id, { api_team_id: h.id, league, club: home, api_name: h.name, source: 'fixture' });
    if (a && a.id && LEAGUE_API[league]) out.set(a.id, { api_team_id: a.id, league, club: away, api_name: a.name, source: 'fixture' });
  }
  return [...out.values()];
}

export async function syncTransfers(store, { getTeams, getTransfers, now = Date.now(), force = false, maxRun = 3 } = {}) {
  const today = iso(now).slice(0, 10), tomorrow = iso(now + 864e5).slice(0, 10);
  const logs = await store.recentLogs(60).catch(() => []);
  const usedToday = logs.filter(l => l.kind === 'sync-transfers' && String(l.at || '').slice(0, 10) === today).reduce((n, l) => n + (Number(l.detail && l.detail.calls) || 0), 0);
  const lastErr = logs.find(l => l.kind === 'sync-transfers' && l.detail && l.detail.error);
  if (!force && lastErr && now - Date.parse(lastErr.at) < PAUSE_MIN * 60000) return { ran: false, calls: 0, summary: 'paused after an API error (retry within the hour)' };
  const busy = (await store.listMatches({ fromDate: today, toDate: tomorrow })).length;
  const plan = planBudget({ now, usedToday, busy, force, maxRun });
  if (plan.run <= 0) return { ran: false, calls: 0, summary: plan.why || 'no budget', plan };

  const idx = await store.clubIndex();
  const currentSeason = Math.max(0, ...idx.map(c => c.last_season || 0));
  const clubsBy = new Map();
  for (const c of idx) if (LEAGUE_API[c.league] && c.last_season >= currentSeason) (clubsBy.get(c.league) || clubsBy.set(c.league, []).get(c.league)).push(c.club);
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  let ids = await store.listTeamIds();
  let calls = 0, fetched = 0, errors = [], lastLeft = null;
  const track = j => { if (j && j.__left != null) lastLeft = j.__left; };
  const apiErr = j => { const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : []; return e.length ? e.join('; ').slice(0, 160) : ''; };

  // 1) leagues with no team ids at all: one "teams" request each
  for (const [league, clubs] of clubsBy) {
    if (calls >= plan.run) break;
    if (ids.some(i => i.league === league && i.source === 'teams')) continue;   // done once per league (ids learned from fixtures are only a few clubs)
    try {
      const j = await getTeams(LEAGUE_API[league], TEAMS_SEASON); calls++; track(j);
      const e = apiErr(j); if (e) { errors.push(`${league} teams: ${e}`); break; }
      const rows = mapTeamsToClubs(j.response || [], clubs, aliasMap).map(r => ({ ...r, league, source: 'teams' }));
      await store.upsertTeamIds(rows); ids = await store.listTeamIds();
    } catch (err) { errors.push(`${league} teams: ${String(err && err.message || err).slice(0, 120)}`); break; }
  }
  // 2) clubs whose transfers are missing or older than the refresh time, never-fetched first
  const done = new Map((await store.listClubTransfers(false)).map(x => [x.api_team_id, Date.parse(x.fetched_at) || 0]));
  const todo = [];
  for (const [league, clubs] of clubsBy) for (const club of clubs) {
    const row = ids.find(i => i.league === league && i.club === club);
    if (!row) continue;
    const at = done.get(row.api_team_id) || 0;
    if (force || now - at >= REFRESH_DAYS * 864e5) todo.push({ league, club, id: row.api_team_id, at });
  }
  todo.sort((a, b) => a.at - b.at);
  for (const t of todo) {
    if (calls >= plan.run || errors.length) break;
    try {
      const j = await getTransfers(t.id); calls++; track(j);
      const e = apiErr(j); if (e) { errors.push(`${t.club}: ${e}`); break; }
      await store.saveClubTransfers({ api_team_id: t.id, league: t.league, club: t.club, fetched_at: iso(now), moves: compactMoves(j, t.id) }); fetched++;
    } catch (err) { errors.push(`${t.club}: ${String(err && err.message || err).slice(0, 120)}`); break; }
  }
  const total = [...clubsBy.values()].reduce((n, l) => n + l.length, 0);
  const remaining = Math.max(0, todo.length - fetched);
  const summary = `Transfers: ${fetched} club(s) fetched, ${calls} request(s)${lastLeft != null ? ', ' + lastLeft + ' left today' : ''}; ${remaining} club(s) still to fetch of ${total}` + (errors.length ? ' — ' + errors.join(' | ') : '');
  if (calls || errors.length) await store.addLog({ kind: 'sync-transfers', ok: !errors.length || calls > 0, summary, detail: { calls, fetched, remaining, busy, left: lastLeft, error: errors[0] || null } });
  return { ran: calls > 0, calls, fetched, remaining, summary, plan };
}

/** For the admin page. */
export async function transferStatus(store, now = Date.now()) {
  const idx = await store.clubIndex(); const cur = Math.max(0, ...idx.map(c => c.last_season || 0));
  const clubs = idx.filter(c => LEAGUE_API[c.league] && c.last_season >= cur);
  const ids = await store.listTeamIds(), done = await store.listClubTransfers(false);
  const mapped = new Set(ids.filter(i => i.club).map(i => i.league + '|' + i.club));
  const fetched = new Set(done.map(d => d.league + '|' + d.club));
  const logs = await store.recentLogs(60).catch(() => []);
  const today = iso(now).slice(0, 10);
  const used = logs.filter(l => l.kind === 'sync-transfers' && String(l.at || '').slice(0, 10) === today).reduce((n, l) => n + (Number(l.detail && l.detail.calls) || 0), 0);
  return { clubs: clubs.length, mapped: clubs.filter(c => mapped.has(c.league + '|' + c.club)).length, fetched: clubs.filter(c => fetched.has(c.league + '|' + c.club)).length, unmapped: clubs.filter(c => !mapped.has(c.league + '|' + c.club)).map(c => `${c.league}: ${c.club}`), usedToday: used, lastLog: (logs.find(l => l.kind === 'sync-transfers') || {}).summary || null };
}
