// node tests/probes.test.mjs
import assert from 'node:assert/strict';
import { highlightlyProbe, openLigaProbe, footballDataProbe } from '../lib/probes.js';
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
{ const seen = []; const keep = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push([String(url), init.headers['X-Auth-Token']]); const j = x => ({ status: 200, text: async () => JSON.stringify(x) });
    return String(url).includes('/teams') ? j({ teams: [{ name: 'Real Madrid CF', squad: [{ name: 'K', dateOfBirth: '1998-12-20', nationality: 'France', position: 'Offence', shirtNumber: 10 }, { name: 'L' }] }] }) : String(url).includes('/scorers') ? j({ season: { startDate: '2026-08-15' }, scorers: [{ player: { name: 'Kylian Mbappé' }, team: { name: 'Real Madrid CF' }, playedMatches: 11, goals: 12, assists: 3, penalties: 4 }] }) : j({ name: 'Primera Division', currentSeason: { startDate: '2026-08-15', endDate: '2027-05-30', currentMatchday: 12 } }); };
  const f = await footballDataProbe({ key: 'secret', code: 'PD' }); globalThis.fetch = keep;
  assert.equal(f.requests, 3); assert.equal(f.squads.teams, 1); assert.equal(f.squads.players, 2); assert.equal(f.squads.have.dateOfBirth, 1); assert.equal(f.squads.sample[0].first[0].nationality, 'France'); assert.equal(f.scorers.hasAssists, true); assert.equal(f.scorers.sample[0].goals, 12); assert.equal(f.competition.season.matchday, 12);
  assert.ok(seen.every(x => x[1] === 'secret') && seen[1][0].includes('/competitions/PD/scorers') && seen[2][0].includes('/competitions/PD/teams'));
  assert.ok(!JSON.stringify(f).includes('secret'), 'the key is never returned');
  assert.equal((await footballDataProbe({ key: '' })).ok, false); }
console.log('probes tests: 6 passed');
