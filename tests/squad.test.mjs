// node tests/squad.test.mjs
import assert from 'node:assert/strict';
process.env.BANK_STORE = 'memory'; process.env.ADMIN_KEY = 'k';
import { normalizeSquad, parseStatus, ageOn } from '../lib/bank-squad.js';
import { storeFromEnv } from '../lib/bank-store.js';
import handler from '../api/admin.js';
let n = 0; const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const okA = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const T = { today: '2026-10-19' };
const pack = (players, extra = {}) => ({ league: 'EPL', season: 2026, club: 'Arsenal', as_of: '2026-10-17', coach: { name: 'Mikel Arteta', nationality: 'Spain' }, players, ...extra });

ok('statuses', () => {
  assert.deepEqual(parseStatus('Active', 'club'), { status: 'active' });
  assert.deepEqual(parseStatus('Retired (2026)', 'club'), { status: 'retired', year: 2026 });
  assert.deepEqual(parseStatus('Not capped', 'national'), { status: 'not_capped' });
  assert.ok(parseStatus('Not capped', 'club').problem);
  assert.deepEqual(parseStatus('NOT FOUND', 'club'), {});
});
ok('age on a date', () => { assert.equal(ageOn('2001-09-05', '2026-10-17'), 25); assert.equal(ageOn('2001-12-05', '2026-10-17'), 24); });
ok('full player', () => {
  const r = normalizeSquad(pack([{ name: 'Bukayo Saka', shirt: '7', dob: '2001-09-05', position: 'forward', nationality: 'England', club_status: 'Active', national_status: 'Active' }]), 0, T);
  assert.equal(r.problems.length, 0); const p = r.rows[0];
  assert.equal(p.shirt, 7); assert.equal(p.position, 'Forward'); assert.equal(p.club_status, 'active'); assert.equal(p.age, null); assert.equal(r.coach.name, 'Mikel Arteta');
});
ok('NOT FOUND values become empty, not errors', () => {
  const r = normalizeSquad(pack([{ name: 'A B', shirt: 'NOT FOUND', dob: 'NOT FOUND', age: 19, position: 'Defender', nationality: 'NOT FOUND' }]), 0, T);
  assert.equal(r.problems.length, 0); const p = r.rows[0]; assert.equal(p.shirt, null); assert.equal(p.dob, null); assert.equal(p.age, 19); assert.equal(p.age_as_of, '2026-10-17'); assert.equal(p.nationality, null);
});
ok('no dob and no age is flagged', () => { const r = normalizeSquad(pack([{ name: 'A B' }]), 0, T); assert.ok(r.warnings.some(w => /neither a date of birth nor an age/.test(w))); assert.equal(r.noBirthInfo, 1); });
ok('age that disagrees with dob is warned', () => { const r = normalizeSquad(pack([{ name: 'A B', dob: '2001-09-05', age: 30 }]), 0, T); assert.ok(r.warnings.some(w => /does not match/.test(w))); });
ok('bad values are rejected', () => {
  for (const bad of [{ name: 'A', dob: '05/09/2001' }, { name: 'A', shirt: 'x' }, { name: 'A', age: 5 }, { name: 'A', club_status: 'gone' }, { name: 'A', dob: '2030-01-01' }, { name: '' }])
    assert.ok(normalizeSquad(pack([bad]), 0, T).problems.length, JSON.stringify(bad));
});
ok('unknown league / missing club / future as_of', () => {
  assert.ok(normalizeSquad({ league: 'XX', season: 2026, club: 'A', players: [] }, 0, T).problems.length);
  assert.ok(normalizeSquad({ league: 'EPL', season: 2026, players: [] }, 0, T).problems.length);
  assert.ok(normalizeSquad(pack([], { as_of: '2027-01-01' }), 0, T).problems.length);
});
ok('retired club status keeps the year; active drops it', () => {
  const r = normalizeSquad(pack([{ name: 'Old Guy', dob: '1988-01-01', club_status: 'Retired (2026)', national_status: 'Retired (2022)' }, { name: 'Young', dob: '2005-01-01', club_status: 'Active', national_status: 'Not capped' }]), 0, T);
  assert.equal(r.rows[0].club_retired_year, 2026); assert.equal(r.rows[0].national_retired_year, 2022); assert.equal(r.rows[1].national_status, 'not_capped'); assert.equal(r.rows[1].club_retired_year, null);
});
ok('club spelling is matched to the bank', () => {
  const known = new Map([['EPL', new Map([['manchester city', 'Manchester City'], ['arsenal', 'Arsenal']])]]);
  const r = normalizeSquad({ league: 'EPL', season: 2026, club: 'Man City FC', players: [{ name: 'X Y', dob: '2000-01-01' }] }, 0, { ...T, known, aliasMap: new Map() });
  assert.equal(r.rows[0].club, 'Manchester City'); assert.ok(r.notes.length === 1);
  const u = normalizeSquad({ league: 'EPL', season: 2026, club: 'Totally Unknown', players: [] }, 0, { ...T, known, aliasMap: new Map() });
  assert.ok(u.warnings.some(w => /not a club the bank knows/.test(w)));
});

