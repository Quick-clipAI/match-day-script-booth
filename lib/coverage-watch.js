// lib/coverage-watch.js — the safeguard against API-Football skipping matches.
// Why matches were skipped: the free API-Football plan answers a date only from yesterday to tomorrow (UTC). A match whose result or
// details were not caught inside that window can never be fetched from API-Football again. This module costs NO API requests: it reads
// what is stored and tells, for every finished/due match of the last days, whether it still lacks a result or usable details and how many
// hours are left before its day leaves the window. Matches that already have details from another source (manual file, Highlightly,
// StrikerAPI) count as covered.
import { isDue, apiDate } from './sync-due.js';

const DAY = 864e5, iso = ms => new Date(ms).toISOString();
const windowDays = () => { const v = Number(process.env.API_DATE_WINDOW_DAYS); return Number.isFinite(v) && v >= 0 ? v : 1; };
export const CLOSING_HOURS = 24;

/** Hours until the match's day can no longer be asked from API-Football (negative = already closed). */
export function hoursLeft(m, now, w = windowDays()) {
  const d = apiDate(m); const start = Date.parse(d + 'T00:00:00Z');
  if (Number.isNaN(start)) return null;
  return Math.round(((start + (w + 1) * DAY) - now) / 36e5);
}

/** Builds the report. `lookbackDays` = how far back finished matches are checked for details. */
export async function coverageWatch(store, { now = Date.now(), lookbackDays = 7, w = windowDays() } = {}) {
  const today = iso(now).slice(0, 10);
  const from = iso(now - lookbackDays * DAY).slice(0, 10), to = iso(now + DAY).slice(0, 10);
  const [fin, sched] = await Promise.all([
    store.listMatches({ status: 'finished', fromDate: from, toDate: to }),
    store.listMatches({ status: 'scheduled', fromDate: iso(now - 14 * DAY).slice(0, 10), toDate: to })
  ]);
  const ds = await store.detailStatus(iso(now - 30 * DAY)).catch(() => new Map());   // match_id -> { usable, hasFixtureId }
  const items = [];
  for (const m of sched) {
    if (!isDue(m, now)) continue;
    const h = hoursLeft(m, now, w);
    items.push({ id: m.id, league: m.league, home: m.home, away: m.away, date: m.date, kind: 'no-result', hoursLeft: h, state: h == null ? 'open' : h <= 0 ? 'missed' : h <= CLOSING_HOURS ? 'closing' : 'open' });
  }
  for (const m of fin) {
    const d = ds.get(m.id);
    if (d && d.usable) continue;
    const h = hoursLeft(m, now, w);
    items.push({ id: m.id, league: m.league, home: m.home, away: m.away, date: m.date, kind: d && d.hasFixtureId ? 'details-pending' : 'no-details', hoursLeft: h, state: h == null ? 'open' : h <= 0 ? 'missed' : h <= CLOSING_HOURS ? 'closing' : 'open' });
  }
  // most urgent first: closing (least hours left), then open, missed last (they need another source)
  const rank = i => (i.state === 'closing' ? 0 : i.state === 'open' ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b) || (a.hoursLeft ?? 9e9) - (b.hoursLeft ?? 9e9) || (a.date < b.date ? -1 : 1));
  const count = k => items.filter(i => i.state === k).length;
  return {
    checkedAt: iso(now), today, windowDays: w, total: items.length,
    closing: count('closing'), open: count('open'), missed: count('missed'),
    noResult: items.filter(i => i.kind === 'no-result').length,
    noDetails: items.filter(i => i.kind !== 'no-result').length,
    items: items.slice(0, 60)
  };
}

/** Writes one log line when something is closing or newly missed (at most every 6 hours, or at once when the numbers got worse). */
export async function logWatch(store, report, now = Date.now()) {
  if (!report.closing && !report.missed) return { logged: false };
  const logs = await store.recentLogs(60).catch(() => []);
  const last = logs.find(l => l.kind === 'coverage-watch');
  const worse = !last || !last.detail || report.closing > (last.detail.closing || 0) || report.missed > (last.detail.missed || 0);
  if (last && !worse && now - Date.parse(last.at) < 6 * 3600000) return { logged: false };
  const first = report.items.filter(i => i.state !== 'open').slice(0, 3).map(i => `${i.home} v ${i.away} (${i.date})`).join('; ');
  await store.addLog({ kind: 'coverage-watch', ok: report.missed === 0, summary: `Coverage watch: ${report.closing} match(es) about to leave API-Football's window, ${report.missed} already past it. ${first}`.slice(0, 480), detail: { closing: report.closing, missed: report.missed, noResult: report.noResult, noDetails: report.noDetails, checkedAt: report.checkedAt } });
  return { logged: true };
}
