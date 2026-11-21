// node tests/context.test.mjs   - coaches, squads and season form reach the chat's data block
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../lib/bank-store.js';
import { importText } from '../lib/bank-sync.js';
import { normalizeSquad } from '../lib/bank-squad.js';
import { planContext, matchFactsLine } from '../lib/bank-context.js';
const TODAY = '2026-10-16';
const dir = new URL('./testdata/', import.meta.url);
const store = createMemoryStore();
for (const f of ['epl-2025-26.json', 'epl-2026-27.json']) await importText(store, { text: fs.readFileSync(new URL(f, dir), 'utf8'), dryRun: false, today: TODAY });
const sq = (club, coach, players) => normalizeSquad({ league: 'EPL', season: 2026, club, as_of: '2026-10-15', coach, players }, 0, { today: '2026-10-19' });
const a = sq('Arsenal', { name: 'Mikel Arteta', nationality: 'Spain' }, [{ name: 'Bukayo Saka', shirt: 7, position: 'Forward' }, { name: 'David Raya', shirt: 1, position: 'Goalkeeper' }, { name: 'Loan Guy', shirt: 40, position: 'Midfielder', club_status: 'On Loan (from Y)' }]);
const c = sq('Chelsea', null, [{ name: 'Some Player', shirt: 10, position: 'Midfielder' }]);
await store.upsertPlayers([...a.rows, ...c.rows]); await store.upsertCoaches([a.coach]);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };

await t('coach on file is stated and flagged as authoritative', async () => {
  const r = await planContext('Write a script about Arsenal and Chelsea today\'s match', TODAY, store, {});
  assert.match(r.text, /Arsenal head coach \(data bank, as of 2026-10-15\): Mikel Arteta \(Spain\)\. Do not name any other head coach/);
  assert.deepEqual(r.coaches.map(x => x.club), ['Arsenal']);
});
await t('a club with no coach on file is flagged, never guessed', async () => {
  const r = await planContext('Write a script about Arsenal and Chelsea today\'s match', TODAY, store, {});
  assert.match(r.text, /Chelsea head coach: NOT IN THE DATA BANK\. Do not name a head coach from memory/);
  assert.deepEqual(r.coachMissing, ['Chelsea']);
});
await t('squad lists players with shirts and loans', async () => {
  const r = await planContext('Tell me about Arsenal', TODAY, store, {});
  assert.match(r.text, /Arsenal registered squad/); assert.match(r.text, /Bukayo Saka #7/); assert.match(r.text, /Loan Guy #40 \(on loan from Y\)/);
});
await t('season form and title seasons from stored results', async () => {
  const r = await planContext('Arsenal and Chelsea match today', TODAY, store, {});
  assert.match(r.text, /Arsenal form in the stored matches this season/);
  assert.match(r.text, /Arsenal Premier League finishes in completed stored seasons.*2025\/26: 1.*Champions in: 2025\/26/);
});
await t('a pure table question is not buried in squads', async () => {
  const r = await planContext('Premier League table', TODAY, store, {});
  assert.doesNotMatch(r.text, /registered squad/);
});
await t('two clubs: one fixture card (their next meeting, else the latest)', async () => {
  const r = await planContext('Arsenal v Chelsea', TODAY, store, {});
  assert.equal(r.cards.length, 1);
  const c = r.cards[0]; assert.ok([c.home, c.away].includes('Arsenal') && [c.home, c.away].includes('Chelsea'));
  assert.ok(['finished', 'scheduled'].includes(c.status)); assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/); assert.equal(c.competition, 'Premier League');
  if (c.status === 'scheduled') { assert.equal(c.hg, null); assert.ok(c.date >= TODAY); }
});
await t('one club: a card for its own match', async () => {
  const r = await planContext('Tell me about Arsenal', TODAY, store, {});
  assert.equal(r.cards.length, 1); assert.ok([r.cards[0].home, r.cards[0].away].includes('Arsenal'));
});
await t('no club named: no card', async () => { const r = await planContext('who won the premier league', TODAY, store, {}); assert.deepEqual(r.cards || [], []); });
await t('matchFactsLine gives goals, assists, cards, starting players and never a coach', () => {
  const m = { home: 'Man City', away: 'Fulham', hg: 1, ag: 1, date: '2026-11-21' };
  const d = { source: 'api-football', events: [{ m: 16, x: 0, side: 'away', type: 'goal', player: 'R. Muniz', other: 'O. Bobb', detail: 'Normal Goal' }, { m: 57, x: 0, side: 'home', type: 'goal', player: 'E. Anderson', other: '', detail: 'Normal Goal' }, { m: 7, x: 0, side: 'away', type: 'card', player: 'A. Iwobi', detail: 'Yellow Card' }], lineups: { home: { formation: '4-3-3', coach: 'Pep Guardiola', xi: [{ name: 'Donnarumma' }] }, away: { formation: '4-2-3-1', xi: [{ name: 'Leno' }] } } };
  const f = matchFactsLine(m, d);
  assert.match(f, /R\. Muniz \(Fulham, 16', assist O\. Bobb\)/); assert.match(f, /E\. Anderson \(Man City, 57'\)/); assert.match(f, /A\. Iwobi \(Fulham, 7', yellow\)/); assert.match(f, /Man City \(4-3-3\): Donnarumma/);
  assert.doesNotMatch(f, /Guardiola/); assert.match(f, /NOT in this data/);
  assert.equal(matchFactsLine(m, null), null); assert.equal(matchFactsLine(m, { unavailable: true }), null);
});
await t('a locked coach is not changed by the automatic checks, an explicit locked write is', async () => {
  const s2 = createMemoryStore();
  await s2.upsertCoaches([{ id: 'EPL|2026|x', league: 'EPL', season: 2026, club: 'X', name: 'Right Coach', locked: true }]);
  await s2.upsertCoaches([{ id: 'EPL|2026|x', league: 'EPL', season: 2026, club: 'X', name: 'Stale Coach' }]);
  assert.equal((await s2.listCoaches({ league: 'EPL' }))[0].name, 'Right Coach');
  await s2.upsertCoaches([{ id: 'EPL|2026|x', league: 'EPL', season: 2026, club: 'X', name: 'Newer Coach', locked: true }]);
  assert.equal((await s2.listCoaches({ league: 'EPL' }))[0].name, 'Newer Coach');
});
await t('a match finished in the last 3 days: its card is the finished match and its saved goals reach the AI', async () => {
  const fin = (await store.listMatches({ league: 'EPL', season: 2026 })).filter(m => m.status === 'finished' && (m.home === 'Arsenal' || m.away === 'Arsenal')).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  await store.addDetailStubs([{ match_id: fin.id, api_fixture_id: 1 }]);
  await store.saveDetail(fin.id, { events: [{ m: 10, x: 0, side: 'home', type: 'goal', player: 'Test Scorer', other: '', detail: 'Normal Goal' }] });
  const day = new Date(Date.parse(fin.date) + 864e5).toISOString().slice(0, 10);
  const r = await planContext('analyze Arsenal match', day, store, {});
  assert.equal(r.cards[0].id, fin.id); assert.match(r.text, /LAST MATCH \(Arsenal\).*Test Scorer/);
  const old = await planContext('analyze Arsenal match', new Date(Date.parse(fin.date) + 10 * 864e5).toISOString().slice(0, 10), store, {});
  assert.doesNotMatch(old.text, /LAST MATCH \(Arsenal\)/);
});
console.log(n + ' context tests passed');
