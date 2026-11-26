// node tests/quick-search.test.mjs  — the in-app search box answers from the data bank only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../lib/bank-store.js';
import { importText } from '../lib/bank-sync.js';
import { normalizeSquad } from '../lib/bank-squad.js';
import { quickSearch } from '../lib/quick-search.js';
const TODAY = '2026-10-16';
const dir = new URL('./testdata/', import.meta.url);
const store = createMemoryStore();
for (const f of ['epl-2025-26.json', 'epl-2026-27.json']) await importText(store, { text: fs.readFileSync(new URL(f, dir), 'utf8'), dryRun: false, today: TODAY });
const a = normalizeSquad({ league: 'EPL', season: 2026, club: 'Arsenal', as_of: '2026-10-15', coach: { name: 'Mikel Arteta', nationality: 'Spain' }, players: [{ name: 'Bukayo Saka', shirt: 7, position: 'Forward' }, { name: 'Sakai Test', shirt: 9, position: 'Forward' }] }, 0, { today: '2026-10-19' });
await store.upsertPlayers(a.rows); await store.upsertCoaches([a.coach]);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };

await t('too short: nothing', async () => { const r = await quickSearch('a', TODAY, store, {}); assert.deepEqual([r.clubs, r.players, r.answer], [[], [], []]); });
await t('a club name finds the club and its short answer lines', async () => {
  const r = await quickSearch('Arsenal', TODAY, store, {});
  assert.equal(r.clubs[0].club, 'Arsenal');
  const lines = (r.answer.find(x => x.club === 'Arsenal') || { items: [] }).items.join('\n');
  assert.match(lines, /head coach: Mikel Arteta/);
  assert.doesNotMatch(lines, /Do not name|data bank, as of/);      // no instructions meant for the AI
});
await t('a part of a name finds the player (typing as you go)', async () => {
  const r = await quickSearch('buk', TODAY, store, {});
  assert.equal(r.players[0].name, 'Bukayo Saka'); assert.equal(r.players[0].club, 'Arsenal'); assert.ok(r.players[0].key.includes('saka'));
  const two = await quickSearch('sak', TODAY, store, {}); assert.equal(two.players.length, 2);
});
await t('a coach is found and points to his club', async () => {
  const r = await quickSearch('arteta', TODAY, store, {});
  assert.deepEqual(r.coaches.map(c => [c.name, c.club]), [['Mikel Arteta', 'Arsenal']]);
});
await t('a question about a competition returns its card', async () => {
  const r = await quickSearch('premier league table', TODAY, store, {});
  assert.ok(r.cards.some(c => c.type === 'competition' && c.league === 'EPL'));
});
await t('an unknown word finds nothing and never throws', async () => {
  const r = await quickSearch('zzzqqq', TODAY, store, {});
  assert.deepEqual([r.clubs.length, r.players.length, r.coaches.length, r.answer.length], [0, 0, 0, 0]);
});
console.log(n + ' quick-search tests ok');
