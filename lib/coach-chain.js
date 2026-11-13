// lib/coach-chain.js — follows a coaching vacancy down the line.
// A club loses its coach (sacked: it is put on the WATCH list). Once API-Football shows the new coach we record him, look at his career
// (the same answer already lists it) and see where he came from. If he came straight from another club or a national team, THAT job is now
// vacant, so it goes on the watch list too and the chain continues. It ends when the new coach was a free agent (no job in the weeks before).
import { norm } from './bank-core.js';
import { noteCoachChange } from './coach-history.js';

export const FREE_GAP_DAYS = 90;          // more than this between his last job and the new one = he was a free agent
const WATCH_EVERY_MS = 12 * 3600e3;      // a vacancy is asked about twice a day at most
const STALE_DAYS = 14, STALE_DAILY = 8;  // every club's coach is re-checked every 14 days (at most 8 requests a day) to catch sackings nobody told us about
const dayMs = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
const iso = ms => new Date(ms).toISOString();

/** The coach currently in charge of `teamId` in an API-Football `coachs?team=` answer, with where he came from. */
export function parseCoach(json, teamId) {
  const list = (json && json.response) || [];
  for (const c of list) {
    const career = c.career || [], cur = career.find(x => x.team && x.team.id === Number(teamId) && !x.end);
    if (!cur || !c.name) continue;
    const others = career.filter(x => x !== cur && x.team && x.team.id !== Number(teamId));
    others.sort((a, b) => String(b.end || '9999').localeCompare(String(a.end || '9999')) || String(b.start || '').localeCompare(String(a.start || '')));
    const p = others[0] || null;
    let origin = 'free', prev = null;
    if (p) {
      prev = { teamId: p.team.id, team: p.team.name || null, end: p.end || null };
      const gap = p.end && cur.start ? Math.round((dayMs(cur.start) - dayMs(p.end)) / 864e5) : null;
      origin = (!p.end || gap == null || gap <= FREE_GAP_DAYS) ? 'club' : 'free';   // still listed at the old job, or left it only just before
    }
    return { name: String(c.name), nationality: c.nationality || null, id: Number.isInteger(c.id) ? c.id : null, start: cur.start || null, prev, origin };
  }
  return null;
}

/** One new coach at a club: record the spell, update the coach row, queue the job he left. Returns a short text for the log. */
async function recordArrival(store, { league, club, teamApiId, oldName, co, today, season, now, endedOn = null }) {
  await noteCoachChange(store, { league, club, oldName, newName: co.name, newApi: co.id, nationality: co.nationality, today, endedOn, startedOn: co.start, teamApiId, prev: co.prev, origin: co.origin });
  if (league && season) {
    const id = `${league}|${season}|${String(club).toLowerCase()}`;
    const old = (await store.listCoaches({ league, season, club }).catch(() => []))[0];
    await store.upsertCoaches([{ id, league, season, club, name: co.name.slice(0, 120), nationality: co.nationality || (old && old.nationality) || null, api_id: co.id || (old && old.api_id) || null, as_of: today, updated_at: iso(now) }]);
  }
  let line = `${club}: ${co.name}`;
  if (co.origin === 'club' && co.prev) {
    const tracked = (await store.listTeamIds().catch(() => [])).find(t => t.api_team_id === co.prev.teamId);
    await store.upsertCoachWatch([{ team_api_id: co.prev.teamId, league: tracked ? tracked.league : null, club: (tracked && tracked.club) || co.prev.team || String(co.prev.teamId), left_coach: co.name, reason: `moved to ${club}`, since: co.prev.end || today, last_checked: null, done_at: null, note: `chain: ${co.name} left for ${club}` }]);
    line += ` (from ${co.prev.team || co.prev.teamId}, whose job is now vacant: watching it)`;
  } else line += co.prev ? ` (was a free agent since ${co.prev.end || '?'}: the chain ends here)` : ' (no earlier job on record: the chain ends here)';
  return line;
}

/**
 * Vacancy watch + slow re-check. Spends at most `room` API requests. getCoach(teamId) -> API-Football json.
 * Order: vacancies first, then clubs whose coach was not checked for STALE_DAYS (at most STALE_DAILY a day).
 */