// whole path through the admin handler
const mk = () => ({ code: 200, h: {}, body: null, setHeader() { }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const A = async (body) => { const r = mk(); await handler({ method: 'POST', headers: { 'x-admin-key': 'k' }, body: { today: '2026-10-19', ...body } }, r); return r; };
await okA('import preview does not save; save stores players and coaches', async () => {
  const data = [pack([{ name: 'A One', shirt: 7, dob: '2001-09-05', position: 'Forward', nationality: 'England', club_status: 'Active', national_status: 'Active' }, { name: 'B Two', shirt: 7, age: 20 }]),
                { league: 'LALIGA', season: 2026, club: 'Real Madrid', coach: { name: 'NOT FOUND' }, players: [{ name: 'C Three', dob: '2000-02-02' }] }];
  const pv = await A({ action: 'importPlayers', data, dryRun: true });
  assert.equal(pv.code, 200); assert.equal(pv.body.received, 3); assert.equal(pv.body.coaches, 1); assert.ok(pv.body.warnings.some(w => /shirt 7/.test(w)));
  assert.equal((await A({ action: 'players' })).body.total, 0);
  const sv = await A({ action: 'importPlayers', data, dryRun: false }); assert.equal(sv.body.saved, 3);
  const l = await A({ action: 'players' }); assert.equal(l.body.total, 3); assert.equal(l.body.coachTotal, 1);
  const arsenal = l.body.clubs.find(c => c.club === 'Arsenal'); assert.equal(arsenal.players, 2); assert.equal(arsenal.coach, 'Mikel Arteta'); assert.equal(arsenal.noBirth, 0);
  const f = await A({ action: 'players', q: 'one' }); assert.equal(f.body.rows.length, 1); assert.equal(f.body.rows[0].name, 'A One');
  const again = await A({ action: 'importPlayers', data, dryRun: true }); assert.equal(again.body.created, 0);
  const bad = await A({ action: 'importPlayers', data: [pack([{ name: 'X', club_status: 'nope' }])], dryRun: false }); assert.equal(bad.code, 400);
  assert.equal((await A({ action: 'players' })).body.total, 3);
  const del = await A({ action: 'deleteClubSquad', league: 'EPL', season: 2026, club: 'Arsenal' }); assert.equal(del.body.deleted, 2);
  assert.equal((await A({ action: 'players' })).body.total, 1);
});
console.log(n + ' squad tests passed');
ok('loan and extended national statuses', () => {
  assert.deepEqual(parseStatus('On Loan (from AS Roma)', 'club'), { status: 'active', loan: true, loan_from: 'AS Roma' });
  assert.deepEqual(parseStatus('Permanent (Captain)', 'club'), { status: 'active' });
  assert.deepEqual(parseStatus('Youth International', 'national'), { status: 'youth' });
  assert.deepEqual(parseStatus('Former youth international', 'national'), { status: 'former_youth' });
  assert.deepEqual(parseStatus('Former international', 'national'), { status: 'former' });
  assert.deepEqual(parseStatus('Uncapped', 'national'), { status: 'not_capped' });
  const r = normalizeSquad(pack([{ name: 'L O', club_status: 'On Loan (from X FC)' }]), 0, T);
  assert.equal(r.rows[0].on_loan, true); assert.equal(r.rows[0].loan_from, 'X FC');
});
console.log('extra tests ok');

// ---- accent variants are replaced, not duplicated ----
{
  const { staleVariants, nameKey } = await import('../lib/bank-squad.js');
  const mk = (name, club = 'Aston Villa', season = 2026) => ({ id: `EPL|${season}|${club.toLowerCase()}|${name.toLowerCase()}`, league: 'EPL', season, club, name });
  assert.equal(nameKey('Victor Lindelöf'), nameKey('Victor  Lindelof'));
  const old = [mk('Victor Lindelof'), mk('Ollie Watkins'), mk('Victor Lindelof', 'Aston Villa', 2025)];
  const inc = [mk('Victor Lindelöf'), mk('Ollie Watkins')];
  const st = staleVariants(old, inc);
  assert.deepEqual(st.map(x => x.name + '|' + x.season), ['Victor Lindelof|2026'], 'same player, other spelling, same season/club only');
  console.log('accent-variant tests ok');
}
