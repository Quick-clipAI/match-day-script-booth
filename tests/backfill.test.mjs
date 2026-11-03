// node tests/backfill.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { backfillIds } from '../lib/backfill-ids.js';
const row = (id, home, away, date) => ({ id, league: 'UCL', comp_name: 'UEFA Champions League', season: 2026, round: 'Matchday 1', date, home, away, status: 'finished', hg: 1, ag: 0, source: 'paste' });
const s = createMemoryStore();
await s.upsertMatches([row('UCL|2026|2026-09-08|aek athens|lask', 'AEK Athens', 'LASK', '2026-09-08'), row('UCL|2026|2026-09-09|napoli|arsenal', 'Napoli', 'Arsenal', '2026-09-09'), row('UCL|2026|2026-09-10|x|y', 'Nobody', 'Else', '2026-09-10')]);
const fx = (id, d, h, a) => ({ fixture: { id, date: d + 'T19:00:00+00:00' }, teams: { home: { name: h }, away: { name: a } } });
const r = await backfillIds(s, { getSeasonFixtures: async () => ({ errors: [], response: [fx(11, '2026-09-08', 'AEK Athens', 'LASK'), fx(12, '2026-09-09', 'SSC Napoli', 'Arsenal')] }) });
assert.equal(r.calls, 1); assert.equal(r.stubs, 2);
assert.deepEqual((await s.pendingDetails(10, '', ['UCL'])).map(x => x.api_fixture_id).sort(), [11, 12]);
const bad = await backfillIds(createMemoryStore(), { getSeasonFixtures: async () => ({}) });
assert.equal(bad.stubs, 0);
const s2 = createMemoryStore(); await s2.upsertMatches([row('UCL|2026|a|b', 'A', 'B', '2026-09-08')]);
const e = await backfillIds(s2, { getSeasonFixtures: async () => ({ errors: { plan: 'Free plans do not have access to this season' }, response: [] }) });
assert.equal(e.stubs, 0); assert.match(e.error, /Free plans/);
console.log('backfill tests: 4 passed');
