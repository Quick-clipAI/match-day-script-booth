// lib/sync-run.js — shared by the daily cron and the admin "Run sync now" button.
import crypto from 'node:crypto';
import { syncApiFootball, syncOpenfootball } from './bank-sync.js';
import { currentSeason } from './bank-core.js';
import { fixturesGetter, fetchText } from './apisports.js';

export const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export async function runSync(store, env = process.env, today = new Date().toISOString().slice(0, 10)) {
  const out = {};
  out.api = await syncApiFootball(store, { getFixtures: fixturesGetter((env.API_SPORTS_KEY || '').trim()), today });
  const season = currentSeason(null, today);
  try { out.openfootball = await syncOpenfootball(store, { fetchText, season, today, dryRun: false, interactive: false }); }
  catch (e) { out.openfootball = { ok: false, summary: 'openfootball failed: ' + String(e && e.message || e).slice(0, 200) }; await store.addLog({ kind: 'sync-openfootball', ok: false, summary: out.openfootball.summary }); }
  try { await store.pruneLogs(90); } catch (e) { /* housekeeping only */ }
  return out;
}
