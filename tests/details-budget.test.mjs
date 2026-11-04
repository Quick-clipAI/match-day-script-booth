// node tests/details-budget.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { syncDetails, leftToday, detailLeagues } from '../lib/match-detail.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const NOW = Date.parse('2026-11-01T12:00:00Z');
await t('only EPL, LALIGA and UCL matches get details by default; others wait', async () => {
  const s = createMemoryStore();
  await s.addDetailStubs([{ match_id: 'EPL|2026|a|b', api_fixture_id: 1 }, { match_id: 'SERIEA|2026|c|d', api_fixture_id: 2 }, { match_id: 'LALIGA|2026|e|f', api_fixture_id: 3 }]);
  const asked = []; const getDetail = async id => { asked.push(id); return { response: [] }; };
  await syncDetails(s, { getDetail, now: Date.now(), leagues: ['EPL', 'LALIGA'] });
  assert.deepEqual(asked.sort(), [1, 3]);
  assert.equal(detailLeagues().join(), 'EPL,LALIGA,SERIEA,BUNDESLIGA,LIGUE1,UCL');
});
await t('details stop when 15 or fewer requests are left today (kept for results)', async () => {
  const s = createMemoryStore(); await s.addDetailStubs([{ match_id: 'EPL|2026|a|b', api_fixture_id: 1 }]);
  await s.addLog({ kind: 'sync-due', ok: true, summary: 'x', detail: { left: 12, checkedAt: new Date(NOW).toISOString() } });
  const logs = await s.recentLogs(10); logs[0].at = new Date(NOW).toISOString();
  assert.equal(leftToday(logs, NOW), 12); assert.equal(leftToday(logs, NOW + 864e5), null);          // yesterday's number never blocks
  let asked = 0; const r = await syncDetails(s, { getDetail: async () => { asked++; return { response: [] }; }, now: NOW });
  assert.equal(asked, 0); assert.match(r.summary, /kept for results/);
});
console.log(n + ' details-budget tests passed');
