// node tests/player-season.test.mjs
import assert from 'node:assert/strict';
import { aggregatePlayers, clubLeaders, leaderboard, playerKey, playerCard } from '../lib/player-season.js';
const m = (id, d, h, a, lg = 'EPL') => ({ id, league: lg, season: 2026, date: d, home: h, away: a, hg: 2, ag: 1, status: 'finished', _short: lg });
const det = (id, home, away) => ({ match_id: id, data: { lineups: { home: { xi: home, subs: [] }, away: { xi: away, subs: [{ id: 99, name: 'Unused', min: 0 }] } } } });
const P = (id, name, rating, g = 0, a = 0, min = 90) => ({ id, name, rating, g, a, min, pos: 'F' });
const ms = [m('1', '2026-10-01', 'X', 'Y'), m('2', '2026-10-08', 'Y', 'X'), m('3', '2026-10-15', 'X', 'Z', 'UCL')];
const ds = [det('1', [P(1, 'Ace', '8.0', 2)], [P(2, 'Bob', '6.0')]), det('2', [P(2, 'Bob', '6.4')], [P(1, 'Ace', '7.0', 0, 1)]), det('3', [P(1, 'Ace', '7.5', 1)], [P(3, 'Cy', '9.0')])];
const pl = aggregatePlayers(ms, ds);
const ace = [...pl.values()].find(p => p.name === 'Ace');
assert.equal(ace.apps, 3); assert.equal(ace.key, 'x|ace|'); assert.equal(ace.goals, 3); assert.equal(ace.assists, 1); assert.equal(ace.rating, 7.5);
assert.ok(![...pl.values()].some(p => p.name === 'Unused'));
assert.equal(ace.log[0].date, '2026-10-15');
assert.equal(clubLeaders(pl, 'X')[0].name, 'Ace');
assert.equal(clubLeaders(pl, 'Z').length, 0);                           // one rated match is not enough
assert.equal(leaderboard(pl, 'goals')[0].name, 'Ace');
assert.equal(playerKey('Bryan Mbeumo', 'Man Utd'), playerKey('B. Mbeumo', 'Man Utd')); assert.notEqual(playerKey('B. Mbeumo', 'A'), playerKey('B. Mbeumo', 'B'));
assert.equal(leaderboard(pl, 'goals', { league: 'UCL' })[0].goals, 1);
assert.equal(leaderboard(pl, 'rating', { minRated: 3 })[0].name, 'Ace');
console.log('player-season tests: 9 passed');
// events + lineups from different sources merge into one player; the card spans competitions
{
  const ms2 = [m('1', '2026-10-01', 'X', 'Y'), m('2', '2026-10-08', 'X', 'Z', 'UCL')];
  const ds2 = [
    { match_id: '1', data: { source: 'highlightly', events: [{ type: 'goal', side: 'home', detail: 'Normal Goal', player: 'Bryan Mbeumo', other: 'M. Cunha' }], lineups: { home: { xi: [{ name: 'Bryan Mbeumo', min: 90, rating: null, pos: 'F' }], subs: [] }, away: { xi: [], subs: [] } } } },
    { match_id: '2', data: { source: 'api-football', events: [{ type: 'goal', side: 'home', detail: 'Penalty', player: 'B. Mbeumo', other: '' }], lineups: { home: { xi: [{ id: 5, name: 'B. Mbeumo', min: 80, rating: '7.4', g: 1, a: 0, pos: 'F' }], subs: [] }, away: { xi: [], subs: [] } } } }
  ];
  const p2 = aggregatePlayers(ms2, ds2); const mb = [...p2.values()].filter(p => p.name.includes('Mbeumo'));
  assert.equal(mb.length, 1); assert.equal(mb[0].name, 'Bryan Mbeumo'); assert.equal(mb[0].goals, 2); assert.equal(mb[0].apps, 2); assert.equal(mb[0].rating, 7.4);
  assert.equal([...p2.values()].find(p => p.name === 'M. Cunha').assists, 1);
  const card = playerCard(mb[0]); assert.equal(card.competitions.length, 2); assert.equal(card.matches[0].date, '2026-10-08'); assert.equal(card.rated, 1);
}
console.log('player-season merge tests: 6 passed');
