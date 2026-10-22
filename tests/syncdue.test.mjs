// node tests/syncdue.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { syncDue, isDue } from '../lib/sync-due.js';
const NOW = Date.parse('2026-10-22T23:00:00Z');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const m = (o) => ({ id: `${o.league || 'UCL'}|2026|${o.date}|${o.home.toLowerCase()}|${o.away.toLowerCase()}`, league: 'UCL', comp_name: 'x', season: 2026, round: null, time: null, kickoff: null, hg: null, ag: null, ht_h: null, ht_a: null, status: 'scheduled', note: null, source: 'paste', verified: false, conflict: null, ...o });
const fx = (home, away, short, hg, ag, date = '2026-10-22T19:00:00+00:00') => ({ fixture: { date, status: { short } }, league: { name: 'Whatever', country: 'World' }, teams: { home: { name: home }, away: { name: away } }, goals: { home: hg, away: ag }, score: { halftime: { home: 0, away: 1 }, penalty: { home: null, away: null } } });
async function world(rows, resp, opts = {}) {
  const s = createMemoryStore(); await s.upsertMatches(rows); const calls = [];
  const getFixtures = async (d) => { calls.push(d); return { response: resp(d) }; };
  return { s, calls, run: (now = NOW, extra = {}) => syncDue(s, { getFixtures, now, ...extra }) };
}
await t('isDue: kick-off known -> 110 min after; unknown -> after 22:30 UTC on its date', () => {
  assert.equal(isDue(m({ date: '2026-10-22', home: 'A', away: 'B', kickoff: '2026-10-22T19:00:00Z' }), Date.parse('2026-10-22T20:49:00Z')), false);
  assert.equal(isDue(m({ date: '2026-10-22', home: 'A', away: 'B', kickoff: '2026-10-22T19:00:00Z' }), Date.parse('2026-10-22T20:51:00Z')), true);
  assert.equal(isDue(m({ date: '2026-10-22', home: 'A', away: 'B' }), Date.parse('2026-10-22T22:00:00Z')), false);
  assert.equal(isDue(m({ date: '2026-10-22', home: 'A', away: 'B' }), Date.parse('2026-10-22T22:31:00Z')), true);
  assert.equal(isDue(m({ date: '2026-10-22', home: 'A', away: 'B', status: 'finished' }), NOW), false);
});
await t('nothing due: no API request at all', async () => {
  const w = await world([m({ date: '2026-10-23', home: 'A', away: 'B' })], () => []); const r = await w.run(); assert.equal(r.ran, false); assert.equal(w.calls.length, 0);
});
await t('fills a finished match (any league, name variants), one request per date', async () => {
  const w = await world([m({ date: '2026-10-22', home: 'Paris Saint-Germain', away: 'Barcelona', kickoff: '2026-10-22T19:00:00Z' }), m({ league: 'WORLD_CUP', date: '2026-10-22', home: 'Nigeria', away: 'Ghana', kickoff: '2026-10-22T18:00:00Z' })],
    () => [fx('Paris Saint Germain', 'FC Barcelona', 'FT', 2, 1), fx('Nigeria', 'Ghana', 'AET', 1, 1)]);
  const r = await w.run(); assert.equal(r.calls, 1); assert.equal(r.filled, 2);
  const all = await w.s.listMatches({}); const psg = all.find(x => x.home === 'Paris Saint-Germain'); assert.equal(psg.status, 'finished'); assert.equal(psg.hg, 2); assert.equal(psg.ag, 1); assert.equal(psg.ht_a, 1);
  const ng = all.find(x => x.home === 'Nigeria'); assert.equal(ng.note, 'after extra time'); assert.equal(ng.league, 'WORLD_CUP');
});
await t('still live: not filled, kick-off remembered, asked again later', async () => {
  const w = await world([m({ date: '2026-10-22', home: 'Alpha', away: 'Beta' })], () => [fx('Alpha', 'Beta', '2H', 1, 0, '2026-10-22T20:00:00+00:00')]);
  const r = await w.run(); assert.equal(r.filled, 0); const x = (await w.s.listMatches({}))[0]; assert.equal(x.status, 'scheduled'); assert.ok(x.kickoff);
  const r2 = await w.run(NOW + 5 * 60000); assert.equal(r2.ran, false, 'throttled within 25 minutes'); assert.equal(w.calls.length, 1);
  const r3 = await w.run(NOW + 40 * 60000); assert.equal(w.calls.length, 2, 'asked again after 25 minutes');
});
await t('postponed is recorded, not guessed', async () => {
  const w = await world([m({ date: '2026-10-22', home: 'Alpha', away: 'Beta' })], () => [fx('Alpha', 'Beta', 'PST', null, null)]);
  const r = await w.run(); assert.equal(r.postponed, 1); assert.equal((await w.s.listMatches({}))[0].status, 'postponed');
});
await t('API error is reported and nothing is written', async () => {
  const s = createMemoryStore(); await s.upsertMatches([m({ date: '2026-10-22', home: 'Alpha', away: 'Beta' })]);
  const r = await syncDue(s, { getFixtures: async () => ({ errors: { requests: 'limit reached' }, response: [] }), now: NOW });
  assert.equal(r.filled, 0); assert.match(r.summary, /limit reached/); assert.equal((await s.listMatches({}))[0].status, 'scheduled');
});
await t('at most 2 requests per run', async () => {
  const w = await world([m({ date: '2026-10-20', home: 'A1', away: 'B1' }), m({ date: '2026-10-21', home: 'A2', away: 'B2' }), m({ date: '2026-10-22', home: 'A3', away: 'B3' })], () => []);
  await w.run(); assert.equal(w.calls.length, 2);
});
console.log(n + ' sync-due tests passed');
