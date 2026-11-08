// node tests/fd-squads.test.mjs
import assert from 'node:assert/strict';
import { planSquadFill } from '../lib/fd-squads.js';
import { pickPlayer } from '../lib/player-match.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const P = (id, name, club, o = {}) => ({ id, name, club, league: 'LALIGA', season: 2026, dob: null, nationality: null, position: null, age: null, ...o });
const roster = [
  P(1, 'Raphinha', 'Barcelona', { dob: '1996-12-14', nationality: 'Brazil', position: 'Forward', age: 29 }),
  P(2, 'Pau Cubarsí Paredes', 'Barcelona'), P(3, 'Fermín', 'Barcelona'), P(4, 'Lamine Yamal', 'Barcelona'),
  P(5, 'Roberto Fernández', 'RCD Espanyol de Barcelona'), P(6, 'Gabi', 'Barcelona'), P(7, 'Gabi', 'Barcelona')
];
const teams = [
  { name: 'FC Barcelona', shortName: 'Barça', squad: [
    { name: 'Raphinha', dateOfBirth: '1990-01-01', nationality: 'Portugal', position: 'Offence' },     // already complete: must not change
    { name: 'Pau Cubarsí', dateOfBirth: '2007-01-22', nationality: 'Spain', position: 'Defence' },
    { name: 'Fermín López', dateOfBirth: '2003-05-11', nationality: 'Spain', position: 'Midfield' },
    { name: 'Lamine Yamal', dateOfBirth: '2007-07-13', nationality: 'Spain', position: null },
    { name: 'Gabi Martinez', dateOfBirth: '2000-01-01', nationality: 'Spain', position: 'Midfield' },   // two "Gabi": no guess
    { name: 'Somebody New', dateOfBirth: '2001-01-01', nationality: 'Spain', position: 'Offence' } ] },
  { name: 'RCD Espanyol de Barcelona', shortName: 'Espanyol', squad: [{ name: 'Roberto Fernández', dateOfBirth: '2003-07-13', nationality: 'Spain', position: 'Offence' }] },
  { name: 'Mystery FC', squad: [{ name: 'X', dateOfBirth: '2000-01-01', nationality: 'Spain' }] }
];
await t('fills only empty fields, never overwrites, never guesses, never mixes Barcelona and Espanyol', () => {
  const { rows, report } = planSquadFill({ teams, roster, today: '2026-11-08' });
  const by = id => rows.find(r => r.id === id);
  assert.equal(by(1), undefined, 'a complete player is left alone');
  assert.deepEqual([by(2).dob, by(2).nationality, by(2).position, by(2).age], ['2007-01-22', 'Spain', 'Defender', 19]);
  assert.equal(by(3).nationality, 'Spain');                               // "Fermín López" -> "Fermín"
  assert.equal(by(4).position, null); assert.equal(by(4).dob, '2007-07-13');
  assert.equal(by(5).dob, '2003-07-13'); assert.equal(by(5).club, 'RCD Espanyol de Barcelona');
  assert.equal(by(6), undefined); assert.equal(by(7), undefined);          // ambiguous "Gabi"
  assert.deepEqual(report.unmatchedClubs, ['Mystery FC']);
  assert.equal(report.unmatchedPlayers, 2, 'Gabi Martinez, Somebody New and nothing else');
});
await t('"Korea, South" and "South Korea" are the same country, not a conflict', () => {
  const r = [P(1, 'Jens Castrop', 'B', { dob: '2003-06-27', nationality: 'Korea, South', position: 'Midfielder', age: 23 })];
  const x = planSquadFill({ teams: [{ name: 'B', squad: [{ name: 'Jens Castrop', dateOfBirth: '2003-06-27', nationality: 'South Korea', position: 'Midfield' }] }], roster: r, today: '2026-11-08', mode: 'preview' });
  assert.equal(x.report.conflicts.nationality, 0);
});
await t('pickPlayer: exact, initial + surname, mononym, and ambiguity', () => {
  const r = [P(1, 'Raphael Dias Belloli', 'B'), P(2, 'Joao Silva', 'B'), P(3, 'Jose Silva', 'B')];
  assert.equal(pickPlayer('R. Dias', r).id, 1); assert.equal(pickPlayer('J. Silva', r), null); assert.equal(pickPlayer('Joao Silva', r).id, 2);
});
await t('overwrite: football-data.org wins on conflicts, spelling variants are not conflicts, old values are kept for undo; preview changes nothing', () => {
  const r = [P(1, 'Ruben Dias', 'Barcelona', { dob: '1997-05-14', nationality: 'Ivory Coast', position: 'Defender', age: 29 }), P(2, 'Gavi', 'Barcelona', { dob: '2004-08-05', nationality: 'Brazil', position: 'Midfielder', age: 22 })];
  const tm = [{ name: 'FC Barcelona', squad: [{ name: 'Ruben Dias', dateOfBirth: '1997-05-14', nationality: "Côte d'Ivoire", position: 'Defence' }, { name: 'Gavi', dateOfBirth: '2004-08-05', nationality: 'Spain', position: 'Midfield' }] }];
  const o = planSquadFill({ teams: tm, roster: r, today: '2026-11-08', mode: 'overwrite' });
  assert.equal(o.report.conflicts.nationality, 1, 'only Gavi: Ivory Coast = Cote d\'Ivoire'); assert.equal(o.rows.length, 1); assert.equal(o.rows[0].nationality, 'Spain');
  assert.deepEqual(o.report.backup, [{ id: 2, dob: '2004-08-05', nationality: 'Brazil', age: 22, age_as_of: null }]);
  assert.deepEqual(o.report.conflictSample[0], { player: 'Gavi', club: 'Barcelona', field: 'nationality', was: 'Brazil', now: 'Spain' });
  const p = planSquadFill({ teams: tm, roster: r, today: '2026-11-08', mode: 'preview' });
  assert.equal(p.rows.length, 0); assert.equal(p.report.conflicts.nationality, 1);
  const f = planSquadFill({ teams: tm, roster: r, today: '2026-11-08', mode: 'fill' });
  assert.equal(f.rows.length, 0, 'fill mode never touches an existing value');
});
console.log('fd-squads tests: ' + n + ' passed');
