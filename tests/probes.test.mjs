// node tests/probes.test.mjs
import assert from 'node:assert/strict';
import { highlightlyProbe, openLigaProbe } from '../lib/probes.js';
const mk = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
globalThis.fetch = async url => {
  if (url.includes('/matches?')) return mk(200, { data: [{ id: 7, homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, state: { description: 'Finished', score: { current: '2 - 1' } }, league: { season: 2026, name: 'Premier League' } }], pagination: { totalCount: 1 }, plan: { tier: 'BASIC' } });
  if (url.includes('/events/')) return mk(200, [{ type: 'Goal', time: '15', player: 'X' }]);
  if (url.includes('/lineups/')) return mk(200, { homeTeam: { formation: '4-3-3', initialLineup: [[{ name: 'G' }], [{ name: 'D' }]], substitutes: [{ name: 'S' }] }, awayTeam: { initialLineup: [], substitutes: [] } });
  if (url.includes('openligadb')) return mk(200, [{ team1: { teamName: 'Bayern' }, team2: { teamName: 'Stuttgart' }, matchIsFinished: true, matchResults: [{ resultName: 'Endergebnis', pointsTeam1: 5, pointsTeam2: 1 }], goals: [{ goalGetterName: 'Kane', matchMinute: 21, scoreTeam1: 1, scoreTeam2: 0, isPenalty: false, isOwnGoal: false }] }]);
};
const h = await highlightlyProbe({ key: 'k', date: '2026-10-01' });
assert.equal(h.requests, 3); assert.equal(h.testedMatch.id, 7); assert.equal(h.lineups.home.starters, 2); assert.equal(h.events.count, 1);
assert.equal((await highlightlyProbe({ key: '', date: 'x' })).ok, false);
const o = await openLigaProbe({}); assert.equal(o.withGoalList, 1); assert.equal(o.sample[0].goals[0].scorer, 'Kane');
console.log('probes tests: 5 passed');
