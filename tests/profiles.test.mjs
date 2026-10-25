// node tests/profiles.test.mjs
import assert from 'node:assert/strict';
process.env.BANK_STORE = 'memory'; process.env.ADMIN_KEY = 'k';
import { personNorm, sameClub, normalizeProfiles, computeFlags } from '../lib/bank-profiles.js';
import handler from '../api/admin.js';
let n = 0; const ok = (name, fn) => { fn(); n++; };
ok('personNorm drops accents, keeps all words', () => { assert.equal(personNorm('Martin Ødegaard'), 'martin odegaard'); assert.equal(personNorm('Vinícius Júnior'), 'vinicius junior'); });
ok('sameClub handles FC words and word subsets, not look-alikes', () => { assert.ok(sameClub('Manchester City', 'Manchester City FC')); assert.ok(sameClub('Newcastle United', 'Newcastle')); assert.ok(!sameClub('Manchester City', 'Manchester United')); assert.ok(!sameClub('Real Madrid', 'Real Sociedad')); });
ok('normalize: needs name+id, valid dates, numbers', () => {
  assert.ok(normalizeProfiles([{ tm: 1 }]).problems.length); assert.ok(normalizeProfiles([{ name: 'A' }]).problems.length);
  assert.ok(normalizeProfiles([{ name: 'A', tm: 1, dob: '2000-1-1' }]).problems.length); assert.ok(normalizeProfiles([{ name: 'A', tm: 1, mv: 'lots' }]).problems.length);
  const r = normalizeProfiles([{ name: 'A B', tm: 5, dob: '2000-01-02', mv: 1000, club: 'X', tmClub: 'X FC', league: 'EPL', tr: [] }], 's'); assert.equal(r.problems.length, 0); assert.equal(r.rows[0].id, 'tm5'); assert.equal(r.rows[0].data.mv, 1000); assert.equal(r.rows[0].club, 'X');
});
const prof = (tm, name, dob, club, tmClub, tr) => normalizeProfiles([{ tm, name, dob, club, tmClub, league: 'EPL', tr }]).rows[0];
const bp = (id, name, dob, club, extra = {}) => ({ id, league: 'EPL', season: 2026, club, name, dob, ...extra });
const P = [
  prof(1, 'Leaver One', '2000-01-01', null, 'Real Madrid', [['2020-07-01', 'Ajax', 'Arsenal', 1], ['2026-06-20', 'Arsenal', 'Real Madrid', 90000000]]),
  prof(2, 'Stays Two', '2001-02-02', 'Arsenal', 'Arsenal FC', [['2022-07-01', 'Brighton', 'Arsenal', 5]]),
  prof(3, 'Odd Three', '2002-03-03', null, 'Inter Milan', [['2021-07-01', 'Ajax', 'Inter Milan', 5]]),
  prof(4, 'Loan Four', '2003-04-04', null, 'Chelsea', [['2022-07-01', 'Brighton', 'Chelsea', 5]]),
  prof(5, 'Back Five', '2000-05-05', null, 'Arsenal', [['2018-07-01', 'Arsenal', 'Benfica', 5], ['2026-08-01', 'Benfica', 'Arsenal', 5]]),
];
ok('flags: left, mismatch; no flag for same club, loans from parent, retired, older seasons', () => {
  const bank = [bp('a', 'Leaver One', '2000-01-01', 'Arsenal'), bp('b', 'Stays Two', '2001-02-02', 'Arsenal'), bp('c', 'Odd Three', '2002-03-03', 'Arsenal'),
    bp('d', 'Loan Four', '2003-04-04', 'Arsenal', { on_loan: true, loan_from: 'Chelsea' }), bp('e', 'Back Five', '2000-05-05', 'Arsenal'),
    bp('f', 'Leaver One', '2000-01-01', 'Arsenal', { season: 2025 }), bp('g', 'Unknown Six', '1999-01-01', 'Arsenal')];
  const f = computeFlags(bank, P); const by = Object.fromEntries(f.map(x => [x.name, x]));
  assert.equal(f.length, 2); assert.equal(by['Leaver One'].kind, 'left'); assert.equal(by['Leaver One'].detail.move_date, '2026-06-20'); assert.equal(by['Leaver One'].tm_club, 'Real Madrid'); assert.equal(by['Odd Three'].kind, 'mismatch');
  assert.equal(f[0].kind, 'left', 'left flags come first');
});
ok('name only counts when unique and our data has no birth date', () => {
  const dup = [prof(10, 'Same Name', '1990-01-01', null, 'Real Madrid', []), prof(11, 'Same Name', '1995-01-01', null, 'Roma', [])];
  assert.equal(computeFlags([bp('x', 'Same Name', null, 'Arsenal')], dup).length, 0);
  assert.equal(computeFlags([bp('x', 'Same Name', '1995-01-01', 'Arsenal')], dup).length, 1);
});
const call = async body => { let out; const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { out = { code: this.c || 200, ...o }; return this; }, end() {} }; await handler({ method: 'POST', headers: { 'x-admin-key': 'k' }, body, query: {} }, res); return out; };
const run = async () => {
  let r = await call({ action: 'importProfiles', data: [{ tm: 1, name: 'Leaver One', dob: '2000-01-01', tmClub: 'Real Madrid', tr: [['2026-06-20', 'Arsenal', 'Real Madrid', 9]] }], dryRun: true }); assert.equal(r.code, 200); assert.equal((await call({ action: 'profileStats' })).profiles, 0, 'preview does not save');
  r = await call({ action: 'importProfiles', data: [{ tm: 1, name: 'Leaver One', dob: '2000-01-01', tmClub: 'Real Madrid', tr: [['2026-06-20', 'Arsenal', 'Real Madrid', 9]] }], dryRun: false }); assert.equal(r.saved, 1);
  assert.equal((await call({ action: 'importProfiles', data: [{ name: 'x' }], dryRun: true })).code, 400);
  await call({ action: 'importPlayers', dryRun: false, data: [{ league: 'EPL', season: 2026, club: 'Arsenal', as_of: '2026-10-17', players: [{ name: 'Leaver One', dob: '2000-01-01', position: 'Forward' }] }] });
  r = await call({ action: 'checkFlags' }); assert.equal(r.added, 1);
  r = await call({ action: 'checkFlags' }); assert.equal(r.added, 0, 'running again adds nothing');
  r = await call({ action: 'flags' }); assert.equal(r.flags.length, 1); const k = r.flags[0].key;
  r = await call({ action: 'resolveFlag', key: k, decision: 'left' }); assert.equal(r.code, 200);
  assert.equal((await call({ action: 'flags' })).flags.length, 0);
  const pl = (await call({ action: 'players', q: 'leaver' })).rows[0]; assert.equal(pl.club_status, 'retired'); assert.equal(pl.club_retired_year, 2026);
  r = await call({ action: 'checkFlags' }); assert.equal(r.added, 0, 'a confirmed flag does not come back');
  assert.equal((await call({ action: 'resolveFlag', key: k, decision: 'left' })).code, 404);
};
run().then(() => { n++; console.log(n + ' profile tests passed'); }).catch(e => { console.error(e); process.exit(1); });
// batch answers
{ const call2 = async body => { let out; const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { out = { code: this.c || 200, ...o }; return this; }, end() {} }; await handler({ method: 'POST', headers: { 'x-admin-key': 'k' }, body, query: {} }, res); return out; };
  setTimeout(async () => {
    await call2({ action: 'importProfiles', dryRun: false, data: [{ tm: 21, name: 'Batch A', dob: '1999-01-01', tmClub: 'Roma', tr: [['2026-06-01', 'Arsenal', 'Roma', 1]] }, { tm: 22, name: 'Batch B', dob: '1999-02-02', tmClub: 'Roma', tr: [] }] });
    await call2({ action: 'importPlayers', dryRun: false, data: [{ league: 'EPL', season: 2026, club: 'Arsenal', as_of: '2026-10-17', players: [{ name: 'Batch A', dob: '1999-01-01', position: 'Forward' }, { name: 'Batch B', dob: '1999-02-02', position: 'Forward' }] }] });
    await call2({ action: 'checkFlags' }); const fl = (await call2({ action: 'flags' })).flags.filter(f => /Batch/.test(f.name)); assert.equal(fl.length, 2);
    const r = await call2({ action: 'resolveFlags', decisions: [{ key: fl.find(f => f.name === 'Batch A').key, decision: 'left' }, { key: fl.find(f => f.name === 'Batch B').key, decision: 'stay' }, { key: 'nope', decision: 'stay' }] });
    assert.equal(r.left, 1); assert.equal(r.stay, 1); assert.equal(r.skipped, 1);
    const rows = (await call2({ action: 'players', q: 'batch' })).rows; assert.equal(rows.find(x => x.name === 'Batch A').club_status, 'retired'); assert.ok(!rows.find(x => x.name === 'Batch B').club_status);
    console.log('batch test passed');
  }, 300); }