export async function syncCoachWatch(store, { getCoach, now = Date.now(), room = 3, dailyCap = 72, reserve = 15, busyMatches = 0 } = {}) {
  if (!store.listCoachWatch || room <= 0) return { calls: 0, summary: 'coach watch: nothing to do' };
  const today = iso(now).slice(0, 10);
  const logs = await store.recentLogs(300).catch(() => []);
  const todayLogs = logs.filter(l => String(l.at || '').slice(0, 10) === today);
  const usedToday = todayLogs.filter(l => l.kind === 'sync-coaches' || l.kind === 'coach-watch').reduce((n, l) => n + (Number(l.detail && l.detail.calls) || 0), 0);
  const staleToday = todayLogs.filter(l => l.kind === 'coach-watch').reduce((n, l) => n + (Number(l.detail && l.detail.stale) || 0), 0);
  room = Math.min(room, dailyCap - usedToday); let staleLeft = STALE_DAILY - staleToday;
  if (room <= 0) return { calls: 0, summary: 'coach watch: the daily coach requests are used' };
  if (busyMatches >= 15) staleLeft = 0;            // on a busy match day only the vacancies are asked about
  const idx = await store.clubIndex().catch(() => []); const season = Math.max(0, ...idx.map(c => c.last_season || 0));
  const ids = await store.listTeamIds().catch(() => []);
  let calls = 0, error = null; const lines = [];
  const watches = (await store.listCoachWatch()).filter(w => !w.done_at && (!w.last_checked || now - Date.parse(w.last_checked) >= WATCH_EVERY_MS));
  for (const w of watches) {
    if (calls >= room) break;
    try {
      const j = await getCoach(w.team_api_id); calls++; if (j && j.__left != null && j.__left <= reserve) room = calls;
      const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : [];
      if (e.length) { error = `${w.club}: ${e.join('; ').slice(0, 140)}`; break; }
      const co = parseCoach(j, w.team_api_id), t = ids.find(x => x.api_team_id === w.team_api_id);
      if (co && norm(co.name) !== norm(w.left_coach || '')) {
        lines.push(await recordArrival(store, { league: w.league || (t && t.league) || null, club: w.club, teamApiId: w.team_api_id, oldName: w.left_coach, co, today, season, now }));
        await store.upsertCoachWatch([{ team_api_id: w.team_api_id, last_checked: iso(now), done_at: today }]);
      } else await store.upsertCoachWatch([{ team_api_id: w.team_api_id, last_checked: iso(now) }]);
    } catch (err) { error = `${w.club}: ${String(err && err.message || err).slice(0, 120)}`; break; }
  }
  let stale = 0;                                  // slow re-check of every club's coach
  if (!error && calls < room && staleLeft > 0) {
    const watched = new Set((await store.listCoachWatch()).filter(w => !w.done_at).map(w => w.team_api_id));
    const cur = new Set(idx.filter(c => c.last_season >= season).map(c => c.league + '|' + c.club));
    const rows = new Map(); for (const lg of [...new Set(ids.map(i => i.league))]) for (const c of await store.listCoaches({ league: lg, season }).catch(() => [])) rows.set(lg + '|' + c.club, c);
    const due = ids.filter(i => cur.has(i.league + '|' + i.club) && !watched.has(i.api_team_id)).map(i => ({ i, r: rows.get(i.league + '|' + i.club) })).filter(x => x.r && x.r.api_id && x.r.as_of && now - dayMs(x.r.as_of) >= STALE_DAYS * 864e5)
      .sort((a, b) => String(a.r.as_of).localeCompare(String(b.r.as_of)));
    for (const { i, r } of due) {
      if (calls >= room || stale >= staleLeft) break;
      try {
        const j = await getCoach(i.api_team_id); calls++; stale++; if (j && j.__left != null && j.__left <= reserve) room = calls;
        const e = j && j.errors && !Array.isArray(j.errors) ? Object.values(j.errors) : [];
        if (e.length) { error = `${i.club}: ${e.join('; ').slice(0, 140)}`; break; }
        const co = parseCoach(j, i.api_team_id);
        if (co && norm(co.name) !== norm(r.name || '')) lines.push(await recordArrival(store, { league: i.league, club: i.club, teamApiId: i.api_team_id, oldName: r.name, co, today, season, now }));
        else await store.upsertCoaches([{ ...r, as_of: today, updated_at: iso(now) }]);       // still the same coach: just note that we looked
      } catch (err) { error = `${i.club}: ${String(err && err.message || err).slice(0, 120)}`; break; }
    }
  }
  const summary = `Coach watch: ${calls} request(s)${lines.length ? '; ' + lines.join(' | ') : ''}${error ? '; error ' + error : ''}`;
  if (calls || error) await store.addLog({ kind: 'coach-watch', ok: !error || calls > 0, summary, detail: { calls, stale, moves: lines, error } });
  return { calls, stale, moves: lines, summary };
}
