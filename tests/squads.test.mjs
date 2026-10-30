// node tests/squads.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { normalizeProfiles } from '../lib/bank-profiles.js';
import { compactSquad, matchSquad, squadRows, syncSquads, syncSquadClubs, squadPicker, compactCoach } from '../lib/sync-squads.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const Q = Date.parse('2026-10-30T03:00:00Z');
const prof = normalizeProfiles([
  { tm: 1, name: 'Karl Darlow', dob: '1990-10-08', club: 'Leeds', tmClub: 'Leeds United', league: 'EPL', nat: 'England', tr: [] },
  { tm: 2, name: 'Luke Steele', dob: '1984-09-24', club: 'Leeds', tmClub: 'Leeds United', league: 'EPL', nat: 'England', tr: [] },
  { tm: 3, name: 'Jon Smith', dob: '1995-01-01', club: 'Arsenal', tmClub: 'Arsenal', league: 'EPL', tr: [] },
  { tm: 4, name: 'Jim Smith', dob: '1995-02-02', club: 'Arsenal', tmClub: 'Arsenal', league: 'EPL', tr: [] }]).rows;
const api = { response: [{ team: { id: 63 }, players: [{ id: 1, name: 'K. Darlow', age: 36, number: 1, position: 'Goalkeeper' }, { id: 2, name: 'L. Steele', age: 42, number: 13, position: 'Goalkeeper' }, { id: 9, name: 'X. Unknown', age: 20, number: 9, position: 'Attacker' }, { id: 5, name: 'J. Smith', age: 31, number: 5, position: 'Defender' }] }] };
await t('matches by name + age (+ club); unknown and ambiguous stay unmatched', () => {
  const m = matchSquad(compactSquad(api), prof, 'Leeds', '2026-10-30');
  assert.equal(m[0].profile.name, 'Karl Darlow'); assert.equal(m[1].profile.name, 'Luke Steele');
  assert.equal(m[2].profile, null); assert.equal(m[3].how, 'ambiguous');
  const rows = squadRows({ players: [], matches: m, league: 'EPL', season: 2026, club: 'Leeds', asOf: '2026-10-30' });
  assert.equal(rows[0].dob, '1990-10-08'); assert.equal(rows[0].nationality, 'England'); assert.equal(rows[0].position, 'Goalkeeper'); assert.equal(rows[2].name, 'X. Unknown');
});
const mm = (o) => ({ id: `EPL|2026|${o.home}|${o.away}`, league: 'EPL', comp_name: 'x', season: 2026, round: null, date: '2026-10-31', time: null, kickoff: null, hg: null, ag: null, ht_h: null, ht_a: null, status: 'scheduled', note: null, source: 'paste', verified: false, conflict: null, ...o });
async function world() {
  const s = createMemoryStore(); await s.upsertMatches([mm({ home: 'Leeds', away: 'Arsenal' })]);
  await s.upsertProfiles(prof); await s.upsertTeamIds([{ api_team_id: 63, league: 'EPL', club: 'Leeds', api_name: 'Leeds', source: 'teams' }, { api_team_id: 42, league: 'EPL', club: 'Arsenal', api_name: 'Arsenal', source: 'teams' }]);
  const calls = []; return { s, calls, run: (o = {}) => syncSquads(s, { getSquad: async id => { calls.push(id); return id === 63 ? api : { response: [{ players: [{ id: 3, name: 'Jon Smith', age: 31, number: 5, position: 'Defender' }] }] }; }, now: Q, ...o }) };
}
await t('fills a club with no squad, keeps a club that already has one, refreshes weekly, respects quiet hours', async () => {
  const w = await world();
  await w.s.upsertPlayers([{ id: 'EPL|2026|arsenal|x', league: 'EPL', season: 2026, club: 'Arsenal', name: 'X' }]);
  const r = await w.run(); assert.equal(r.calls, 2); assert.equal(r.applied, 1); assert.equal(r.kept, 1);
  assert.equal((await w.s.listPlayers({ league: 'EPL', season: 2026, club: 'Leeds' })).length, 4);
  assert.equal((await w.s.listPlayers({ league: 'EPL', season: 2026, club: 'Arsenal' })).length, 1);     // untouched
  assert.equal((await w.run({ now: Q + 864e5 })).calls, 0);                                                // fetched < 7 days ago
  assert.equal((await w.run({ now: Q + 8 * 864e5 })).calls, 2);
  assert.equal((await w.run({ now: Date.parse('2026-10-30T14:00:00Z') + 20 * 864e5 })).calls, 0);        // daytime
});
await t('forced run works on a busy day; emptyOnly spends nothing on clubs that have a squad; reserve stops it', async () => {
  const w = await world();
  const many = []; for (let i = 0; i < 31; i++) many.push(mm({ home: 'H' + i, away: 'A' + i }));
  await w.s.upsertMatches(many.map(x => ({ ...x, date: '2026-10-30' })));
  await w.s.upsertPlayers([{ id: 'EPL|2026|arsenal|x', league: 'EPL', season: 2026, club: 'Arsenal', name: 'X' }]);
  assert.equal((await w.run({ now: Q })).calls, 0);                                   // automatic: busy day, nothing
  const r = await w.run({ now: Q, force: true, emptyOnly: true });
  assert.equal(r.calls, 1); assert.equal(r.applied, 1); assert.deepEqual(w.calls, [63]);   // Arsenal skipped, no request
  const w2 = await world();
  w2.calls.length = 0;
  const r2 = await syncSquads(w2.s, { getSquad: async id => { w2.calls.push(id); const j = { response: [{ players: [] }] }; Object.defineProperty(j, '__left', { value: 30 }); return j; }, force: true, now: Q, maxRun: 5, reserve: 30 });
  assert.equal(r2.calls, 1); assert.equal(r2.stopped, true);
});
await t('ticked clubs: per-club result with players and coach; existing squad kept; reserve stops', async () => {
  const w = await world();
  await w.s.upsertPlayers([{ id: 'EPL|2026|arsenal|x', league: 'EPL', season: 2026, club: 'Arsenal', name: 'X', shirt: 9 }]);
  const pk = await squadPicker(w.s); assert.equal(pk.clubs.find(c => c.club === 'Arsenal').players, 1); assert.equal(pk.clubs.find(c => c.club === 'Leeds').players, 0);
  const coachJson = { response: [{ name: 'Daniel Farke', nationality: 'Germany', career: [{ team: { id: 99 }, end: '2020' }, { team: { id: 63 }, end: null }] }] };
  assert.equal(compactCoach(coachJson, 63).name, 'Daniel Farke'); assert.equal(compactCoach(coachJson, 42), null);
  const sq = async id => id === 63 ? api : { response: [{ players: [{ id: 3, name: 'Jon Smith', age: 31, number: 7, position: 'Attacker' }] }] };
  const r = await syncSquadClubs(w.s, { getSquad: sq, getCoach: async () => coachJson, teamIds: [63, 42], withCoach: true, now: Q });
  assert.equal(r.calls, 4); assert.equal(r.results[0].club, 'Leeds'); assert.equal(r.results[0].applied, true); assert.equal(r.results[0].players.length, 4); assert.equal(r.results[0].coach, 'Daniel Farke');
  assert.equal(r.results[1].kept, true); assert.equal(r.results[1].players.length, 1);
  const w2 = await world(); const lowLeft = async id => { const j = id === 63 ? api : { response: [] }; Object.defineProperty(j, '__left', { value: 20, configurable: true }); return j; };
  const r2 = await syncSquadClubs(w2.s, { getSquad: lowLeft, teamIds: [63, 42], reserve: 30, now: Q });
  assert.equal(r2.results.length, 1); assert.equal(r2.stopped, true);
});
console.log(n + ' squad tests passed');
