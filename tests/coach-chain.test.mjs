// node tests/coach-chain.test.mjs — vacancy watch: new coach found, origin traced, chain continues, ends at a free agent
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { syncCoachWatch, parseCoach } from '../lib/coach-chain.js';
const now = Date.parse('2026-11-20T10:00:00Z'); const later = h => now + h * 3600e3;
const store = createMemoryStore();
await store.upsertTeamIds([{ api_team_id: 33, league: 'EPL', club: 'Manchester United' }, { api_team_id: 49, league: 'EPL', club: 'Chelsea' }, { api_team_id: 529, league: 'LALIGA', club: 'Barcelona' }]);
await store.upsertMatches([['EPL', 'Manchester United'], ['EPL', 'Chelsea'], ['LALIGA', 'Barcelona']].map(([league, club], i) => ({ id: 'm' + i, league, season: 2026, date: '2026-10-0' + (i + 1), home: club, away: 'Opp' + i, status: 'finished', hg: 1, ag: 0 })));
await store.upsertCoaches([['EPL', 'Manchester United', 'Michael Carrick'], ['EPL', 'Chelsea', 'Xabi'], ['LALIGA', 'Barcelona', 'Flick']].map(([league, club, name]) => ({ id: `${league}|2026|${club.toLowerCase()}`, league, season: 2026, club, name, api_id: 7, as_of: '2026-11-19' })));
await store.upsertCoachSpells([{ id: 'EPL|manchester united|michael carrick', league: 'EPL', club: 'Manchester United', name: 'Michael Carrick', role: 'head', ended_on: '2026-11-12', end_reason: 'Sacked', source: 'admin' }]);
await store.upsertCoachWatch([{ team_api_id: 33, league: 'EPL', club: 'Manchester United', left_coach: 'Michael Carrick', reason: 'sacked', since: '2026-11-12', last_checked: null, done_at: null }]);
// API answers: Man United -> Xabi (came from Chelsea, left 2 days ago); Chelsea -> Flick (came from Barcelona, left last week); Barcelona -> Free Guy (left his last job 200 days ago)
const answers = {
  33: { response: [{ id: 11, name: 'Xabi', nationality: 'Spain', career: [{ team: { id: 33, name: 'Manchester United' }, start: '2026-11-18', end: null }, { team: { id: 49, name: 'Chelsea' }, start: '2025-06-01', end: '2026-11-16' }] }] },
  49: { response: [{ id: 12, name: 'Flick', nationality: 'Germany', career: [{ team: { id: 49, name: 'Chelsea' }, start: '2026-11-19', end: null }, { team: { id: 529, name: 'Barcelona' }, start: '2024-05-01', end: '2026-11-17' }] }] },
  529: { response: [{ id: 13, name: 'Free Guy', nationality: 'Italy', career: [{ team: { id: 529, name: 'Barcelona' }, start: '2026-11-20', end: null }, { team: { id: 77, name: 'Old Club' }, start: '2023-01-01', end: '2026-05-01' }] }] } };
const asked = []; const getCoach = async id => { asked.push(id); return { ...answers[id], __left: 60 }; };
const p = parseCoach(answers[33], 33); assert.equal(p.origin, 'club'); assert.equal(p.prev.team, 'Chelsea'); assert.equal(parseCoach(answers[529], 529).origin, 'free');
let r = await syncCoachWatch(store, { getCoach, now, room: 1 });
assert.deepEqual(asked, [33]); assert.match(r.summary, /Xabi \(from Chelsea/);
assert.equal((await store.listCoaches({ league: 'EPL', season: 2026, club: 'Manchester United' }))[0].name, 'Xabi');
let w = await store.listCoachWatch(); assert.ok(w.find(x => x.team_api_id === 33).done_at); const cw = w.find(x => x.team_api_id === 49); assert.equal(cw.left_coach, 'Xabi'); assert.equal(cw.since, '2026-11-16');
let sp = await store.listCoachSpells({ club: 'Manchester United' }); assert.equal(sp.find(s => s.name === 'Xabi').prev_team, 'Chelsea'); assert.equal(sp.find(s => s.name === 'Xabi').started_on, '2026-11-18'); assert.equal(sp.find(s => s.name === 'Michael Carrick').ended_on, '2026-11-12');
r = await syncCoachWatch(store, { getCoach, now: later(1), room: 1 });
assert.deepEqual(asked, [33, 49]); assert.match(r.summary, /Flick \(from Barcelona/);
r = await syncCoachWatch(store, { getCoach, now: later(2), room: 1 });
assert.deepEqual(asked, [33, 49, 529]); assert.match(r.summary, /Free Guy \(was a free agent since 2026-05-01: the chain ends here\)/);
w = await store.listCoachWatch(); assert.ok(w.every(x => x.done_at), 'every vacancy is settled, nothing left to watch');
r = await syncCoachWatch(store, { getCoach, now: later(3), room: 1 }); assert.equal(r.calls, 0, 'chain over: no more requests (the clubs were checked today)');
// no new coach yet: the vacancy stays on the list and is asked again only after 12 hours
await store.upsertCoachWatch([{ team_api_id: 33, left_coach: 'Xabi', done_at: null, last_checked: null }]);
const same = async id => ({ response: [{ id: 11, name: 'Xabi', career: [{ team: { id: 33 }, start: '2026-11-18', end: null }] }], __left: 60 });
asked.length = 0; const c1 = await syncCoachWatch(store, { getCoach: async id => { asked.push(id); return same(id); }, now: later(4), room: 1 }); const c2 = await syncCoachWatch(store, { getCoach: async id => { asked.push(id); return same(id); }, now: later(6), room: 1 });
assert.equal(asked.length, 1, 'asked once, then 2h later not again'); assert.equal((await store.listCoachWatch()).find(x => x.team_api_id === 33).done_at, null);
// the daily cap and the reserve are respected
const none = await syncCoachWatch(store, { getCoach: async () => { throw new Error('must not call'); }, now: later(30), room: 1, dailyCap: 0 }); assert.equal(none.calls, 0);
console.log('ok');
