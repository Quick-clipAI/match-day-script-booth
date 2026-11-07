// node tests/competition.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { intentTab, buildCompetition, buildStats, hasCompetitionScreen } from '../lib/competition-view.js';
import { planContext } from '../lib/bank-context.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const M = (o) => ({ league: 'UCL', comp_name: 'UEFA Champions League', season: 2026, status: 'finished', source: 't', ...o });
await t('intent picks the tab', () => {
  assert.equal(intentTab("today's champions league matches"), 'fixtures');
  assert.equal(intentTab("what's the current group stage situation?"), 'table');
  assert.equal(intentTab('premier league top scorers'), 'stats');
  assert.equal(intentTab('who is in the round of 16'), 'knockout');
  assert.equal(intentTab('la liga'), 'table');
});
await t('only leagues and the three cups have a screen', () => { assert.ok(hasCompetitionScreen('UCL') && hasCompetitionScreen('MLS')); assert.ok(!hasCompetitionScreen('INTERMIAMI') && !hasCompetitionScreen('WORLD_CUP')); });
await t('buildCompetition: table, fixtures with today focus, stats from saved details', async () => {
  const s = createMemoryStore();
  await s.upsertMatches([
    M({ id: 'UCL|2026|psg|arsenal', round: 'Matchday 1', date: '2026-09-16', home: 'Paris Saint-Germain', away: 'Arsenal', hg: 2, ag: 1 }),
    M({ id: 'UCL|2026|inter|barcelona', round: 'Matchday 1', date: '2026-09-17', home: 'Inter', away: 'Barcelona', hg: 0, ag: 0 }),
    M({ id: 'UCL|2026|arsenal|inter', round: 'Matchday 4', date: '2026-11-03', home: 'Arsenal', away: 'Inter', status: 'scheduled', hg: null, ag: null })
  ]);
  await s.saveManualDetail('UCL|2026|psg|arsenal', { v: 1, events: [{ m: 10, side: 'home', type: 'goal', detail: 'Normal Goal', player: 'Dembele', other: 'Kvara' }, { m: 50, side: 'home', type: 'goal', detail: 'Penalty', player: 'Dembele', other: '' }, { m: 70, side: 'away', type: 'goal', detail: 'Own Goal', player: 'Marquinhos', other: '' }], lineups: {}, stats: [] });
  await s.upsertTeamIds([{ api_team_id: 85, league: 'UCL', club: 'Paris Saint-Germain', api_name: 'Paris Saint Germain', source: 'fixture' }, { api_team_id: 999, league: 'EPL', club: 'Nobody FC', api_name: 'Nobody', source: 'fixture' }]);
  const v = await buildCompetition(s, 'UCL', null, '2026-11-03');
  assert.equal(v.crests['Paris Saint-Germain'], 85, 'crest id for a club in this competition'); assert.equal(v.crests['Nobody FC'], undefined, 'no crest for clubs outside it');
  assert.equal(v.competition.label, '2026/27'); assert.equal(v.focusRound, 'Matchday 4'); assert.deepEqual(v.rounds, ['Matchday 1', 'Matchday 4']);
  assert.equal(v.tabs.map(x => x.key).join(), 'table,fixtures,stats');
  assert.deepEqual(v.stats.players.scorers.map(x => [x.name, x.club, x.goals]), [['Dembele', 'Paris Saint-Germain', 2]]);
  assert.equal(v.stats.players.assists[0].name, 'Kvara'); assert.equal(v.stats.players.matchesWithDetails, 1);
  const psg = v.stats.clubs.find(c => c.team === 'Paris Saint-Germain'); assert.equal(psg.GF, 2); assert.equal(psg.CS, 0);
  assert.equal(v.stats.clubs.find(c => c.team === 'Barcelona').CS, 1);
});
await t('planContext adds the competition card only when no club is named', async () => {
  const s = createMemoryStore();
  await s.upsertMatches([M({ id: 'UCL|2026|psg|arsenal', round: 'Matchday 1', date: '2026-09-16', home: 'Paris Saint-Germain', away: 'Arsenal', hg: 2, ag: 1 })]);
  const a = await planContext("Today's champions league matches", '2026-11-03', s, {});
  assert.equal(a.competition.league, 'UCL'); assert.equal(a.competition.tab, 'fixtures');
  const b = await planContext('Arsenal in the champions league', '2026-11-03', s, {});
  assert.ok(!b.competition);
});
console.log('competition tests:', n, 'passed');
