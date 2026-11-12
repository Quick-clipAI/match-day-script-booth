// node tests/sync-coaches.test.mjs  - coach ids: daily cap, reserve, match-day pause, one request per club, done clubs skipped
import assert from 'node:assert/strict';
import { syncCoaches } from '../lib/sync-coaches.js';
const now = Date.parse('2026-11-12T10:00:00Z');
const mk = (extra = {}) => {
  const coaches = new Map([['EPL|2026|arsenal', { id: 'EPL|2026|arsenal', league: 'EPL', season: 2026, club: 'Arsenal', name: 'Mikel Arteta', api_id: null }], ['EPL|2026|chelsea', { id: 'EPL|2026|chelsea', league: 'EPL', season: 2026, club: 'Chelsea', name: 'E. Maresca', api_id: 4 }], ['EPL|2026|everton', { id: 'EPL|2026|everton', league: 'EPL', season: 2026, club: 'Everton', name: 'D. Moyes', api_id: null }]]);
  const logs = []; const matches = extra.matches || [];
  return { coaches, logs, store: { recentLogs: async () => logs.slice().reverse(), addLog: async l => logs.push({ ...l, at: new Date(now).toISOString() }), listMatches: async () => matches,
    listTeamIds: async () => [{ club: 'Arsenal', league: 'EPL', api_team_id: 42 }, { club: 'Chelsea', league: 'EPL', api_team_id: 49 }, { club: 'Everton', league: 'EPL', api_team_id: 45 }],
    clubIndex: async () => ['Arsenal', 'Chelsea', 'Everton'].map(c => ({ league: 'EPL', club: c, last_season: 2026 })), listCoaches: async () => [...coaches.values()], upsertCoaches: async rows => rows.forEach(r => coaches.set(r.id.replace(/\|[^|]*$/, '|' + r.club.toLowerCase()), { ...r })) } };
};
const resp = (teamId, id) => ({ response: [{ id, name: 'Coach ' + id, nationality: 'X', career: [{ team: { id: teamId }, end: null }] }], __left: 50 });
{
  const { store, coaches } = mk(); const asked = [];
  const r = await syncCoaches(store, { getCoach: async t => { asked.push(t); return resp(t, 1000 + t); }, now });
  assert.deepEqual(asked, [42, 45], 'only clubs without an id, one request each (Chelsea is done)');
  assert.equal(r.calls, 2); assert.equal(r.got, 2); assert.equal(r.remaining, 0);
  assert.equal(coaches.get('EPL|2026|arsenal').api_id, 1042);
}
{ const { store } = mk(); const r = await syncCoaches(store, { getCoach: async () => { throw new Error('must not call'); }, now, dailyCap: 0 }); assert.equal(r.calls, 0); assert.match(r.summary, /used/); }
{ const { store } = mk({ matches: Array(15).fill({}) }); const r = await syncCoaches(store, { getCoach: async () => { throw new Error('must not call'); }, now }); assert.match(r.summary, /busy match day/); }
{ const { store } = mk(); let n = 0; const r = await syncCoaches(store, { getCoach: async t => { n++; return { ...resp(t, 5), __left: 12 }; }, now, reserve: 15 }); assert.equal(n, 1, 'stops once the requests left reach the reserve'); assert.equal(r.calls, 1); }
{ const { store, coaches } = mk(); const r = await syncCoaches(store, { getCoach: async () => ({ response: [], __left: 80 }), now }); assert.equal(r.none, 2); assert.equal(coaches.get('EPL|2026|arsenal').api_id, 0, 'no coach on the API is remembered, so it is not asked again'); }
{ const { store } = mk(); const r = await syncCoaches(store, { getCoach: async () => ({ errors: { rateLimit: 'Too many requests' } }), now }); assert.equal(r.calls, 1); assert.match(r.summary, /1 request/); }
console.log('ok');
