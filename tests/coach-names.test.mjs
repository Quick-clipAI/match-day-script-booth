// node tests/coach-names.test.mjs  — one spelling per club and per coach
import assert from 'node:assert/strict';
import { strictSameClub } from '../lib/bank-profiles.js';
import { sameCoach, variantCoach, computeCoachFlags, computeCoachVariants, compareCoachList } from '../lib/coach-flags.js';
import { canonClub, canonName, canonCoachRow, nameMapOf, fullestName } from '../lib/coach-canon.js';
import { healPreview, healApply } from '../lib/heal-names.js';
import { createMemoryStore } from '../lib/bank-store.js';

// 1. Barcelona is NOT part of Espanyol de Barcelona
const pool = ['Barcelona', 'RCD Espanyol de Barcelona', 'Atletico Madrid', 'Celta Vigo'];
assert.equal(strictSameClub('Barcelona', 'RCD Espanyol de Barcelona', pool), false);
assert.equal(strictSameClub('RCD Espanyol de Barcelona', 'Barcelona', pool), false);
assert.equal(strictSameClub('Barcelona', 'Barcelona', pool), true);
assert.equal(strictSameClub('Espanyol', 'RCD Espanyol de Barcelona', pool, new Map([['espanyol', 'RCD Espanyol de Barcelona']])), true);
assert.equal(strictSameClub('Celta', 'Celta Vigo', pool), true);          // a short form of a club that is not itself stored still matches
assert.equal(strictSameClub('Celta', 'Celta Vigo', [...pool, 'Celta']), false);

const C = o => ({ id: `${o.league}|2026|${o.club.toLowerCase()}`, season: 2026, as_of: '2026-11-12', locked: false, ...o });
const coaches = [C({ league: 'LALIGA', club: 'Barcelona', name: 'H. Flick' }), C({ league: 'LALIGA', club: 'RCD Espanyol de Barcelona', name: 'Manolo González' })];
const L = (club, date, coach) => ({ id: club + date, league: 'LALIGA', club, date, coach });
const lineups = [L('Barcelona', '2026-11-22', 'Hansi Flick'), L('RCD Espanyol de Barcelona', '2026-11-20', 'Eder Sarabia')];
const flags = computeCoachFlags(coaches, lineups);
assert.deepEqual(flags.map(f => f.club), ['RCD Espanyol de Barcelona']);
assert.equal(flags[0].lineup_coach, 'Eder Sarabia');                      // never Flick

// 2. spellings of one coach
assert.equal(variantCoach('M. Mićović', 'Marko Mitrović'), true);
assert.equal(variantCoach('Diego Simeone', 'Diego Martinez'), false);   // a shared first name alone is nothing
assert.equal(variantCoach('Arne Slot', 'Andoni Iraola'), false);
assert.equal(variantCoach('Hansi Flick', 'H. Flick'), false);             // that is already the same coach
const nm = nameMapOf([{ alias: 'm micovic', canonical: 'Marko Mitrović' }, { alias: 'marko mitrovic', canonical: 'Marko Mitrović' }]);
assert.equal(sameCoach('M. Mićović', 'Marko Mitrović', nm), true);
assert.equal(canonName('M. Mićović', nm), 'Marko Mitrović');
assert.equal(fullestName(['M. Mićović', 'Marko Mitrović']), 'Marko Mitrović');
const ne = [C({ league: 'MLS', club: 'New England Revolution', name: 'M. Mićović' })];
const neL = [{ id: 'a', league: 'MLS', club: 'New England Revolution', date: '2026-11-07', coach: 'M. Mićović' }, { id: 'b', league: 'MLS', club: 'New England Revolution', date: '2026-11-02', coach: 'Marko Mitrović' }];
assert.equal(computeCoachFlags(ne, neL).length, 0);                       // a spelling difference is not a different coach
const v = computeCoachVariants(ne, neL);
assert.equal(v.length, 1); assert.equal(v[0].suggested, 'Marko Mitrović'); assert.deepEqual(v[0].names.sort(), ['M. Mićović', 'Marko Mitrović']);
assert.equal(computeCoachVariants(ne, neL, { nameMap: nm }).length, 0);   // once merged it is quiet
const cmp = compareCoachList(ne, [{ club: 'New England Revolution', coach: 'Marko Mitrović' }]);
assert.equal(cmp.rows[0].status, 'variant'); assert.equal(cmp.variants, 1); assert.equal(cmp.different, 0);

