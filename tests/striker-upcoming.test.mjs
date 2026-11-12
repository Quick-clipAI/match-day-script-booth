import assert from 'node:assert/strict';
import { strikerBulk } from '../lib/striker.js';
const env = { STRIKERAPI_KEY: 'k' };
const poster = async (path, key, args) => ({ status: 200, json: { data: { games: args.status === 'scheduled' ? [{ date: '2026-11-25', status: 'scheduled', home: { name: 'Sabah FK' }, away: { name: 'Barcelona' } }] : [] } }, raw: '', headers: { 'x-credits-remaining': '90' } });
const r = await strikerBulk({}, { step: 'upcoming', season: 2026 }, env, poster);
assert.equal(r.matches, 1); assert.deepEqual(r.statuses, ['scheduled']); assert.equal(r.creditsLeft, 90); assert.match(r.sample[0], /Sabah FK v Barcelona/);
const none = await strikerBulk({}, { step: 'upcoming', season: 2026, status: 'x' }, env, poster); assert.equal(none.matches, 0);
console.log('ok');
