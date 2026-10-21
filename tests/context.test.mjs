// node tests/context.test.mjs   - coaches, squads and season form reach the chat's data block
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../lib/bank-store.js';
import { importText } from '../lib/bank-sync.js';
import { normalizeSquad } from '../lib/bank-squad.js';
import { planContext } from '../lib/bank-context.js';
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
console.log(n + ' context tests passed');
