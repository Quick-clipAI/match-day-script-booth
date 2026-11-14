// node tests/coverage-watch.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { coverageWatch, logWatch, hoursLeft } from '../lib/coverage-watch.js';
import { syncDue } from '../lib/sync-due.js';
const NOW = Date.parse('2026-11-14T12:00:00Z');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const m = o => ({ id: `EPL|2026|${o.date}|${o.home.toLowerCase()}|${o.away.toLowerCase()}`, league: 'EPL', comp_name: 'x', season: 2026, round: null, time: null, kickoff: null, hg: null, ag: null, ht_h: null, ht_a: null, status: 'finished', note: null, source: 'api-football', verified: false, conflict: null, ...o });
await t('hoursLeft: a day stays askable until the end of the day after it (free plan, 1-day window)', () => {
  assert.equal(hoursLeft({ date: '2026-11-14' }, NOW, 1), 36);
  assert.equal(hoursLeft({ date: '2026-11-13' }, NOW, 1), 12);
  assert.equal(hoursLeft({ date: '2026-11-12' }, NOW, 1) < 0, true);
});
await t('flags closing, open and missed; covered matches (any source) are not flagged', async () => {
  const s = createMemoryStore();
  const A = m({ date: '2026-11-13', home: 'A', away: 'B', hg: 1, ag: 0 }), B = m({ date: '2026-11-14', home: 'C', away: 'D', hg: 2, ag: 2 }), C = m({ date: '2026-11-10', home: 'E', away: 'F', hg: 0, ag: 0 }), D = m({ date: '2026-11-13', home: 'G', away: 'H', hg: 3, ag: 1 }), E = m({ date: '2026-11-12', home: 'I', away: 'J', status: 'scheduled' });
  await s.upsertMatches([A, B, C, D, E]);
  await s.saveManualDetail(D.id, { v: 1, source: 'manual', events: [] });            // covered by a manual file
  await s.addDetailStubs([{ match_id: B.id, api_fixture_id: 99 }]);                     // queued, not fetched yet
  const r = await coverageWatch(s, { now: NOW });
  const by = id => r.items.find(i => i.id === id);
  assert.equal(by(A.id).state, 'closing'); assert.equal(by(A.id).kind, 'no-details');
  assert.equal(by(B.id).state, 'open'); assert.equal(by(B.id).kind, 'details-pending');
  assert.equal(by(C.id).state, 'missed');
  assert.equal(by(D.id), undefined, 'a manual file counts as covered');
  assert.equal(by(E.id).kind, 'no-result'); assert.equal(by(E.id).state, 'missed');
  assert.equal(r.closing, 1); assert.equal(r.missed, 2);
  assert.equal(r.items[0].id, A.id, 'closing first');
});
await t('"unavailable" details do not count as covered', async () => {
  const s = createMemoryStore(); const A = m({ date: '2026-11-13', home: 'A', away: 'B', hg: 1, ag: 0 });
  await s.upsertMatches([A]); await s.addDetailStubs([{ match_id: A.id, api_fixture_id: 5 }]); await s.saveDetail(A.id, { v: 1, unavailable: true });
  const r = await coverageWatch(s, { now: NOW }); assert.equal(r.items.length, 1);
});
await t('logWatch: logs when closing/missed, not twice in a row, but again when worse; silent when all is well', async () => {
  const s = createMemoryStore(); await s.upsertMatches([m({ date: '2026-11-13', home: 'A', away: 'B', hg: 1, ag: 0 })]);
  const rep = await coverageWatch(s, { now: NOW });
  assert.equal((await logWatch(s, rep, NOW)).logged, true);
  assert.equal((await logWatch(s, rep, NOW + 1000)).logged, false);
  assert.equal((await logWatch(s, { ...rep, missed: 3 }, NOW + 2000)).logged, true);
  assert.equal((await logWatch(s, { closing: 0, missed: 0, items: [] }, NOW)).logged, false);
});
await t('syncDue asks the OLDEST due day first when requests are limited', async () => {
  const s = createMemoryStore();
  await s.upsertMatches([m({ date: '2026-11-13', home: 'A', away: 'B', status: 'scheduled', kickoff: '2026-11-13T15:00:00Z' }), m({ date: '2026-11-14', home: 'C', away: 'D', status: 'scheduled', kickoff: '2026-11-14T08:00:00Z' })]);
  const calls = []; await syncDue(s, { getFixtures: async d => { calls.push(d); return { response: [] }; }, now: NOW });
  assert.deepEqual(calls, ['2026-11-13', '2026-11-14']);
});
console.log(n + ' coverage-watch tests passed');
