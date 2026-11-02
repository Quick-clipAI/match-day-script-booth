// node tests/mls.test.mjs
import assert from 'node:assert/strict';
import { LEAGUES, leagueForApiFixture, parseApiFootball, matchId, seasonLabel } from '../lib/bank-core.js';
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const fx = (lg, home, away) => ({ league: { name: lg.name, country: lg.country, season: 2026, round: 'Regular Season - 5' }, teams: { home: { name: home }, away: { name: away } }, fixture: { date: '2026-03-21T23:30:00+00:00', status: { short: 'FT' } }, goals: { home: 1, away: 0 }, score: {} });
const MLS = { name: 'Major League Soccer', country: 'USA' };
t('MLS league game goes to MLS', () => assert.equal(leagueForApiFixture(fx(MLS, 'Austin', 'Seattle Sounders')), 'MLS'));
t('Inter Miami league game goes to MLS too', () => assert.equal(leagueForApiFixture(fx(MLS, 'Inter Miami', 'Chicago Fire')), 'MLS'));
t('Inter Miami cup game stays in its own section', () => assert.equal(leagueForApiFixture(fx({ name: 'Leagues Cup', country: 'World' }, 'Inter Miami', 'Club America')), 'INTERMIAMI'));
t('MLS is a calendar-year league of 30 clubs', () => { assert.equal(LEAGUES.MLS.calendarSeason, true); assert.equal(LEAGUES.MLS.teams, 30); assert.equal(seasonLabel(LEAGUES.MLS, 2026), '2026'); });
t('MLS id has no date, cup id has', () => {
  assert.equal(matchId(LEAGUES.MLS, 2026, '2026-03-21', 'Austin', 'Seattle Sounders'), 'MLS|2026|austin|seattle sounders');
  assert.ok(matchId(LEAGUES.INTERMIAMI, 2026, '2026-08-01', 'Inter Miami', 'Club America').includes('2026-08-01'));
});
t('parseApiFootball names the MLS comp "Major League Soccer"', () => {
  const r = parseApiFootball({ response: [fx(MLS, 'Inter Miami', 'Chicago Fire')] }, {});
  assert.equal(r.rows[0].league, 'MLS'); assert.equal(r.rows[0].comp_name, 'Major League Soccer');
});
console.log('mls tests:', n, 'passed');
