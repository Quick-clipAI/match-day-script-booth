// node tests/openliga.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { convertOpenLiga, importOpenLiga } from '../lib/openliga-import.js';
const g = (id, name, min, s1, s2, extra = {}) => ({ goalID: id, goalGetterName: name, matchMinute: min, scoreTeam1: s1, scoreTeam2: s2, isPenalty: false, isOwnGoal: false, ...extra });
const x = { matchIsFinished: true, matchDateTime: '2026-08-28T20:30:00', team1: { teamName: 'FC Bayern München' }, team2: { teamName: 'VfB Stuttgart' }, matchResults: [{ resultName: 'Halbzeit', pointsTeam1: 1, pointsTeam2: 0 }, { resultName: 'Endergebnis', pointsTeam1: 3, pointsTeam2: 1 }],
  goals: [g(1, 'D. Upamecano', 21, 1, 0), g(2, 'N. Demirovic', 52, 1, 1), g(3, 'J. Vagnoman', 57, 2, 1, { isOwnGoal: true }), g(4, 'H. Kane', 82, 3, 1, { isPenalty: true })] };
const c = convertOpenLiga(x);
assert.equal(c.events.length, 4); assert.equal(c.events[1].side, 'away'); assert.equal(c.events[2].detail, 'Own Goal'); assert.equal(c.events[2].side, 'home'); assert.equal(c.events[3].detail, 'Penalty');
assert.equal(convertOpenLiga({ ...x, goals: x.goals.slice(1) }), null);                      // goals do not add up
assert.equal(convertOpenLiga({ ...x, matchIsFinished: false }), null);
const s = createMemoryStore();
const row = (id, home, away, hg, ag) => ({ id, league: 'BUNDESLIGA', comp_name: 'Bundesliga', season: 2026, round: '', date: '2026-08-28', home, away, status: 'finished', hg, ag });
await s.upsertMatches([row('BUNDESLIGA|2026|bayern munchen|stuttgart', 'Bayern München', 'VfB Stuttgart', 3, 1), row('BUNDESLIGA|2026|x|y', 'Mainz', 'Paderborn', 0, 0)]);
await s.saveManualDetail('BUNDESLIGA|2026|bayern munchen|stuttgart', { v: 1, source: 'openmatchday', events: [], lineups: {}, stats: [{ label: 'Total Shots', home: 21, away: 11 }], goalMinutes: [21, 52, 57, 82] });
const r = await importOpenLiga(s, [x]);
assert.equal(r.merged, 1); const d = (await s.getDetail('BUNDESLIGA|2026|bayern munchen|stuttgart')).data;
assert.equal(d.events.length, 4); assert.equal(d.stats[0].label, 'Total Shots'); assert.equal(d.source, 'openmatchday');
await s.saveManualDetail('BUNDESLIGA|2026|x|y', { v: 1, source: 'api-football', events: [], lineups: {}, stats: [] });
assert.equal((await importOpenLiga(s, [{ ...x, team1: { teamName: 'Mainz' }, team2: { teamName: 'Paderborn' }, matchResults: [{ resultName: 'Endergebnis', pointsTeam1: 0, pointsTeam2: 0 }], goals: [] }])).kept, 1);
console.log('openliga tests: 9 passed');
