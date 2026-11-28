import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { fdFillResults } from '../lib/fd-results.js';
import { computeCoachFlags } from '../lib/coach-flags.js';
const s = createMemoryStore();
const M = (id, home, away, date, extra = {}) => ({ id, league: 'UCL', season: 2026, home, away, date, status: 'scheduled', hg: null, ag: null, ...extra });
await s.upsertMatches([M('a', 'Atletico Madrid', 'Viking', '2026-11-25'), M('b', 'Real Madrid', 'Olympiacos', '2026-11-25'), M('c', 'Arsenal', 'Bayern Munich', '2026-11-25'), M('d', 'Inter', 'Napoli', '2026-11-27')]);
const fx = (h, a, hg, ag, dur = 'REGULAR', st = 'FINISHED') => ({ status: st, utcDate: '2026-11-25T20:00:00Z', homeTeam: { name: h, shortName: h }, awayTeam: { name: a, shortName: a }, score: { duration: dur, fullTime: { home: hg, away: ag }, halfTime: { home: 0, away: 1 } } });
let asked = 0;
const get = async path => { asked++; assert.match(path, /competitions\/CL\/matches\?dateFrom=2026-11-24&dateTo=2026-11-29/); return { status: 200, json: { matches: [fx('Club Atlético de Madrid', 'FK Viking', 3, 1), fx('Real Madrid CF', 'Olympiacos FC', 2, 2, 'PENALTY_SHOOTOUT'), fx('Arsenal FC', 'FC Bayern München', 1, 1, 'REGULAR', 'TIMED')] } }; };
const r = await fdFillResults(s, { key: 'k', today: '2026-11-28', get, force: true });
assert.equal(r.filled, 1); assert.equal(asked, 1);
const ms = await s.listMatches({ league: 'UCL' }); const a = ms.find(m => m.id === 'a');
assert.deepEqual([a.hg, a.ag, a.status], [3, 1, 'finished']);
assert.equal(ms.find(m => m.id === 'b').hg, null, 'shoot-outs are left for a person');
assert.equal(ms.find(m => m.id === 'c').hg, null, 'not finished stays open');
assert.equal(ms.find(m => m.id === 'd').hg, null, 'today/future is not a gap');
// an existing score is never changed
await s.upsertMatches([M('e', 'Atletico Madrid', 'Viking', '2026-11-24', { hg: 0, ag: 0, status: 'finished' })]);
assert.equal((await fdFillResults(s, { key: 'k', today: '2026-11-28', get, force: true })).filled, 0);

// outgoing coach: a line-up that still names a coach who left up to 3 days ago is history, not a mismatch
const co = [{ id: 'MLS|2026|d.c. united', league: 'MLS', season: 2026, club: 'D.C. United', name: 'Óscar Pareja', locked: true }, { id: 'SPL|2026|abha', league: 'SPL', season: 2026, club: 'Abha', name: 'Teo Pirija' }];
const lu = [{ id: 'l1', league: 'MLS', club: 'D.C. United', date: '2026-11-07', coach: 'R. Weiler' }, { id: 'l2', league: 'SPL', club: 'Abha', date: '2026-10-30', coach: 'D. Burić' }];
assert.equal(computeCoachFlags(co, lu).length, 2);
const spells = [{ league: 'MLS', club: 'D.C. United', name: 'René Weiler', ended_on: '2026-11-14' }, { league: 'SPL', club: 'Abha', name: 'Damir Burić', ended_on: '2026-10-28' }];
assert.equal(computeCoachFlags(co, lu, { spells }).length, 0);
assert.equal(computeCoachFlags(co, [{ ...lu[1], date: '2026-11-05' }], { spells }).length, 1, 'a line-up well after he left is still a mismatch');
console.log('fd-results tests ok');
