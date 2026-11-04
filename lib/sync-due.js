// lib/sync-due.js  Checks matches that should be over by now, using only the matches we already store.
// A match is DUE when it has not got a result and its kick-off was at least 110 minutes ago (kick-off known), or, with no
// kick-off stored, once 22:30 UTC on its date has passed. One API-Football request per DATE with due matches (the answer
// lists every match that day), never more than 2 per run, and a date is not asked again for 25 minutes. Works for ANY
// competition in the bank (national-team games, cups, friendlies...) because it matches on team names, not on a league list.
import { norm, mapApiStatus, LEAGUES, leagueForApiFixture } from './bank-core.js';
import { idsFromFixtures } from './sync-transfers.js';
import { leftToday } from './match-detail.js';

const MIN_AFTER_KICKOFF = 110, RETRY_MIN = 25, MAX_CALLS = 2, WINDOW_DAYS = 3;
const iso = ms => new Date(ms).toISOString();
// The free API-Football plan only answers dates from yesterday to tomorrow (UTC); asking for an older date is refused and still wastes a request.
// API_DATE_WINDOW_DAYS=1 is the free plan. Raise it (or set a large number) on a paid plan.
const windowDays = () => { const v = Number(process.env.API_DATE_WINDOW_DAYS); return Number.isFinite(v) && v >= 0 ? v : 1; };
/** The day to ask the API about: the real kick-off day when we know it (the season schedule's date can be provisional), else the stored date. */
export const apiDate = m => { if (m.kickoff) { const k = Date.parse(m.kickoff); if (!Number.isNaN(k)) return iso(k).slice(0, 10); } return m.date; };
const dayShift = (d, n) => iso(Date.parse(d + 'T00:00:00Z') + n * 864e5).slice(0, 10);

export function isDue(m, nowMs) {
  if (m.status !== 'scheduled') return false;
  if (m.kickoff) { const k = Date.parse(m.kickoff); if (!Number.isNaN(k)) return nowMs >= k + MIN_AFTER_KICKOFF * 60000; }
  return nowMs >= Date.parse(m.date + 'T22:30:00Z');
}

export function sameTeam(a, b, aliasMap) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ax = aliasMap.get(x), ay = aliasMap.get(y);
  if ((ax && norm(ax) === y) || (ay && norm(ay) === x)) return true;
  const tx = x.split(' '), ty = y.split(' ');
  const sub = (s, l) => s.length > 0 && s.every(t => l.includes(t));
  return (sub(tx, ty) || sub(ty, tx)) && Math.min(x.length, y.length) >= 5;
}

// The API lists every competition of the day (youth, women's, reserve sides carry the same club names, e.g. "Atletico Madrid U19").
// A match is only looked up among fixtures of ITS OWN competition; where the competition has no API name, youth/women/reserve look-alikes are skipped.
const lookalike = n => /\b(u-?\d{2}|women|w|ii|b|reserves?|youth)\b/i.test(String(n || ''));
export function findFixture(fxs, m, aliasMap) {
  const cfg = LEAGUES[m.league];
  const strict = !!(cfg && (cfg.api || cfg.clubNorm));
  return (fxs || []).find(f => {
    if (!(f.teams && f.teams.home && f.teams.away)) return false;
    if (f.league) {
      if (strict) { if (leagueForApiFixture(f) !== m.league) return false; }
      else if ((lookalike(f.teams.home.name) && !lookalike(m.home)) || (lookalike(f.teams.away.name) && !lookalike(m.away))) return false;
    }
    return sameTeam(f.teams.home.name, m.home, aliasMap) && sameTeam(f.teams.away.name, m.away, aliasMap);
  });
}

