// lib/sync-due.js  Checks matches that should be over by now, using only the matches we already store.
// A match is DUE when it has not got a result and its kick-off was at least 110 minutes ago (kick-off known), or, with no
// kick-off stored, once 22:30 UTC on its date has passed. One API-Football request per DATE with due matches (the answer
// lists every match that day), never more than 2 per run, and a date is not asked again for 25 minutes. Works for ANY
// competition in the bank (national-team games, cups, friendlies...) because it matches on team names, not on a league list.
import { norm, mapApiStatus } from './bank-core.js';

const MIN_AFTER_KICKOFF = 110, RETRY_MIN = 25, MAX_CALLS = 2, WINDOW_DAYS = 3;
const iso = ms => new Date(ms).toISOString();
const dayShift = (d, n) => iso(Date.parse(d + 'T00:00:00Z') + n * 864e5).slice(0, 10);

export function isDue(m, nowMs) {
  if (m.status !== 'scheduled') return false;
  if (m.kickoff) { const k = Date.parse(m.kickoff); if (!Number.isNaN(k)) return nowMs >= k + MIN_AFTER_KICKOFF * 60000; }
  return nowMs >= Date.parse(m.date + 'T22:30:00Z');
}

function sameTeam(a, b, aliasMap) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ax = aliasMap.get(x), ay = aliasMap.get(y);
  if ((ax && norm(ax) === y) || (ay && norm(ay) === x)) return true;
  const tx = x.split(' '), ty = y.split(' ');
  const sub = (s, l) => s.length > 0 && s.every(t => l.includes(t));
  return (sub(tx, ty) || sub(ty, tx)) && Math.min(x.length, y.length) >= 5;
}

/** Fills results for due matches. Returns { ran, calls, filled, postponed, pending, summary }. */
export async function syncDue(store, { getFixtures, now = Date.now(), force = false } = {}) {
  const today = iso(now).slice(0, 10);
  const cands = (await store.listMatches({ status: 'scheduled', fromDate: dayShift(today, -WINDOW_DAYS), toDate: today })).filter(m => isDue(m, now));
  if (!cands.length) return { ran: false, calls: 0, filled: 0, postponed: 0, pending: 0, summary: 'nothing is due' };

  const dates = [...new Set(cands.map(m => m.date))].sort().reverse();
  const recent = await store.recentLogs(40).catch(() => []);
  const asked = new Map();   // date -> ms of the last check
  for (const l of recent) if (l.kind === 'sync-due' && l.detail && Array.isArray(l.detail.dates)) { const t = Date.parse(l.detail.checkedAt || l.at); l.detail.dates.forEach(d => { if (!asked.has(d) || asked.get(d) < t) asked.set(d, t); }); }
  const todo = dates.filter(d => force || !asked.has(d) || now - asked.get(d) >= RETRY_MIN * 60000).slice(0, MAX_CALLS);
  if (!todo.length) return { ran: false, calls: 0, filled: 0, postponed: 0, pending: cands.length, summary: `${cands.length} due, all checked less than ${RETRY_MIN} minutes ago` };

  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const writes = [], stubs = []; let calls = 0, filled = 0, postponed = 0, errors = [];
  for (const date of todo) {
    let json;
    try { json = await getFixtures(date); calls++; } catch (e) { errors.push(`${date}: ${String(e && e.message || e).slice(0, 120)}`); continue; }
    const errs = json && json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : [];
    if (errs.length) { errors.push(`${date}: ${errs.join('; ').slice(0, 120)}`); continue; }
    const fxs = (json && json.response) || [];
    for (const m of cands.filter(c => c.date === date)) {
      const fx = fxs.find(f => f.teams && f.teams.home && f.teams.away && sameTeam(f.teams.home.name, m.home, aliasMap) && sameTeam(f.teams.away.name, m.away, aliasMap));
      if (!fx) continue;
      const st = mapApiStatus(fx.fixture && fx.fixture.status && fx.fixture.status.short);
      const kick = fx.fixture && fx.fixture.date ? String(fx.fixture.date) : null;
      if (st === 'finished' && fx.goals && fx.goals.home != null && fx.goals.away != null) {
        const pen = fx.score && fx.score.penalty && fx.score.penalty.home != null ? fx.score.penalty : null;
        const et = fx.fixture.status.short === 'AET';
        writes.push({ ...m, status: 'finished', hg: Number(fx.goals.home), ag: Number(fx.goals.away),
          ht_h: fx.score && fx.score.halftime && fx.score.halftime.home != null ? fx.score.halftime.home : m.ht_h, ht_a: fx.score && fx.score.halftime && fx.score.halftime.away != null ? fx.score.halftime.away : m.ht_a,
          note: pen ? `penalties ${pen.home}-${pen.away}` : (et ? 'after extra time' : m.note), kickoff: m.kickoff || kick, source: 'api-football', conflict: null });
        filled++;
        if (fx.fixture && fx.fixture.id) stubs.push({ match_id: m.id, api_fixture_id: Number(fx.fixture.id) });   // so the details can be fetched (1 credit) later
      } else if (st === 'postponed' || st === 'cancelled') {
        writes.push({ ...m, status: st, kickoff: m.kickoff || kick, source: 'api-football' }); postponed++;
      } else if (!m.kickoff && kick) {
        writes.push({ ...m, kickoff: kick });            // not over yet (or still live): remember the real kick-off so the next check is exact
      }
    }
  }
  if (writes.length) await store.upsertMatches(writes);
  if (stubs.length && store.addDetailStubs) { try { await store.addDetailStubs(stubs); } catch (e) { errors.push('details table: ' + String(e && e.message || e).slice(0, 80)); } }
  const pending = cands.length - filled - postponed;
  const summary = `Due-match check: ${cands.length} due, ${filled} result(s) filled${postponed ? ', ' + postponed + ' postponed/cancelled' : ''}, ${pending} still open, ${calls} API request(s)` + (errors.length ? ' — ' + errors.join(' | ') : '');
  if (calls || errors.length) await store.addLog({ kind: 'sync-due', ok: !errors.length || calls > 0, summary, detail: { dates: todo, checkedAt: iso(now), filled, postponed, pending, calls } });
  return { ran: calls > 0, calls, filled, postponed, pending, summary };
}