// 3. canonical writing
const am = new Map([['leipzig', 'RB Leipzig']]);
assert.equal(canonClub('Leipzig', am), 'RB Leipzig');
const row = canonCoachRow({ id: 'BUNDESLIGA|2026|leipzig', league: 'BUNDESLIGA', season: 2026, club: 'Leipzig', name: 'M. Mićović' }, am, nm);
assert.equal(row.id, 'BUNDESLIGA|2026|rb leipzig'); assert.equal(row.club, 'RB Leipzig'); assert.equal(row.name, 'Marko Mitrović');

// 4. the store never makes a second row for an aliased club, and a merged spelling is written in canonical form
{
  const s = createMemoryStore();
  await s.upsertAliases([{ alias: 'leipzig', canonical: 'RB Leipzig' }]);
  await s.upsertCoachNames([{ alias: 'm demichelis', canonical: 'Martín Demichelis' }]);
  await s.upsertCoaches([C({ league: 'BUNDESLIGA', club: 'RB Leipzig', name: 'M. Demichelis', api_id: 5345 })]);
  await s.upsertCoaches([C({ league: 'BUNDESLIGA', club: 'Leipzig', name: 'M. Demichelis' })]);
  const all = await s.listCoaches();
  assert.equal(all.length, 1); assert.equal(all[0].club, 'RB Leipzig'); assert.equal(all[0].name, 'Martín Demichelis');
}

// 5. heal: a club merged in one league but still split in another, and two coach rows
{
  const s = createMemoryStore();
  await s.upsertAliases([{ alias: 'leipzig', canonical: 'RB Leipzig' }, { alias: 'rb leipzig', canonical: 'RB Leipzig' }]);
  const M = (id, home, away, date, status = 'finished') => ({ id, league: 'UCL', comp_name: 'Champions League', season: 2026, round: 'League stage', date, home, away, status, hg: status === 'finished' ? 1 : null, ag: status === 'finished' ? 0 : null, source: 'manual' });
  await s.upsertMatches([M('UCL|2026|2026-11-04|leipzig|manchester city', 'Leipzig', 'Manchester City', '2026-11-04'), M('UCL|2026|2026-11-04|rb leipzig|manchester city', 'RB Leipzig', 'Manchester City', '2026-11-04'), M('UCL|2026|2026-10-13|leipzig|psv eindhoven', 'Leipzig', 'PSV Eindhoven', '2026-10-13')]);
  // two coach rows written before the rule existed (memory store canonicalises on write, so put the old one in directly)
  await s.upsertCoaches([C({ league: 'BUNDESLIGA', club: 'RB Leipzig', name: 'M. Demichelis', api_id: 5345 })]);
  const p = await healPreview(s);
  assert.equal(p.splits.length, 1); assert.equal(p.splits[0].from, 'Leipzig'); assert.equal(p.splits[0].to, 'RB Leipzig'); assert.equal(p.splits[0].league, 'UCL');
  const r = await healApply(s);
  assert.equal(r.splits, 1);
  const ms = await s.listMatches({ league: 'UCL' });
  assert.equal(ms.length, 2); assert.ok(ms.every(m => !/^Leipzig$/.test(m.home) && !/^Leipzig$/.test(m.away)));      // the duplicate Man City match is gone, nothing is called "Leipzig"
  assert.equal((await healPreview(s)).splits.length, 0);
}
// 6. nicknames are variants, not different coaches
assert.equal(variantCoach('José Bordalás', 'Pepe Bordalás'), true);
assert.equal(variantCoach('Cristian González', 'Kily González'), true);
assert.equal(variantCoach('Michael Carrick', 'Michael Owen'), false);
assert.equal(computeCoachFlags([C({ league: 'LALIGA', club: 'Getafe', name: 'José Bordalás' })], [L('Getafe', '2026-11-22', 'Pepe Bordalás')].map(l => ({ ...l }))).length, 0);

// 7. a replaced coach is kept in the history, not erased
import { noteCoachChange } from '../lib/coach-history.js';
{
  const s = createMemoryStore();
  await noteCoachChange(s, { league: 'LALIGA', club: 'RCD Espanyol de Barcelona', oldName: 'Manolo González', newName: 'Eder Sarabia', today: '2026-11-24' });
  const sp = await s.listCoachSpells({ club: 'RCD Espanyol de Barcelona' });
  assert.equal(sp.find(x => x.name === 'Manolo González').ended_on, '2026-11-24');
  assert.equal(sp.find(x => x.name === 'Eder Sarabia').ended_on, null);
}
console.log('coach-names tests ok');
