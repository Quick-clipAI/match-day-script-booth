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
import { createMemoryStore } from '../lib/bank-store.js';
import { stampKickoffs, syncDue } from '../lib/sync-due.js';
const NOWK = Date.parse('2026-11-07T20:00:00Z');
const mk = (o) => ({ id: 'MLS|2026|inter miami|charlotte', league: 'MLS', comp_name: 'Major League Soccer', season: 2026, round: 'MLS Regular Season', date: '2026-11-07', home: 'Inter Miami', away: 'Charlotte', status: 'scheduled', source: 'paste', ...o });
{
  const s = createMemoryStore(); await s.upsertMatches([mk({})]);
  const getFixtures = async (d) => d === '2026-11-08' ? { response: [{ fixture: { id: 9, date: '2026-11-08T01:00:00+00:00', status: { short: 'NS' } }, league: { name: 'Major League Soccer', country: 'USA' }, teams: { home: { name: 'Inter Miami' }, away: { name: 'Charlotte' } }, goals: {}, score: {} }] } : { response: [] };
  const r = await stampKickoffs(s, { getFixtures, now: NOWK });
  assert.equal(r.calls, 2); assert.equal(r.stamped, 1);
  const m = (await s.listMatches({}))[0];
  assert.equal(m.kickoff.slice(0, 16).replace(' ', 'T'), '2026-11-08T01:00'); assert.equal(m.date, '2026-11-08');
  const r2 = await stampKickoffs(s, { getFixtures, now: NOWK + 3600000 }); assert.equal(r2.calls, 0);   // nothing left to stamp
  // due exactly 110 minutes after the stamped kick-off, not at 22:30 of the old date
  const early = await syncDue(s, { getFixtures: async () => assert.fail('too early'), now: Date.parse('2026-11-08T02:30:00Z') }); assert.equal(early.ran, false);
  n++;
}
console.log('stamp test ok');
import { mergeTeams } from '../lib/bank-sync.js';
{
  const s = createMemoryStore();
  await s.upsertAliases([{ alias: 'rb leipzig', canonical: 'Leipzig' }]);   // the old wrong reverse rule
  await s.upsertMatches([{ id: 'BUNDESLIGA|2026|leipzig|bayern munchen', league: 'BUNDESLIGA', comp_name: 'Bundesliga', season: 2026, round: 'Matchday 1', date: '2026-08-29', home: 'Leipzig', away: 'Bayern München', status: 'scheduled', source: 'openfootball' }]);
  await mergeTeams(s, { league: 'BUNDESLIGA', from: 'Leipzig', to: 'RB Leipzig' });
  const al = new Map((await s.listAliases()).map(a => [a.alias, a.canonical]));
  assert.equal(al.get('rb leipzig'), 'RB Leipzig'); assert.equal(al.get('leipzig'), 'RB Leipzig');
}
console.log('alias test ok');
