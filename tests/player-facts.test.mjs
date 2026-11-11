// node tests/player-facts.test.mjs  - a player named in the chat gets his stored facts; unclear names get nothing
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { planContext } from '../lib/bank-context.js';
const TODAY = '2026-11-11';
const store = createMemoryStore();
const row = (club, name, extra = {}) => ({ id: `LALIGA|2026|${club.toLowerCase()}|${name.toLowerCase()}`, league: 'LALIGA', season: 2026, club, name, shirt: 11, dob: '1996-12-14', position: 'Forward', nationality: 'Brazil', ...extra });
await store.upsertPlayers([row('Barcelona', 'Raphinha'), row('Barcelona', 'Pau Cubarsí', { dob: '2007-01-22', nationality: 'Spain' }), row('Real Madrid', 'Vinícius Júnior'), row('Sevilla', 'Carlos Silva'), row('Betis', 'Marco Silva')]);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
await t('single-name player gets club, born date and the correct age', async () => {
  const r = await planContext('Give me a player analysis of Raphinha', TODAY, store, {});
  assert.match(r.text, /PLAYER \(data bank\): Raphinha — Barcelona/);
  assert.match(r.text, /born 1996-12-14 \(age 29 today\)/);
  assert.match(r.text, /no height, preferred foot/);
});
await t('surname alone finds a unique full-name player', async () => {
  const r = await planContext('how good is cubarsí really', TODAY, store, {});
  assert.match(r.text, /Pau Cubarsí — Barcelona/); assert.match(r.text, /age 19 today/);
});
await t('a surname shared by two players adds nothing (no guess)', async () => {
  const r = await planContext('is silva any good', TODAY, store, {});
  assert.equal(r.text, '');
});
await t('a question without a player adds nothing', async () => {
  const r = await planContext('what is the weather like', TODAY, store, {});
  assert.equal(r.text, '');
});
console.log(n + ' passed');
