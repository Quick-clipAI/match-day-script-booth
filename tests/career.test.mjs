// node tests/career.test.mjs
import assert from 'node:assert/strict';
process.env.BANK_STORE = 'memory'; process.env.ADMIN_KEY = 'k';
import { normalizeProfile, mergeProfile } from '../lib/bank-career.js';
import handler from '../api/admin.js';
let n = 0; const ok = (name, fn) => { fn(); n++; };
const T = { today: '2026-10-19' };

ok('partial profile is fine: only awards', () => { const r = normalizeProfile({ name: 'A B', dob: '2000-01-02', awards: ['Golden Boot'], source: 's' }, T); assert.equal(r.problems.length, 0); assert.equal(r.profile.awards[0].name, 'Golden Boot'); });
ok('stats without as_of are rejected', () => { const r = normalizeProfile({ name: 'A', totals: { goals: 3 } }, T); assert.ok(r.problems.some(p => /as_of is required/.test(p))); });
ok('future as_of rejected', () => { assert.ok(normalizeProfile({ name: 'A', as_of: '2027-01-01', totals: { goals: 1 } }, T).problems.length); });
ok('non-numbers rejected, "80m" rejected', () => { assert.ok(normalizeProfile({ name: 'A', as_of: '2026-10-01', totals: { goals: 'lots' } }, T).problems.length); assert.ok(normalizeProfile({ name: 'A', market_value: { amount: '80m', date: '2026-06-01' } }, T).problems.length); });
ok('successful > attempted rejected', () => { assert.ok(normalizeProfile({ name: 'A', as_of: '2026-10-01', totals: { dribbles_attempted: 10, dribbles_successful: 12 } }, T).problems.length); });
ok('seasons above career total rejected; flat season stats accepted', () => {
  const bad = normalizeProfile({ name: 'A', as_of: '2026-10-01', totals: { goals: 5 }, seasons: [{ season: 2024, club: 'X', goals: 4 }, { season: 2025, club: 'X', goals: 3 }] }, T); assert.ok(bad.problems.some(p => /more than the career total/.test(p)));
  const good = normalizeProfile({ name: 'A', as_of: '2026-10-01', totals: { goals: 9 }, seasons: [{ season: 2024, club: 'X', goals: 4, assists: 2 }] }, T); assert.equal(good.problems.length, 0); assert.equal(good.profile.seasons[0].stats.assists, 2);
});
ok('typo stat is kept but warned', () => { const r = normalizeProfile({ name: 'A', as_of: '2026-10-01', totals: { assits: 3 } }, T); assert.equal(r.problems.length, 0); assert.ok(r.warnings.some(w => /assits/.test(w))); });
ok('duplicate season rejected', () => { assert.ok(normalizeProfile({ name: 'A', as_of: '2026-10-01', seasons: [{ season: 2024, club: 'X', goals: 1 }, { season: 2024, club: 'x', goals: 2 }] }, T).problems.length); });
ok('merge keeps untouched data and reports overwrites', () => {
  const a = normalizeProfile({ name: 'A', dob: '2000-01-01', as_of: '2026-09-01', totals: { goals: 10, assists: 4 }, awards: ['X'], source: 's' }, T).profile;
  const b = normalizeProfile({ name: 'A', dob: '2000-01-01', as_of: '2026-10-01', totals: { goals: 12 }, transfers: [{ date: '2020-07-01', from: 'P', to: 'Q', fee: 5000000 }] }, T).profile;
  const m = mergeProfile(a, b); assert.equal(m.merged.totals.goals, 12); assert.equal(m.merged.totals.assists, 4); assert.equal(m.merged.awards.length, 1); assert.equal(m.merged.transfers.length, 1); assert.equal(m.merged.as_of, '2026-10-01'); assert.deepEqual(m.changes, ['A totals.goals: 10 → 12']);
});
ok('older stats do not overwrite newer', () => {
  const a = normalizeProfile({ name: 'A', as_of: '2026-10-01', totals: { goals: 12 } }, T).profile;
  const b = normalizeProfile({ name: 'A', as_of: '2026-05-01', totals: { goals: 8 }, awards: ['Y'] }, T).profile;
  const m = mergeProfile(a, b); assert.equal(m.merged.totals.goals, 12); assert.equal(m.merged.awards.length, 1); assert.ok(m.notes.length === 1);
});

// ---- handler level
const call = async body => { let out; const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { out = { code: this.c || 200, ...o }; return this; }, end() {} }; await handler({ method: 'POST', headers: { 'x-admin-key': 'k' }, body, query: {} }, res); return out; };
const P = { name: 'Bukayo Saka', dob: '2001-09-05', as_of: '2026-10-14', source: 'test', totals: { goals: 50, assists: 40 }, seasons: [{ season: 2024, club: 'Arsenal', competition: 'EPL', goals: 6, assists: 10, crosses_completed: 33 }], market_values: [{ amount: 120000000, date: '2026-06-01' }], awards: [{ name: 'Young Player', season: 2022 }] };
const run = async () => {
  let r = await call({ action: 'importCareer', data: [P], dryRun: true }); assert.equal(r.code, 200); assert.equal(r.created, 1);
  assert.equal((await call({ action: 'career' })).total, 0, 'preview must not save');
  r = await call({ action: 'importCareer', data: [P], dryRun: false }); assert.equal(r.saved, 1);
  r = await call({ action: 'career' }); assert.equal(r.total, 1); assert.match(r.rows[0].summary, /1 season/);
  r = await call({ action: 'importCareer', data: [{ name: 'Bukayo Saka', as_of: '2026-10-18', totals: { goals: 51 } }], dryRun: false }); assert.equal(r.updated, 1); assert.equal(r.changesTotal, 1);
  r = await call({ action: 'importCareer', data: { profiles: [{ name: 'Bukayo Saka', dob: '2001-09-05', transfers: [{ date: '2019-07', from: 'Arsenal U18', to: 'Arsenal', type: 'promotion' }] }] }, dryRun: false }); assert.equal(r.code, 200);
  r = await call({ action: 'importCareer', data: [{ name: 'X', totals: { goals: 1 } }], dryRun: true }); assert.equal(r.code, 400); assert.ok(r.problems[0].startsWith('Profile 1'));
  // dob arrives later for a profile saved without one: same person, id changes, no duplicate
  await call({ action: 'importCareer', data: [{ name: 'Martin Odegaard', awards: ['Captain'] }], dryRun: false });
  await call({ action: 'importCareer', data: [{ name: 'Martin Ødegaard'.replace('Ø', 'O'), dob: '1998-12-17', awards: ['Another'] }], dryRun: false });
  r = await call({ action: 'career' }); assert.equal(r.rows.filter(x => /odegaard/i.test(x.name)).length, 1);
  assert.equal(r.total, 2);
  r = await call({ action: 'deleteCareer', ids: [r.rows[0].id] }); assert.equal(r.deleted, 1);
  n += 8;
};
await run();
console.log(`career tests passed (${n})`);
