// node tests/fd-scorers.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { fdRefresh, fdFetchLeague, fdLatest } from '../lib/fd-scorers.js';
import { buildStats } from '../lib/competition-view.js';
import { placeScorers } from '../lib/fd-scorers.js';
import { aggregatePlayers, playerCard } from '../lib/player-season.js';
import { enrichFromRoster } from '../lib/player-card.js';
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
await t('exact club name beats a loose one: FC Barcelona is never RCD Espanyol de Barcelona', async () => {
  const clubs = ['RCD Espanyol de Barcelona', 'Barcelona', 'Atletico Madrid'];
  const r = placeScorers([{ name: 'a', team: 'Barça', teamFull: 'FC Barcelona' }, { name: 'b', team: 'Espanyol', teamFull: 'RCD Espanyol de Barcelona' }, { name: 'c', team: 'Atleti', teamFull: 'Club Atlético de Madrid' }], clubs);
  assert.deepEqual(r.map(x => x.club), ['Barcelona', 'RCD Espanyol de Barcelona', 'Atletico Madrid']);
  const al = placeScorers([{ name: 'x', team: 'PSV', teamFull: 'PSV' }], ['PSV Eindhoven'], new Map([['psv', 'PSV Eindhoven']]));
  assert.equal(al[0].club, 'PSV Eindhoven');
});
await t('a repeated detail row for one match does not count its goals twice', async () => {
  const mt = { id: 1, date: '2026-11-01', league: 'LALIGA', home: 'A FC', away: 'B FC', hg: 1, ag: 0, status: 'finished' };
  const d = { match_id: 1, data: { lineups: { home: { xi: [{ name: 'Jo Smith', min: 90 }], subs: [] }, away: { xi: [], subs: [] } }, events: [{ type: 'goal', detail: 'Normal Goal', side: 'home', player: 'Jo Smith', min: 10 }] } };
  const goals = det => [...aggregatePlayers([mt], det).values()][0].goals;
  assert.equal(goals([d]), 1); assert.equal(goals([d, d]), 1);
});
await t('the player card carries the API player id (for the photo) and the shirt number', async () => {
  const mt = { id: 1, date: '2026-11-01', league: 'LALIGA', home: 'A FC', away: 'B FC', hg: 1, ag: 0, status: 'finished' };
  const d = { match_id: 1, data: { lineups: { home: { xi: [{ id: 284, n: 11, name: 'Jo Smith', min: 90 }], subs: [] }, away: { xi: [], subs: [] } }, events: [] } };
  const c = playerCard([...aggregatePlayers([mt], [d]).values()][0]);
  assert.equal(c.pid, 284); assert.equal(c.num, 11);
});
await t('card gets age, nationality and birth date from the stored squad (club + name, one clear match only)', async () => {
  const roster = [{ name: 'Raphael Dias Belloli', dob: '1996-12-14', nationality: 'Brazil', shirt: 11, position: 'Attacker' }, { name: 'Other Player', dob: '2000-01-01', nationality: 'Spain', shirt: 9 }];
  const c = enrichFromRoster({ name: 'R. Dias', club: 'Barcelona', pos: 'F' }, roster, '2026-11-08');
  assert.equal(c.nationality, 'Brazil'); assert.equal(c.age, 29); assert.equal(c.dob, '1996-12-14'); assert.equal(c.num, 11);
  const two = enrichFromRoster({ name: 'J. Silva', club: 'X' }, [{ name: 'Joao Silva', dob: '1990-01-01', nationality: 'A' }, { name: 'Jose Silva', dob: '1991-01-01', nationality: 'B' }], '2026-11-08');
  assert.equal(two.nationality, undefined, 'two candidates: nothing is guessed');
});
console.log('fd-scorers tests:', n, 'passed');
