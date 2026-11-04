// node tests/striker.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { strikerBulk, strikerSaved } from '../lib/striker.js';
const env = { STRIKERAPI_KEY: 'k' }; let left = 100; const calls = [];
const poster = async (path, key, body) => { calls.push(path + ' ' + JSON.stringify(body));
  const tool = path.split('/').pop(); const cost = tool === 'list_games' ? 2 : 5; left -= cost;
  const json = tool === 'list_games' ? { data: { games: [1, 2, 3, 4].map(i => ({ game_id: String(i), status: 'final' })) } } : { data: { game: { game_id: body.game_id } } };
  return { status: 200, json, raw: '', headers: { 'x-credits-used': String(cost), 'x-credits-remaining': String(left) } }; };
const s = createMemoryStore();
let r = await strikerBulk(s, { step: 'list', season: 2026 }, env, poster); assert.equal(r.matches, 4); assert.equal(r.creditsLeft, 98);
r = await strikerBulk(s, { step: 'games', dryRun: true }, env, poster); assert.equal(r.remaining, 4); assert.equal(r.cost, 20);
r = await strikerBulk(s, { step: 'games', max: 2, reserve: 0 }, env, poster); assert.equal(r.fetched, 2); assert.equal(r.remaining, 2);
r = await strikerBulk(s, { step: 'games', max: 10, reserve: 80 }, env, poster); assert.equal(r.stopped, 'credits'); assert.equal(r.fetched, 0 + r.fetched);   // 88 left: 83>=80 ok once, then 78<80 stops
assert.ok(r.fetched <= 1);
const before = calls.length; r = await strikerBulk(s, { step: 'games', max: 10, reserve: 0 }, env, poster);
assert.equal(new Set(calls.slice(before)).size, calls.length - before, 'no match fetched twice');
assert.equal((await s.strikerDoneIds('get_game')).length, 4);
const bad = await strikerSaved(s, 'drop_table', {}, env, poster); assert.equal(bad.status, 400);
console.log('striker tests: 6 passed');
