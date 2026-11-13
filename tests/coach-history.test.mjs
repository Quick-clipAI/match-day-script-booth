import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { noteCoachChange, coachView } from '../lib/coach-history.js';
const store = createMemoryStore ? createMemoryStore() : null;
assert.ok(store, 'memory store');
const r1 = await noteCoachChange(store, { league: 'EPL', club: 'Man X', oldName: 'Old Boss', newName: 'New Boss', newApi: 9, today: '2026-11-20' });
assert.equal(r1.closed, 'Old Boss'); assert.equal(r1.opened, 'New Boss');
const sp = await store.listCoachSpells({ club: 'Man X' });
assert.equal(sp.find(s => s.name === 'Old Boss').ended_on, '2026-11-20'); assert.match(sp.find(s => s.name === 'Old Boss').end_reason, /not recorded/);
assert.equal(sp.find(s => s.name === 'New Boss').ended_on, null);
assert.equal(await noteCoachChange(store, { league: 'EPL', club: 'Man X', oldName: 'New Boss', newName: 'new boss', today: '2026-11-21' }), null, 'same name = nothing');
// a manually set reason survives
await store.upsertCoachSpells([{ id: 'EPL|man x|old boss', league: 'EPL', club: 'Man X', name: 'Old Boss', ended_on: '2026-11-19', end_reason: 'Sacked', source: 'admin' }]);
// the sacked coach is still the stored coach: the screen shows he left, with the reason
const v = coachView([{ id: 'a', name: 'Carrick', ended_on: '2026-11-12', end_reason: 'Sacked' }, { id: 'b', name: 'Amorim', ended_on: '2026-01-05', end_reason: 'Sacked' }], { name: 'Carrick' });
assert.equal(v.left.date, '2026-11-12'); assert.equal(v.left.reason, 'Sacked'); assert.deepEqual(v.previous.map(p => p.name), ['Amorim']);
// a new coach is in charge: earlier ones are listed
const w = coachView([{ id: 'a', name: 'Carrick', ended_on: '2026-11-12' }, { id: 'c', name: 'Poch', ended_on: null }], { name: 'Poch' });
assert.equal(w.left, null); assert.deepEqual(w.previous.map(p => p.name), ['Carrick']);
console.log('ok');
{ const v = coachView([{ id: 'a', name: 'Xabi', started_on: '2026-11-18', ended_on: null, prev_team: 'Chelsea', origin: 'club' }], { name: 'Xabi' }); assert.deepEqual(v.joined, { date: '2026-11-18', from: 'Chelsea', origin: 'club' }); console.log('ok joined'); }
