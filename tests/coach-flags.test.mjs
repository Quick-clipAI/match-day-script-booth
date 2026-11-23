// node tests/coach-flags.test.mjs
import assert from 'node:assert/strict';
import { sameCoach, computeCoachFlags, compareCoachList } from '../lib/coach-flags.js';
import { createMemoryStore } from '../lib/bank-store.js';

// names written differently are the same person
for (const [a, b] of [['A. Hütter', 'Adolf Hütter'], ['Adi Hutter', 'Adolf Hütter'], ['A. Slot', 'Arne Slot'], ['Slot', 'Arne Slot'], ['H. Flick', 'Hansi Flick'], ['M. Carrick', 'Michael Carrick'], ['S. Hoeness', 'Sebastian Hoeneß'], ['Guardiola', 'Pep Guardiola']]) assert.equal(sameCoach(a, b), true, a + ' = ' + b);
// different people stay different, even with a shared first initial or a shared first name
for (const [a, b] of [['A. Slot', 'Andoni Iraola'], ['Enzo Maresca', 'Mauricio Pochettino'], ['M. Carrick', 'M. Pochettino'], ['Michael Carrick', 'Michael Owen'], ['Luis Ramis', 'Arrasate']]) assert.equal(sameCoach(a, b), false, a + ' != ' + b);

const C = (o) => ({ id: o.league + '|2026|' + o.club.toLowerCase(), league: o.league, season: 2026, club: o.club, name: o.name, as_of: '2026-11-12', locked: false, ...o });
const coaches = [C({ league: 'EPL', club: 'Liverpool', name: 'A. Slot' }), C({ league: 'EPL', club: 'Manchester City', name: 'Enzo Maresca', locked: true }), C({ league: 'EPL', club: 'Arsenal', name: 'Mikel Arteta', lineup_ack: 'Someone Else' }), C({ league: 'EPL', club: 'Fulham', name: 'Alvaro Arbeloa' }), C({ league: 'EPL', club: 'Old', name: 'Gone', season: 2025 })];
const L = (club, date, coach, id = club + date) => ({ id, league: 'EPL', club, date, coach });
const lineups = [L('Liverpool', '2026-11-22', 'Andoni Iraola'), L('Liverpool', '2026-11-08', 'Andoni Iraola'), L('Liverpool', '2026-11-01', 'Arne Slot'),
  L('Manchester City', '2026-11-21', 'E. Maresca'), L('Arsenal', '2026-11-20', 'Someone Else'), L('Fulham', '2026-11-21', 'Álvaro Arbeloa'), L('Old', '2026-11-01', 'Newer')];
const flags = computeCoachFlags(coaches, lineups);
assert.equal(flags.length, 1); const f = flags[0];
assert.equal(f.club, 'Liverpool'); assert.equal(f.table_coach, 'A. Slot'); assert.equal(f.lineup_coach, 'Andoni Iraola'); assert.equal(f.lineups_agree, 2); assert.equal(f.lineups_checked, 3);
// once reviewed ("keep ours" remembers the line-up name) the flag is gone; a different new name flags again
assert.equal(computeCoachFlags([{ ...coaches[0], lineup_ack: 'A. Iraola' }, ...coaches.slice(1)], lineups).length, 0);
assert.equal(computeCoachFlags([{ ...coaches[0], lineup_ack: 'Nobody Else' }, ...coaches.slice(1)], lineups).length, 1);

// comparing with a list from another source
const cmp = compareCoachList(coaches, [{ club: 'Liverpool FC', coach: 'Andoni Iraola', league: 'EPL' }, { club: 'Manchester City', coach: 'Enzo Maresca' }, { club: 'Atlantis', coach: 'X' }, { club: 'Fulham', coach: '' }, { club: 'Arsenal', coach: 'Mikel Arteta' }]);
assert.equal(cmp.same, 2); assert.equal(cmp.different, 1); assert.equal(cmp.rows.find(r => r.status === 'different').club, 'Liverpool');
assert.equal(cmp.rows.find(r => r.status === 'no-club').club, 'Atlantis'); assert.equal(cmp.rows.find(r => r.status === 'no-coach').club, 'Fulham');

// the memory store reads coaches out of saved line-ups
const s = createMemoryStore();
await s.upsertMatches([{ id: 'EPL|2026|liverpool|manchester united', league: 'EPL', season: 2026, home: 'Liverpool', away: 'Manchester United', date: '2026-11-22', status: 'finished', hg: 4, ag: 0 }]);
await s.addDetailStubs([{ match_id: 'EPL|2026|liverpool|manchester united', api_fixture_id: 1 }]);
await s.saveDetail('EPL|2026|liverpool|manchester united', { events: [], lineups: { home: { coach: 'Andoni Iraola', xi: [] }, away: { coach: 'M. Pochettino', xi: [] } } });
const got = await s.lineupCoaches('2026-10-01');
assert.deepEqual(got.map(x => x.club + ':' + x.coach).sort(), ['Liverpool:Andoni Iraola', 'Manchester United:M. Pochettino']);
console.log('coach-flags tests passed');
