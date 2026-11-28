// lib/api-alert.js — tells the owner's phone when API-Football refuses our requests (suspended account, bad key, limit reached).
// Reads only the log we already keep: no API request is made. At most one alert every 12 hours.
// Env: ADMIN_ALERT_USER_ID = the app account whose phone gets the alert (needs FIREBASE_SERVICE_ACCOUNT, same as script alerts).
import { notifyUser } from './push.js';
import { guardStore } from './guard.js';

export const API_FAIL = /account is suspended|invalid.{0,20}(api )?key|api key|subscription|request limit|rate.?limit|reached.{0,20}limit|not authori[sz]ed/i;
const WINDOW_MS = 3 * 3600 * 1000, QUIET_MS = 12 * 3600 * 1000;

/** logs: newest first. Returns null when API-Football looks fine, else { reason, since, count }. */
export function apiProblem(logs, nowMs = Date.now()) {
  const bad = l => l && API_FAIL.test(String(l.summary || ''));
  const recent = (logs || []).filter(l => nowMs - Date.parse(l.at) < WINDOW_MS);
  const first = recent.find(bad); if (!first) return null;
  // "since": the oldest failing entry after the newest healthy API-Football sync we can still see
  const lastGood = (logs || []).find(l => l.kind === 'sync-api' && l.ok !== false && !bad(l));
  const streak = (logs || []).filter(l => bad(l) && (!lastGood || Date.parse(l.at) > Date.parse(lastGood.at)));
  const since = streak.length ? streak[streak.length - 1].at : first.at;
  const m = String(first.summary).match(/(Your account is suspended[^|.]*\.?|[^|—]*(?:api key|limit)[^|]*)/i);
  return { reason: (m ? m[1] : first.summary).trim().slice(0, 120), since, count: streak.length || 1 };
}

export async function checkApiAlert(store, env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  try {
    const p = apiProblem(await store.recentLogs(200), nowMs);
    if (!p) return { alerted: false };
    const gs = guardStore(env, fetchImpl), last = await gs.get('alert:api');
    if (last && nowMs - Number(last.t || 0) < QUIET_MS) return { alerted: false, quiet: true };
    const uid = String(env.ADMIN_ALERT_USER_ID || '').trim();
    await gs.set('alert:api', { t: nowMs });
    const day = new Date(p.since).toISOString().slice(0, 10);
    const body = `${p.reason} Failing since ${day} (${new Date(p.since).toISOString().slice(11, 16)} UTC). Results will not fill until this is fixed.`;
    let sent = 0;
    if (uid) sent = (await notifyUser(env, uid, { title: 'API-Football is failing', body, data: { type: 'api-alert' } }, fetchImpl)).sent || 0;
    await store.addLog({ kind: 'alert', ok: false, summary: `API-Football alert: ${p.reason} (since ${day}). ${uid ? (sent ? 'Phone notified.' : 'Phone could not be notified.') : 'No phone set (ADMIN_ALERT_USER_ID missing).'}`, detail: p });
    return { alerted: true, sent, ...p };
  } catch (e) { return { alerted: false, error: String(e && e.message || e).slice(0, 120) }; }
}
