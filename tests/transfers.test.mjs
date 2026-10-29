// node tests/transfers.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { planBudget, compactMoves, syncTransfers, transferStatus, idsFromFixtures } from '../lib/sync-transfers.js';
import { sameApiName, apiMovesFor, mergeHistory, computeFlags } from '../lib/bank-profiles.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const Q = Date.parse('2026-10-26T03:00:00Z');   // quiet hour
const m = (o) => ({ id: `${o.league}|2026|${o.home}|${o.away}|${o.date}`, comp_name: 'x', season: 2026, round: null, time: null, kickoff: null, hg: null, ag: null, ht_h: null, ht_a: null, status: 'scheduled', note: null, source: 'paste', verified: false, conflict: null, ...o });

await t('budget: quiet hours only, less when busy, none when very busy, force overrides hours', () => {
  assert.equal(planBudget({ now: Q, usedToday: 0, busy: 0 }).run, 3);
  assert.equal(planBudget({ now: Date.parse('2026-10-26T12:00:00Z'), usedToday: 0, busy: 0 }).run, 0);
  assert.equal(planBudget({ now: Date.parse('2026-10-26T12:00:00Z'), usedToday: 0, busy: 0, force: true }).run, 3);
  assert.equal(planBudget({ now: Q, usedToday: 11, busy: 20 }).run, 1);
  assert.equal(planBudget({ now: Q, usedToday: 12, busy: 20 }).run, 0);
  assert.equal(planBudget({ now: Q, usedToday: 0, busy: 30 }).run, 0);
  assert.equal(planBudget({ now: Q, usedToday: 35, busy: 0 }).run, 1);
});
await t('compactMoves keeps only recent moves involving the club', () => {
  const j = { response: [{ player: { id: 1, name: 'K. Darlow' }, transfers: [
    { date: '2025-08-01', type: 'Loan', teams: { in: { id: 33, name: 'Man Utd' }, out: { id: 9, name: 'X' } } },
    { date: '2024-01-01', type: 'Free', teams: { in: { id: 33, name: 'Man Utd' }, out: { id: 9, name: 'X' } } },
    { date: '2025-09-01', type: 'Free', teams: { in: { id: 7, name: 'Y' }, out: { id: 8, name: 'Z' } } }] }] };
  const r = compactMoves(j, 33); assert.equal(r.length, 1); assert.equal(r[0].t, 'Loan'); assert.equal(r[0].to, 'Man Utd');
});
await t('API names match Transfermarkt names (initial + surname)', () => {
  assert.ok(sameApiName('K. Darlow', 'Karl Darlow'));
  assert.ok(sameApiName('Bruno Fernandes', 'Bruno Fernandes'));
  assert.ok(!sameApiName('K. Darlow', 'Luke Steele'));
  assert.ok(!sameApiName('J. Smith', 'Karl Darlow'));
  assert.ok(sameApiName('T. Alexander-Arnold', 'Trent Alexander-Arnold'));
});
await t('API move is added only if newer than Transfermarkt and the club fits; no double rows', () => {
  const pr = { name: 'Karl Darlow', club: 'Leeds', tm_club: 'Newcastle United', data: { tr: [['2025-01-10', 'A', 'Newcastle United', '']] } };
  const mv = [{ n: 'K. Darlow', d: '2025-08-02', t: 'Loan', f: 'Newcastle United', to: 'Leeds' }, { n: 'K. Darlow', d: '2024-08-02', t: 'Free', f: 'B', to: 'Newcastle United' }, { n: 'K. Someone', d: '2025-08-02', t: 'Free', f: 'Q', to: 'R' }];
  const mine = apiMovesFor(pr, mv); assert.equal(mine.length, 2);
  const h = mergeHistory(pr, { club: 'Leeds', joined: '2025-08', joined_from: 'Newcastle United' }, mine);
  assert.equal(h.length, 2); assert.equal(h[1][4], 'api-football'); assert.equal(h[1][5], 'Loan');
});
await t('a newer API move to our club silences the "may have left" flag', async () => {
  const { normalizeProfiles } = await import('../lib/bank-profiles.js');
  const pr = normalizeProfiles([{ tm: 9, name: 'Karl Darlow', dob: '1990-10-08', club: null, tmClub: 'Newcastle United', league: 'EPL', tr: [['2025-01-10', 'A', 'Newcastle United', 1]] }]).rows;
  const bank = [{ id: 'a', league: 'EPL', season: 2026, club: 'Leeds', name: 'Karl Darlow', dob: '1990-10-08' }];
  assert.equal(computeFlags(bank, pr, new Map()).length, 1);
  assert.equal(computeFlags(bank, pr, new Map(), [{ n: 'K. Darlow', d: '2025-08-02', t: 'Loan', f: 'Newcastle United', to: 'Leeds' }]).length, 0);
});
await t('team ids are learned free from fixtures', () => {
  const rows = idsFromFixtures([{ league: 'EPL', home: 'Arsenal', away: 'Chelsea', fx: { teams: { home: { id: 42, name: 'Arsenal' }, away: { id: 49, name: 'Chelsea' } } } }, { league: 'UCL', home: 'A', away: 'B', fx: { teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } } } }]);
  assert.deepEqual(rows.map(r => r.api_team_id).sort(), [42, 49]);
});
async function world(extraMatches = []) {
  const s = createMemoryStore();
  await s.upsertMatches([m({ league: 'EPL', date: '2026-10-31', home: 'Arsenal', away: 'Chelsea' }), ...extraMatches]);
  const calls = []; const left = { v: 90 };
  const getTeams = async (lg, season) => { calls.push('teams ' + lg + ' ' + season); return { response: [{ team: { id: 42, name: 'Arsenal' } }, { team: { id: 49, name: 'Chelsea' } }], __left: left.v } };
  const getTransfers = async id => { calls.push('tr ' + id); return { response: [{ player: { id: id, name: 'P. Test' }, transfers: [{ date: '2026-08-01', type: 'Loan', teams: { in: { id, name: id === 42 ? 'Arsenal' : 'Chelsea' }, out: { id: 5, name: 'Z' } } }] }], __left: left.v } };
  return { s, calls, run: (o = {}) => syncTransfers(s, { getTeams, getTransfers, now: Q, ...o }) };
}
await t('bootstraps ids with one teams request, then fetches clubs, 3 requests per run, refresh only after 14 days', async () => {
  const w = await world(); const r1 = await w.run();
  assert.equal(r1.calls, 3); assert.deepEqual(w.calls, ['teams 39 2024', 'tr 42', 'tr 49']);
  const r2 = await w.run({ now: Q + 864e5 }); assert.equal(r2.calls, 0);               // fetched recently
  const r3 = await w.run({ now: Q + 15 * 864e5 }); assert.equal(r3.calls, 2);          // 14 days later: both again
  const st = await transferStatus(w.s, Q); assert.equal(st.fetched, 2); assert.equal(st.mapped, 2);
});
await t('busy day and daytime spend nothing; errors pause the job for an hour', async () => {
  const w = await world(); assert.equal((await w.run({ now: Date.parse('2026-10-26T14:00:00Z') })).calls, 0); assert.equal(w.calls.length, 0);
  const s = createMemoryStore(); await s.upsertMatches([m({ league: 'EPL', date: '2026-10-31', home: 'Arsenal', away: 'Chelsea' })]); let c = 0;
  const bad = async () => { c++; return { errors: { access: 'Your account is suspended' }, response: [] }; };
  const r = await syncTransfers(s, { getTeams: bad, getTransfers: bad, now: Q }); assert.equal(c, 1); assert.match(r.summary, /suspended/);
  const r2 = await syncTransfers(s, { getTeams: bad, getTransfers: bad, now: Q + 20 * 60000 }); assert.equal(c, 1); assert.match(r2.summary, /paused/);
});
console.log(n + ' transfer tests passed');
// setDate admin action
{
  process.env.BANK_STORE = 'memory'; process.env.ADMIN_KEY = 'k';
  const { default: handler } = await import('../api/admin.js');
  const call = body => new Promise(r => { const res = { _h: {}, setHeader() {}, status(c) { this.c = c; return this; }, json(o) { r({ c: this.c, o }); } }; handler({ method: 'POST', headers: { 'x-admin-key': 'k' }, query: {}, body }, res); });
  await call({ action: 'saveMatch', match: { league: 'LALIGA', season: 2026, date: '2026-10-25', home: 'Sevilla', away: 'Osasuna' } });
  const id = 'LALIGA|2026|sevilla|osasuna';
  const bad = await call({ action: 'setDate', id, league: 'LALIGA', season: 2026, date: '26-10-2026' }); await t('setDate rejects a bad date', () => assert.equal(bad.c, 400));
  const ok = await call({ action: 'setDate', id, league: 'LALIGA', season: 2026, date: '2026-10-26', time: '20:00' });
  await t('setDate moves the match, stays scheduled', () => { assert.equal(ok.c, 200); assert.equal(ok.o.row.date, '2026-10-26'); assert.equal(ok.o.row.time, '20:00'); assert.equal(ok.o.row.status, 'scheduled'); });
}
console.log('setDate tests done');
await t('ids learned from fixtures do not block the one-off teams request for that league', async () => {
  const w = await world(); await w.s.upsertTeamIds([{ api_team_id: 42, league: 'EPL', club: 'Arsenal', api_name: 'Arsenal', source: 'fixture' }]);
  await w.run(); assert.ok(w.calls.includes('teams 39 2024'));
});
