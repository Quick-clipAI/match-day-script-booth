import assert from 'node:assert/strict';
import { importUpcoming } from '../lib/striker-upcoming.js';
const have = [{ id: 'x', league: 'UCL', season: 2026, date: '2026-10-01', home: 'Barcelona', away: 'Club Brugge', status: 'finished', hg: 1, ag: 0 }, { id: 'y', league: 'UCL', season: 2026, date: '2026-10-02', home: 'Bodo/Glimt', away: 'Arsenal', status: 'finished', hg: 1, ag: 1 }, { id: 'z', league: 'UCL', season: 2026, date: '2026-11-25', home: 'Arsenal', away: 'Barcelona', status: 'scheduled' }];
let saved = [];
const store = { listMatches: async () => have, listAliases: async () => [], upsertMatches: async r => { saved = r; }, addLog: async () => {} };
const games = [
  { date: '2026-11-25', status: 'scheduled', home: { name: 'Club Brugge' }, away: { name: 'Bodo/Glimt' } },
  { date: '2026-11-26', status: 'scheduled', home: { name: 'Arsenal' }, away: { name: 'Barcelona' } },
  { date: '2026-11-26', status: 'scheduled', home: { name: 'Nobody FC' }, away: { name: 'Arsenal' } }];
const r = await importUpcoming(store, games, {});
assert.equal(r.added, 1); assert.equal(r.already, 1); assert.deepEqual(r.unknownClubs, ['Nobody FC']);
assert.equal(saved[0].status, 'scheduled'); assert.equal(saved[0].home, 'Club Brugge'); assert.equal(saved[0].hg, null);
console.log('ok');
