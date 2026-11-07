// node tests/fd-scorers.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { fdRefresh, fdFetchLeague, fdLatest } from '../lib/fd-scorers.js';
import { buildStats } from '../lib/competition-view.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
let calls = [];
const SC = { season: { startDate: '2026-08-16' }, scorers: [
  { player: { name: 'Raphinha' }, team: { name: 'FC Barcelona', shortName: 'Barcelona' }, playedMatches: 10, goals: 15, assists: 2, penalties: 3 },
  { player: { name: 'Kylian Mbappé' }, team: { name: 'Real Madrid CF', shortName: 'Real Madrid' }, playedMatches: 11, goals: 12, assists: null, penalties: null },
  { player: { name: 'Someone' }, team: { name: 'Unknown Club', shortName: 'Unknown' }, playedMatches: 3, goals: 4 }] };
globalThis.fetch = async (url, init) => { calls.push([String(url), init.headers['X-Auth-Token']]); return { status: 200, text: async () => JSON.stringify(SC) }; };
const m = (id, home, away, hg, ag) => ({ id, league: 'LALIGA', season: 2026, home, away, status: 'finished', hg, ag, date: '2026-10-01' });
const all = [m('a', 'Barcelona', 'Real Madrid', 2, 1), m('b', 'Sevilla', 'Barcelona', 0, 3)];

await t('fetch saves the list once and not again when nothing changed', async () => {
  const s = createMemoryStore();
  const a = await fdFetchLeague(s, { key: 'k', league: 'LALIGA', now: 1e12 }); assert.equal(a.ok, true); assert.equal(a.changed, true); assert.equal(a.count, 3);
  assert.ok(calls[0][0].includes('/competitions/PD/scorers?limit=100') && calls[0][1] === 'k');
  const b = await fdFetchLeague(s, { key: 'k', league: 'LALIGA', now: 1e12 + 1 }); assert.equal(b.changed, false);
  assert.equal((await s.strikerRows('fd_scorers')).length, 1);
  const d = await fdLatest(s, 'LALIGA', 2026); assert.equal(d.scorers[0].name, 'Raphinha'); assert.equal(d.scorers[1].assists, null);
});
await t('refresh: only stale leagues, max 1 per run, no key = off', async () => {
  calls = []; const s = createMemoryStore();
  const r1 = await fdRefresh(s, { key: 'k', max: 1, pauseMs: 0, now: 2e12 }); assert.equal(calls.length, 1); assert.equal(r1.results.length, 1);
  const r2 = await fdRefresh(s, { key: 'k', max: 1, pauseMs: 0, now: 2e12 + 1000 }); assert.equal(calls.length, 2, 'next run takes the next league, the first is still fresh');
  assert.equal((await fdRefresh(s, { key: '' })).ok, false);
});
await t('stats use football-data scorers, our club names, and keep assists/ratings from our own matches', async () => {
  const fd = { fetchedAt: '2026-11-07T10:00:00Z', scorers: SC.scorers.map(x => ({ name: x.player.name, team: x.team.shortName, teamFull: x.team.name, played: x.playedMatches, goals: x.goals, assists: x.assists ?? null, penalties: x.penalties ?? null })) };
  const st = buildStats(all, [], fd);
  assert.equal(st.players.scorersSource, 'football-data.org');
  assert.deepEqual(st.players.scorers.map(x => [x.name, x.club, x.goals, x.played]), [['Raphinha', 'Barcelona', 15, 10], ['Kylian Mbappé', 'Real Madrid', 12, 11]], 'a club we do not know is left out');
  const own = buildStats(all, [], null); assert.equal(own.players.scorersSource, 'ours');
});
console.log('fd-scorers tests:', n, 'passed');