/** Fills results for due matches. Returns { ran, calls, filled, postponed, pending, summary }. */
export async function syncDue(store, { getFixtures, now = Date.now(), force = false } = {}) {
  const today = iso(now).slice(0, 10);
  const due = (await store.listMatches({ status: 'scheduled', fromDate: dayShift(today, -WINDOW_DAYS), toDate: dayShift(today, 1) })).filter(m => isDue(m, now));
  const lo = dayShift(today, -windowDays()), hi = dayShift(today, windowDays());
  const cands = due.filter(m => { const d = apiDate(m); return d >= lo && d <= hi; });
  const outside = due.length - cands.length;
  if (!cands.length) return { ran: false, calls: 0, filled: 0, postponed: 0, pending: 0, outside, summary: outside ? `${outside} due, all older than the plan's date window (enter them by hand)` : 'nothing is due' };

  const dates = [...new Set(cands.map(apiDate))].sort().reverse();
  const recent = await store.recentLogs(40).catch(() => []);
  const asked = new Map();   // date -> ms of the last check
  for (const l of recent) if (l.kind === 'sync-due' && l.detail && Array.isArray(l.detail.dates)) { const t = Date.parse(l.detail.checkedAt || l.at); l.detail.dates.forEach(d => { if (!asked.has(d) || asked.get(d) < t) asked.set(d, t); }); }
  const todo = dates.filter(d => force || !asked.has(d) || now - asked.get(d) >= RETRY_MIN * 60000).slice(0, MAX_CALLS);
  if (!todo.length) return { ran: false, calls: 0, filled: 0, postponed: 0, pending: cands.length, summary: `${cands.length} due, all checked less than ${RETRY_MIN} minutes ago` };

  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const writes = [], stubs = [], idPairs = []; let calls = 0, filled = 0, postponed = 0, errors = [], lastLeft = null;
  for (const date of todo) {
    let json;
    try { json = await getFixtures(date); calls++; if (json && json.__left != null) lastLeft = json.__left; } catch (e) { errors.push(`${date}: ${String(e && e.message || e).slice(0, 120)}`); continue; }
    const errs = json && json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : [];
    if (errs.length) { errors.push(`${date}: ${errs.join('; ').slice(0, 120)}`); continue; }
    const fxs = (json && json.response) || [];
    for (const m of cands.filter(c => apiDate(c) === date)) {
      const fx = findFixture(fxs, m, aliasMap);
      if (!fx) continue;
      idPairs.push({ league: m.league, home: m.home, away: m.away, fx });   // free: learn API team ids for the transfers job
      const st = mapApiStatus(fx.fixture && fx.fixture.status && fx.fixture.status.short);
      const kick = fx.fixture && fx.fixture.date ? String(fx.fixture.date) : null;
      if (st === 'finished' && fx.goals && fx.goals.home != null && fx.goals.away != null) {
        const pen = fx.score && fx.score.penalty && fx.score.penalty.home != null ? fx.score.penalty : null;
        const et = fx.fixture.status.short === 'AET';
        writes.push({ ...m, date: fx.fixture.date ? String(fx.fixture.date).slice(0, 10) : m.date, time: fx.fixture.date && String(fx.fixture.date).slice(0, 10) !== m.date ? null : m.time, status: 'finished', hg: Number(fx.goals.home), ag: Number(fx.goals.away),
          ht_h: fx.score && fx.score.halftime && fx.score.halftime.home != null ? fx.score.halftime.home : m.ht_h, ht_a: fx.score && fx.score.halftime && fx.score.halftime.away != null ? fx.score.halftime.away : m.ht_a,
          note: pen ? `penalties ${pen.home}-${pen.away}` : (et ? 'after extra time' : m.note), kickoff: m.kickoff || kick, source: 'api-football', conflict: null });
        filled++;
        if (fx.fixture && fx.fixture.id) stubs.push({ match_id: m.id, api_fixture_id: Number(fx.fixture.id) });   // so the details can be fetched (1 credit) later
      } else if (st === 'postponed' || st === 'cancelled') {
        writes.push({ ...m, status: st, kickoff: m.kickoff || kick, source: 'api-football' }); postponed++;
      } else if (kick && !(m.kickoff && Date.parse(m.kickoff) === Date.parse(kick))) {
        // not over yet (or still live): remember the real kick-off so the next check is exact; if the API moved the day, move ours too
        const kd = String(kick).slice(0, 10);
        writes.push({ ...m, kickoff: kick, date: kd !== m.date && !String(m.id).includes(m.date) ? kd : m.date });
      }
    }
  }
  if (writes.length) await store.upsertMatches(writes);
  if (idPairs.length && store.upsertTeamIds) { try { const rows = idsFromFixtures(idPairs); if (rows.length) await store.upsertTeamIds(rows); } catch (_) { /* optional */ } }
  if (stubs.length && store.addDetailStubs) { try { await store.addDetailStubs(stubs); } catch (e) { errors.push('details table: ' + String(e && e.message || e).slice(0, 80)); } }
  const pending = cands.length - filled - postponed;
  const summary = `Due-match check: ${cands.length} due, ${filled} result(s) filled${postponed ? ', ' + postponed + ' postponed/cancelled' : ''}, ${pending} still open, ${calls} API request(s)` + (errors.length ? ' — ' + errors.join(' | ') : '');
  if (calls || errors.length) await store.addLog({ kind: 'sync-due', ok: !errors.length || calls > 0, summary, detail: { dates: todo, checkedAt: iso(now), filled, postponed, pending, calls, left: lastLeft } });
  return { ran: calls > 0, calls, filled, postponed, pending, summary };
}

