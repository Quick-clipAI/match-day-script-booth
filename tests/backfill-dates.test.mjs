// node tests/backfill-dates.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { backfillByDates } from '../lib/backfill-ids.js';
const row = (id, home, away, date) => ({ id, league: 'EPL', comp_name: 'Premier League', season: 2026, round: '', date, home, away, status: 'finished', hg: 1, ag: 0 });
const s = createMemoryStore();
await s.upsertMatches([row('EPL|2026|arsenal|chelsea', 'Arsenal', 'Chelsea', '2026-10-18'), row('EPL|2026|spurs|everton', 'Tottenham Hotspur', 'Everton', '2026-10-19')]);
const fx = (id, d, h, a) => ({ fixture: { id, date: d + 'T15:00:00+00:00' }, league: { name: 'Premier League', country: 'England' }, teams: { home: { name: h }, away: { name: a } } });
const calls = [];
const getFixtures = async d => { calls.push(d); return { errors: [], response: d === '2026-10-18' ? [fx(501, d, 'Arsenal', 'Chelsea')] : [fx(502, d, 'Tottenham', 'Everton')], __left: 80 }; };
const r = await backfillByDates(s, { getFixtures, leagues: ['EPL'], todayISO: '2026-11-04' });
assert.equal(r.calls, 2); assert.equal(r.stubs, 2); assert.deepEqual(calls, ['2026-10-19', '2026-10-18']);   // newest first
assert.deepEqual((await s.pendingDetails(10, '', ['EPL'])).map(x => x.api_fixture_id).sort(), [501, 502]);
const again = await backfillByDates(s, { getFixtures, leagues: ['EPL'], todayISO: '2026-11-04' });
assert.equal(again.calls, 0);                                          // already queued: no requests spent
const s2 = createMemoryStore(); await s2.upsertMatches([row('EPL|2026|a|b', 'Arsenal', 'Chelsea', '2026-10-18')]);
const bad = await backfillByDates(s2, { getFixtures: async () => ({ errors: { plan: 'Free plans do not have access to this date' }, response: [] }), leagues: ['EPL'], todayISO: '2026-11-04' });
assert.equal(bad.stubs, 0); assert.match(bad.error, /Free plans/); assert.equal(bad.calls, 1);
const low = await backfillByDates(s, { getFixtures, leagues: ['EPL'], todayISO: '2026-11-04' });
console.log('backfill-dates tests: 5 passed');
