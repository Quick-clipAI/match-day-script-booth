// lib/sync-coaches.js  Coach photo ids from API-Football (coachs?team=, 1 request per club) on SPARE quota only.
// Why: the team screen shows a coach photo (https://media.api-sports.io/football/coachs/<id>.png) once bank_coaches.api_id is known.
// Budget: at most `dailyCap` requests a day (half of the clubs, so the work is split over two days), never below `reserve`
// requests left (kept for live results), and nothing on match days. A club is done once api_id is set (0 = the API has no coach).
import { LEAGUE_API } from './sync-transfers.js';
import { compactCoach } from './sync-squads.js';
import { noteCoachChange } from './coach-history.js';

const PAUSE_MIN = 60;
const iso = ms => new Date(ms).toISOString();

export async function syncCoaches(store, { getCoach, now = Date.now(), maxRun = 3, dailyCap = 72, reserve = 15, force = false } = {}) {
  const today = iso(now).slice(0, 10), tomorrow = iso(now + 864e5).slice(0, 10);
  const logs = await store.recentLogs(300).catch(() => []);
  const usedToday = logs.filter(l => (l.kind === 'sync-coaches' || l.kind === 'coach-watch') && String(l.at || '').slice(0, 10) === today).reduce((n, l) => n + (Number(l.detail && l.detail.calls) || 0), 0);
  const lastErr = logs.find(l => l.kind === 'sync-coaches' && l.detail && l.detail.error);
  if (!force && lastErr && now - Date.parse(lastErr.at) < PAUSE_MIN * 60000) return { ran: false, calls: 0, summary: 'coaches paused after an API error (retry within the hour)' };
  const busy = (await store.listMatches({ fromDate: today, toDate: tomorrow })).length;
  if (!force && busy >= 15) return { ran: false, calls: 0, summary: `coach photos wait: busy match day (${busy} matches)` };
  const room = Math.min(maxRun, dailyCap - usedToday);
  if (room <= 0) return { ran: false, calls: 0, summary: `coach photos: today's ${dailyCap} requests are used` };

  const ids = (await store.listTeamIds()).filter(i => i.club && LEAGUE_API[i.league]);
  const idx = await store.clubIndex(); const season = Math.max(0, ...idx.map(c => c.last_season || 0));
  const current = new Set(idx.filter(c => c.last_season >= season).map(c => c.league + '|' + c.club));
  const rows = new Map();
  for (const lg of [...new Set(ids.map(i => i.league))]) for (const c of await store.listCoaches({ league: lg, season }).catch(() => [])) rows.set(lg + '|' + c.club, c);
  const todo = ids.filter(i => current.has(i.league + '|' + i.club) && (rows.get(i.league + '|' + i.club) || {}).api_id == null);
  let calls = 0, got = 0, none = 0, left = null, error = null;
  for (const t of todo) {
    if (calls >= room) break;
    try {
      const j = await getCoach(t.api_team_id); calls++; if (j && j.__left != null) left = j.__left;
      const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : [];
      if (e.length) { error = `${t.club}: ${e.join('; ').slice(0, 140)}`; break; }
      const co = compactCoach(j, t.api_team_id), old = rows.get(t.league + '|' + t.club);
      const id = `${t.league}|${season}|${t.club.toLowerCase()}`;
      if (co && co.id) { try { if (old && old.name) await noteCoachChange(store, { league: t.league, club: t.club, oldName: old.name, newName: co.name, newApi: co.id, nationality: co.nationality, today }); } catch (_) { /* never blocks */ }
        await store.upsertCoaches([{ id, league: t.league, season, club: t.club, name: (co.name || (old && old.name) || '').slice(0, 120), nationality: co.nationality || (old && old.nationality) || null, api_id: co.id, as_of: today, updated_at: iso(now) }]); got++; }
      else { await store.upsertCoaches([{ id, league: t.league, season, club: t.club, name: (old && old.name) || '', nationality: (old && old.nationality) || null, api_id: 0, as_of: (old && old.as_of) || today, updated_at: iso(now) }]); none++; }
      if (left != null && left <= reserve) break;
    } catch (err) { error = `${t.club}: ${String(err && err.message || err).slice(0, 120)}`; break; }
  }
  const remaining = Math.max(0, todo.length - got - none);
  const summary = `Coach photos: ${got} found, ${none} with no coach on the API, ${calls} request(s) (${usedToday + calls}/${dailyCap} today)${left != null ? ', ' + left + ' left' : ''}; ${remaining} clubs still to do`;
  if (calls || error) await store.addLog({ kind: 'sync-coaches', ok: !error || calls > 0, summary, detail: { calls, got, none, remaining, left, error } });
  return { ran: calls > 0, calls, got, none, remaining, left, summary };
}