import { mergeHistory } from '../lib/bank-profiles.js';
import { normalizeSquad } from '../lib/bank-squad.js';
{
  const pr = { data: { tr: [['2025-07-24', 'Brighton', 'Coventry', 0], ['2026-05-31', 'Coventry', 'Brighton', 0]] } };
  let h = mergeHistory(pr, { club: 'Coventry City', joined: '2026-08', joined_from: 'Brighton' }); assert.equal(h.length, 3); assert.equal(h[2][4], 'squad'); assert.equal(h[2][2], 'Coventry City');
  assert.equal(mergeHistory(pr, { club: 'Brighton', joined: '2026-05' }).length, 2, 'join date not newer than TM: nothing added');
  const P2 = normalizeProfiles([{ tm: 9, name: 'Carl Rushworth', dob: '2001-05-02', tmClub: 'Brighton & Hove Albion', tr: pr.data.tr }]).rows;
  assert.equal(computeFlags([{ id: 'x', league: 'EPL', season: 2026, club: 'Coventry City', name: 'Carl Rushworth', dob: '2001-05-02', joined: '2026-08' }], P2).length, 0, 'newer join date explains the mismatch');
  assert.equal(computeFlags([{ id: 'x', league: 'EPL', season: 2026, club: 'Coventry City', name: 'Carl Rushworth', dob: '2001-05-02' }], P2).length, 1, 'without it the flag stays');
  const ctx = { today: '2026-10-25', known: new Map(), aliasMap: new Map(), league: 'EPL', season: 2026 };
  const sq = x => normalizeSquad({ league: 'EPL', season: 2026, club: 'Arsenal', as_of: '2026-10-17', players: [{ name: 'A B', dob: '2000-01-01', ...x }] }, 0, ctx);
  assert.equal(sq({ joined: '2026-08', joined_from: 'Villa' }).rows[0].joined, '2026-08');
  assert.ok(sq({ joined: '2026-12' }).problems.length, 'future join rejected'); assert.ok(sq({ joined: 'August 2026' }).problems.length); assert.equal(sq({ joined: 'NOT FOUND' }).rows[0].joined, null);
  console.log('joined tests passed');
}
