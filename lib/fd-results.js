// lib/fd-results.js — fills missing Champions League RESULTS from football-data.org (free plan covers CL). One request covers all gaps.
// Only matches that have no score yet are touched; scores that exist are never changed. Full-time score only (penalty shoot-outs are left for a person).
import { guardStore } from './guard.js';
import { sameTeam } from './sync-due.js';
import { fdGet } from './fd-scorers.js';

const dayShift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const EVERY_MS = 3 * 3600e3;

/** league: our league key (only UCL has a football-data code on the free plan). get(path) -> { status, json } is injectable for tests. */
export async function fdFillResults(store, { key, today, league = 'UCL', code = 'CL', get, now = Date.now(), force = false } = {}) {
  if (!key) return { ran: false, filled: 0, summary: 'no football-data key' };
  const gaps = (await store.listMatches({ league, fromDate: dayShift(today, -30) })).filter(m => m.date < today && (m.hg == null || m.ag == null) && m.status !== 'postponed' && m.status !== 'cancelled');
  if (!gaps.length) return { ran: false, filled: 0, summary: 'no gaps' };
  const gs = guardStore(process.env), last = await gs.get('fd:results:' + league);
  if (!force && last && now - Number(last.t || 0) < EVERY_MS) return { ran: false, filled: 0, summary: 'asked less than 3 hours ago' };
  await gs.set('fd:results:' + league, { t: now });
  const from = dayShift(gaps.reduce((a, m) => (m.date < a ? m.date : a), today), -1), to = dayShift(today, 1);
  const r = await (get || (p => fdGet(p, key, 12000)))(`/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`);
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.matches)) {
    const why = (r.json && (r.json.message || r.json.error)) || r.text || ('HTTP ' + r.status);
    await store.addLog({ kind: 'sync-fd', ok: false, summary: `football-data.org ${league} results failed: ${String(why).slice(0, 140)}` });
    return { ran: true, filled: 0, error: String(why).slice(0, 140), summary: 'failed' };
  }
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const names = t => [t && t.name, t && t.shortName].filter(Boolean);
  const same = (t, ours) => names(t).some(n => sameTeam(n, ours, aliasMap));
  const writes = [], skipped = [];
  for (const m of gaps) {
    const fx = r.json.matches.find(f => f.status === 'FINISHED' && same(f.homeTeam, m.home) && same(f.awayTeam, m.away) && Math.abs(Date.parse(String(f.utcDate).slice(0, 10)) - Date.parse(m.date)) <= 864e5);
    if (!fx) continue;
    const sc = fx.score || {}, ft = sc.fullTime || {};
    if (sc.duration && sc.duration !== 'REGULAR') { skipped.push(`${m.home} v ${m.away} (${sc.duration.toLowerCase().replace('_', ' ')})`); continue; }
    if (ft.home == null || ft.away == null) continue;
    const ht = sc.halfTime || {};
    writes.push({ ...m, status: 'finished', hg: Number(ft.home), ag: Number(ft.away), ht_h: ht.home != null ? ht.home : m.ht_h, ht_a: ht.away != null ? ht.away : m.ht_a, kickoff: m.kickoff || fx.utcDate || null, source: 'football-data', conflict: null });
  }
  if (writes.length) await store.upsertMatches(writes);
  const summary = `football-data.org ${league}: ${gaps.length} gap(s), ${writes.length} result(s) filled, 1 request` + (skipped.length ? `; left for you (extra time or penalties): ${skipped.join(', ')}` : '');
  await store.addLog({ kind: 'sync-fd', ok: true, summary, detail: { filled: writes.map(w => w.id) } });
  return { ran: true, filled: writes.length, summary };
}