// ---------------------------------------------------------------- kick-off stamping
// Matches that came from a pasted/imported file have a date but no kick-off, and for US games the stored (local) date is
// often the day BEFORE the UTC date the API uses. So a few times a day we ask the API for today's and tomorrow's matches
// (1 request each, only when some stored match has no kick-off) and stamp the exact kick-off. After that the normal
// "110 minutes after kick-off" rule is exact for those matches, whatever time zone they play in.
const STAMP_EVERY_H = 6, STAMP_KEEP = 20;
export async function stampKickoffs(store, { getFixtures, now = Date.now() } = {}) {
  const today = iso(now).slice(0, 10), tomorrow = dayShift(today, 1);
  const list = (await store.listMatches({ status: 'scheduled', fromDate: dayShift(today, -1), toDate: dayShift(today, 2) })).filter(m => !m.kickoff);
  if (!list.length) return { calls: 0, stamped: 0, summary: 'every upcoming match has a kick-off' };
  const logs = await store.recentLogs(40).catch(() => []);
  const left = leftToday(logs, now);
  if (left != null && left <= STAMP_KEEP) return { calls: 0, stamped: 0, summary: `kick-off stamping waits: ${left} requests left today` };
  const last = logs.filter(l => l.kind === 'stamp-kickoffs').map(l => Date.parse(l.at)).filter(n => !Number.isNaN(n)).sort((a, b) => b - a)[0];
  if (last && now - last < STAMP_EVERY_H * 3600000) return { calls: 0, stamped: 0, summary: 'kick-offs checked less than ' + STAMP_EVERY_H + ' hours ago' };
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const writes = []; let calls = 0; const errors = []; let lastLeft = null;
  for (const date of [today, tomorrow]) {
    let json; try { json = await getFixtures(date); calls++; if (json && json.__left != null) lastLeft = json.__left; } catch (e) { errors.push(`${date}: ${String(e && e.message || e).slice(0, 100)}`); continue; }
    if (json && json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length) { errors.push(`${date}: ${Object.values(json.errors).join('; ').slice(0, 100)}`); continue; }
    for (const m of list) {
      if (writes.some(w => w.id === m.id)) continue;
      const fx = findFixture((json && json.response) || [], m, aliasMap);
      const kick = fx && fx.fixture && fx.fixture.date ? String(fx.fixture.date) : null;
      if (!kick) continue;
      const kd = kick.slice(0, 10);
      writes.push({ ...m, kickoff: kick, date: kd !== m.date && !String(m.id).includes(m.date) ? kd : m.date });
    }
  }
  if (writes.length) await store.upsertMatches(writes);
  const summary = `Kick-off stamping: ${writes.length} of ${list.length} match(es) stamped, ${calls} API request(s)` + (errors.length ? ' — ' + errors.join(' | ') : '');
  if (calls) await store.addLog({ kind: 'stamp-kickoffs', ok: true, summary, detail: { left: lastLeft, stamped: writes.length } });
  return { calls, stamped: writes.length, summary };
}
