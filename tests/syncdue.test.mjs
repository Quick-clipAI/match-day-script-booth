// node tests/syncdue.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { syncDue, isDue, queueMissingStubs } from '../lib/sync-due.js';
const NOW = Date.parse('2026-10-22T23:00:00Z');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const m = (o) => ({ id: `${o.league || 'UCL'}|2026|${o.date}|${o.home.toLowerCase()}|${o.away.toLowerCase()}`, league: 'UCL', comp_name: 'x', season: 2026, round: null, time: null, kickoff: null, hg: null, ag: null, ht_h: null, ht_a: null, status: 'scheduled', note: null, source: 'paste', verified: false, conflict: null, ...o });
const fx = (home, away, short, hg, ag, date = '2026-10-22T19:00:00+00:00') => ({ fixture: { date, status: { short } }, league: { name: 'UEFA Champions League', country: 'World' }, teams: { home: { name: home }, away: { name: away } }, goals: { home: hg, away: ag }, score: { halftime: { home: 0, away: 1 }, penalty: { home: null, away: null } } });
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
await t('dates older than the plan window are never requested (they would be refused and still cost a request)', async () => {
  const w = await world([m({ date: '2026-10-19', home: 'A', away: 'B' })], () => []); const r = await w.run(); assert.equal(w.calls.length, 0); assert.equal(r.ran, false); assert.equal(r.outside, 1);
  process.env.API_DATE_WINDOW_DAYS = '30'; const w2 = await world([m({ date: '2026-10-19', home: 'A', away: 'B' })], () => []); await w2.run(); assert.equal(w2.calls.length, 1); delete process.env.API_DATE_WINDOW_DAYS;
});
await t('a stored date that disagrees with the real kick-off day: ask for the kick-off day, and correct the date when the result is filled', async () => {
  const w = await world([m({ date: '2026-10-22', home: 'Valencia', away: 'Villarreal', kickoff: '2026-10-21T16:30:00Z' })], d => d === '2026-10-21' ? [fx('Valencia', 'Villarreal', 'FT', 1, 2, '2026-10-21T16:30:00+00:00')] : []);
  const r = await w.run(); assert.deepEqual(w.calls, ['2026-10-21']); assert.equal(r.filled, 1);
  const x = (await w.s.listMatches({}))[0]; assert.equal(x.date, '2026-10-21'); assert.equal(x.hg, 1);
});
console.log(n + ' sync-due tests passed');

// Youth / women's fixtures with the same club names must never be taken for the senior match (UCL 3 Nov 2026: 5 wrong results)
{
  const { createMemoryStore } = await import('../lib/bank-store.js');
  const { syncDue } = await import('../lib/sync-due.js');
  const store = createMemoryStore();
  await store.upsertMatches([{ id: 'UCL|2026|2026-11-03|atletico madrid|bayern munchen', league: 'UCL', comp_name: 'UEFA Champions League', season: 2026, round: 'Matchday 4', date: '2026-11-03', kickoff: '2026-11-03T20:00:00+00:00', home: 'Atletico Madrid', away: 'Bayern München', status: 'scheduled', source: 'paste' }]);
  const fx = (id, lg, h, a, hg, ag) => ({ fixture: { id, date: '2026-11-03T14:00:00+00:00', status: { short: 'FT' } }, league: { id: 1, name: lg, country: 'World', season: 2026 }, teams: { home: { id: 1, name: h }, away: { id: 2, name: a } }, goals: { home: hg, away: ag }, score: { halftime: { home: 0, away: 0 } } });
  const youth = fx(1637361, 'UEFA Youth League', 'Atletico Madrid U19', 'Bayern Munich U19', 4, 1);
  const senior = fx(1635700, 'UEFA Champions League', 'Atletico Madrid', 'Bayern München', 0, 2);
  const getFixtures = async () => ({ response: [youth, senior], __left: 90 });
  await syncDue(store, { getFixtures, now: Date.parse('2026-11-03T23:00:00Z') });
  const m = await store.getMatch('UCL|2026|2026-11-03|atletico madrid|bayern munchen');
  assert.equal(m.hg, 0); assert.equal(m.ag, 2);
  assert.equal((await store.getDetail(m.id)).api_fixture_id, 1635700);
  console.log('youth look-alike test passed');
}

await t('queueMissingStubs: finished matches that never got a details row are queued from the day list, once, inside the date window', async () => {
  const N = Date.parse('2026-11-08T07:00:00Z');
  const fin = (o) => m({ ...o, status: 'finished', hg: 1, ag: 0, kickoff: o.date + 'T19:00:00Z' });
  const w = await world([fin({ date: '2026-11-07', home: 'Valencia', away: 'Real Madrid' }), fin({ date: '2026-11-07', home: 'Arsenal', away: 'Hull City' }), fin({ date: '2026-11-04', home: 'Old', away: 'Match' })],
    d => [fx('Valencia CF', 'Real Madrid', 'FT', 0, 3, '2026-11-07T19:00:00+00:00'), { ...fx('Arsenal', 'Hull City', 'FT', 1, 0, '2026-11-07T19:00:00+00:00'), fixture: { id: 902, date: '2026-11-07T19:00:00+00:00', status: { short: 'FT' } } }].map((x, i) => ({ ...x, fixture: { ...x.fixture, id: 900 + i } })));
  const calls = []; const getFixtures = async (d) => { calls.push(d); return { response: (await w.s.listMatches({})) && [fx('Valencia CF', 'Real Madrid', 'FT', 0, 3, '2026-11-07T19:00:00+00:00'), fx('Arsenal', 'Hull City', 'FT', 1, 0, '2026-11-07T19:00:00+00:00')].map((x, i) => ({ ...x, fixture: { ...x.fixture, id: 900 + i } })) }; };
  const r = await queueMissingStubs(w.s, { getFixtures, now: N });
  assert.equal(r.queued, 2); assert.deepEqual(calls, ['2026-11-07'], 'one request for the one day inside the window; the 4 Nov match is outside it');
  assert.equal((await w.s.getDetail(w.s ? (await w.s.listMatches({})).find(x => x.home === 'Valencia').id : '')).api_fixture_id, 900);
  const again = await queueMissingStubs(w.s, { getFixtures, now: N + 60000 }); assert.equal(again.calls, 0, 'nothing more to ask for (or asked recently)');
});
