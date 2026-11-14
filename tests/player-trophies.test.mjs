import assert from 'node:assert/strict';
import { stintsFromMoves, playerTrophies, movesFromApi } from '../lib/player-trophies.js';
import { createMemoryStore } from '../lib/bank-store.js';
import { playerTrophyStatus } from '../lib/player-career.js';
const rows = [
  { competition: 'ESP', season: '2018-19', club: 'Barcelona' }, { competition: 'ESP', season: '2022-23', club: 'Barcelona' },
  { competition: 'UCL', season: '2014-15', club: 'Barcelona' }, { competition: 'FRA', season: '2021-22', club: 'Paris Saint-Germain' },
  { competition: 'FRA', season: '2022-23', club: 'Paris Saint-Germain' }, { competition: 'UCL', season: '2005-06', club: 'Barcelona' }];
const moves = [{ date: '2021-08-10', type: 'Free', in: { id: 85, name: 'Paris Saint Germain' }, out: { id: 529, name: 'Barcelona' } },
  { date: '2023-07-15', type: 'Free', in: { id: 2, name: 'Inter Miami' }, out: { id: 85, name: 'Paris Saint Germain' } }];
const st = stintsFromMoves(moves);
assert.deepEqual(st.map(s => s.club), ['Barcelona', 'Paris Saint Germain', 'Inter Miami']);
const r = playerTrophies(moves, rows);
const bar = r.clubs.find(c => c.club === 'Barcelona'); assert.equal(bar.trophies.find(t => t.key === 'ESP').count, 1); assert.equal(bar.trophies.find(t => t.key === 'UCL').count, 2);
const psg = r.clubs.find(c => /Paris/.test(c.club)); assert.equal(psg.trophies.find(t => t.key === 'FRA').count, 2);
assert.equal(r.total, 5);
// left in January: not credited
const jan = playerTrophies([{ date: '2023-01-10', type: 'Transfer', in: { name: 'Chelsea' }, out: { name: 'Barcelona' } }], rows);
assert.equal((jan.clubs.find(c => c.club === 'Barcelona').trophies.find(t => t.key === 'ESP') || {}).count, 1);
assert.equal(movesFromApi({ response: [{ transfers: [{ date: '2021-08-10', type: 'Free', teams: { in: { id: 1, name: 'A' }, out: { id: 2, name: 'B' } } }] }] }).length, 1);
// status: fetch once, then served from the bank; cap respected
const store = createMemoryStore(); await store.upsertClubTrophies(rows.map((x, i) => ({ id: 'k' + i, ...x })));
let n = 0; const getTransfers = async () => { n++; const j = { response: [{ transfers: [{ date: '2021-08-10', type: 'Free', teams: { in: { id: 85, name: 'Paris Saint Germain' }, out: { id: 529, name: 'Barcelona' } } }] }], errors: [] }; Object.defineProperty(j, '__left', { value: 60 }); return j; };
const a = await playerTrophyStatus(store, 154, { getTransfers, name: 'Messi' }); assert.equal(a.status, 'ready'); assert.equal(n, 1);
const b = await playerTrophyStatus(store, 154, { getTransfers, name: 'Messi' }); assert.equal(b.status, 'ready'); assert.equal(n, 1);
const c = await playerTrophyStatus(store, 999, { getTransfers, name: 'X', dailyCap: 1 }); assert.equal(c.status, 'queued'); assert.equal(n, 1);
console.log('player-trophies ok');
