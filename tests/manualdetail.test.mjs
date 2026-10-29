// node tests/manualdetail.test.mjs
import assert from 'node:assert/strict';
process.env.BANK_STORE = 'memory'; process.env.ADMIN_KEY = 'k';
import { normalizeDetail } from '../lib/manual-detail.js';
import { buildView } from '../lib/match-view.js';
import handler from '../api/admin.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const M = { home: 'Arsenal', away: 'Chelsea', hg: 2, ag: 1 };
const full = { score: { hg: 2, ag: 1, ht_h: 1, ht_a: 0 }, venue: 'Emirates Stadium, London', referee: 'A. Taylor',
  events: [{ minute: 60, team: 'away', type: 'sub', on: 'C. Palmer', off: 'N. Jackson' }, { minute: 17, team: 'home', type: 'goal', player: 'B. Saka', assist: 'M. Odegaard' }, { minute: 45, extra: 2, team: 'Chelsea', type: 'yellow', player: 'E. Fernandez' }, { minute: 70, team: 'home', type: 'penalty', player: 'K. Havertz' }, { minute: 80, team: 'away', type: 'goal', player: 'C. Palmer' }],
  stats: { possession: [47, '53%'], shots: [14, 9] },
  lineups: { home: { formation: '4-3-3', xi: [{ name: 'D. Raya', pos: 'G', grid: '1:1', rating: 7.4 }] } } };
await t('normalizes events, stats, lineups; sorts events; mirrors the API shape', () => {
  const r = normalizeDetail(full, M); assert.equal(r.problems.length, 0, r.problems.join());
  assert.deepEqual(r.data.events.map(e => e.m), [17, 45, 60, 70, 80]);
  assert.equal(r.data.events[0].detail, 'Normal Goal'); assert.equal(r.data.events[0].other, 'M. Odegaard');
  assert.equal(r.data.events[1].side, 'away'); assert.equal(r.data.events[1].detail, 'Yellow Card');
  assert.equal(r.data.events[2].player, 'N. Jackson'); assert.equal(r.data.events[2].other, 'C. Palmer');   // subst: player = off, other = on
  assert.deepEqual(r.data.stats[0], { label: 'Ball Possession', home: '47%', away: '53%' });
  assert.equal(r.data.best.name, 'D. Raya'); assert.equal(r.data.source, 'manual'); assert.equal(r.score.hg, 2);
  assert.ok(r.warnings.some(w => /1 starters/.test(w)));
});
await t('rejects bad input with a pointer to the field', () => {
  const r = normalizeDetail({ events: [{ minute: 200, team: 'home', type: 'goal', player: 'X' }, { minute: 5, team: 'nobody', type: 'goal', player: 'X' }, { minute: 5, team: 'home', type: 'dive', player: 'X' }], stats: { possession: [60] }, lineups: { home: { xi: [{ name: 'A', grid: '9' }] } } }, M);
  assert.equal(r.problems.length, 5); assert.ok(r.problems[0].startsWith('events[0]'));
  assert.ok(normalizeDetail({}, M).problems[0].startsWith('Nothing'));
});
await t('warns when goals do not match the score', () => {
  const r = normalizeDetail({ events: [{ minute: 5, team: 'home', type: 'goal', player: 'X' }] }, M); assert.ok(r.warnings.some(w => /give 1-0 but the score is 2-1/.test(w)));
});
const call = body => new Promise(r => { const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { r({ c: this.c, o }); } }; handler({ method: 'POST', headers: { 'x-admin-key': 'k' }, query: {}, body }, res); });
await t('admin importDetails: preview, save, appears in the match view, score set', async () => {
  await call({ action: 'saveMatch', match: { league: 'EPL', season: 2026, date: '2026-10-24', home: 'Arsenal', away: 'Chelsea' } });
  const prev = await call({ action: 'importDetails', text: JSON.stringify({ league: 'EPL', season: 2026, date: '2026-10-24', home: 'Arsenal', away: 'Chelsea', ...full }) });
  assert.equal(prev.o.preview, true); assert.equal(prev.o.results[0].ok, true, JSON.stringify(prev.o));
  const saved = await call({ action: 'importDetails', dryRun: false, text: JSON.stringify({ league: 'EPL', season: 2026, date: '2026-10-24', home: 'Arsenal', away: 'Chelsea', ...full }) });
  assert.equal(saved.o.results[0].saved, true);
  const { storeFromEnv } = await import('../lib/bank-store.js'); const { store } = storeFromEnv();
  const m = (await store.listMatches({ league: 'EPL', season: 2026 }))[0]; assert.equal(m.status, 'finished'); assert.equal(m.hg, 2); assert.equal(m.verified, true);
  const v = await buildView(store, m); assert.equal(v.detail.source, 'manual'); assert.equal(v.detail.events.length, 5); assert.equal(v.detailState, 'ok');
  const bad = await call({ action: 'importDetails', text: JSON.stringify({ league: 'EPL', season: 2026, home: 'Nobody', away: 'Chelsea', events: [] }) });
  assert.match(bad.o.results[0].problems[0], /not in the data bank/);
});
console.log(n + ' manual-detail tests passed');
