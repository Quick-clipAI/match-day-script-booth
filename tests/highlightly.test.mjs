// node tests/highlightly.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { hlList, hlFetch, convertHl, applyHl } from '../lib/highlightly.js';
const hm = (id, date, h, a, hg, ag) => ({ id, date: date + 'T15:00:00Z', homeTeam: { id: id * 10 + 1, name: h }, awayTeam: { id: id * 10 + 2, name: a }, league: { id: 33973, season: 2026, name: 'Premier League' }, country: { name: 'England' }, state: { description: 'Finished', score: { current: `${hg} - ${ag}` } } });
const MATCHES = [hm(1, '2026-10-10', 'Manchester United', 'Tottenham', 1, 1), hm(2, '2026-10-10', 'Chelsea', 'Bournemouth', 5, 1)];
const calls = [];
globalThis.fetch = async url => {
  calls.push(url); const j = x => ({ status: 200, json: async () => x });
  if (url.includes('/matches?date=')) return j({ data: [MATCHES[0]] });
  if (url.includes('/matches?leagueId=')) return j({ data: MATCHES, pagination: { totalCount: 2 } });
  if (url.includes('/events/1')) return j([{ team: { id: 11 }, time: '73', type: 'Goal', assist: 'M. Cunha', player: 'B. Mbeumo', playerId: 5, assistingPlayerId: 6 }, { team: { id: 12 }, time: '45+2', type: 'Goal', assist: null, player: 'Kudus', playerId: 9, assistingPlayerId: null }, { team: { id: 11 }, time: '59', type: 'Substitution', player: 'Amad', playerId: 7, substituted: 'Zirkzee', assistingPlayerId: 8 }, { team: { id: 12 }, time: '4', type: 'Yellow Card', player: 'Gallagher', playerId: 10 }]);
  if (url.includes('/lineups/1')) return j({ homeTeam: { formation: '4-2-3-1', initialLineup: [[{ id: 1, name: 'Lammens', number: 1, position: 'Goalkeeper' }], [{ id: 8, name: 'Zirkzee', number: 11, position: 'Forward' }, { id: 5, name: 'B. Mbeumo', number: 19, position: 'Forward' }]], substitutes: [{ id: 7, name: 'Amad', number: 16, position: 'Forward' }] }, awayTeam: { formation: 'Unknown', initialLineup: [[{ id: 10, name: 'Gallagher', number: 22, position: 'Midfielder' }, { id: 9, name: 'Kudus', number: 20, position: 'Midfielder' }]], substitutes: [] } });
  return { status: 404, json: async () => null };
};
const s = createMemoryStore();
const row = (id, home, away, hg, ag, date = '2026-10-10') => ({ id, league: 'EPL', comp_name: 'Premier League', season: 2026, round: '', date, home, away, status: 'finished', hg, ag });
await s.upsertMatches([row('EPL|2026|man utd|spurs', 'Manchester United', 'Tottenham Hotspur', 1, 1), row('EPL|2026|chelsea|bournemouth', 'Chelsea', 'AFC Bournemouth', 5, 1)]);
await s.saveManualDetail('EPL|2026|man utd|spurs', { v: 1, source: 'openmatchday', events: [], lineups: {}, stats: [{ label: 'Total Shots', home: 12, away: 9 }], halftime: { home: 0, away: 1 } });
const l = await hlList(s, { key: 'k', league: 'EPL' }); assert.equal(l.ok, true); assert.equal(l.matches, 2);
// conversion
const d = convertHl({ home: { id: 11 }, away: { id: 12 }, events: JSON.parse(JSON.stringify(await (await fetch('/events/1')).json())), lineups: await (await fetch('/lineups/1')).json() });
assert.equal(d.events.filter(e => e.type === 'goal').length, 2); assert.equal(d.events[1].x, 2);
const mb = d.lineups.home.xi.find(p => p.name === 'B. Mbeumo'); assert.equal(mb.g, 1);
const zirk = d.lineups.home.xi.find(p => p.name === 'Zirkzee'); assert.equal(zirk.min, 59);              // went off at 59, whichever name order the source used
assert.equal(d.lineups.home.subs[0].min, 31); assert.equal(d.lineups.away.xi.find(p => p.name === 'Gallagher').yc, 1);
// fetch: man utd v spurs fetched and merged with stats; chelsea v bournemouth: events 404 -> not saved
const r = await hlFetch(s, { key: 'k', max: 5, dailyCap: 45 });
assert.equal(r.fetched, 2); assert.equal(r.saved, 1);
const sd = (await s.getDetail('EPL|2026|man utd|spurs')).data;
assert.equal(sd.stats[0].label, 'Total Shots'); assert.equal(sd.events.length, 4); assert.equal(sd.source, 'openmatchday'); assert.deepEqual(sd.halftime, { home: 0, away: 1 });
const again = await hlFetch(s, { key: 'k', max: 5, dailyCap: 45 }); assert.equal(again.fetched, 0);       // the 404 one is marked as failed for good, the saved one is done
const s2 = createMemoryStore(); await s2.upsertMatches([row('EPL|2026|man utd|spurs', 'Manchester United', 'Tottenham Hotspur', 1, 1)]); await hlList(s2, { key: 'k', league: 'EPL' });
const capped = await hlFetch(s2, { key: 'k', max: 5, dailyCap: 0 }); assert.equal(capped.fetched, 0); assert.match(capped.summary, /daily limit/);
// other sources are never overwritten
await s.saveManualDetail('EPL|2026|chelsea|bournemouth', { v: 1, source: 'api-football', events: [], lineups: {}, stats: [] });
assert.equal(await applyHl(s, row('EPL|2026|chelsea|bournemouth', 'Chelsea', 'AFC Bournemouth', 5, 1), d), 'goals-differ');
assert.equal(await applyHl(s, row('EPL|2026|chelsea|bournemouth', 'Chelsea', 'AFC Bournemouth', 1, 1), d), 'kept');
console.log('highlightly tests: 14 passed');
// status panel
import { hlStatus } from '../lib/highlightly-status.js';
const st = await hlStatus(s, { now: Date.now() });
const epl = st.leagues.find(x => x.league === 'EPL');
assert.equal(epl.finished, 2); assert.equal(epl.done, 1); assert.equal(epl.kept, 1);
const done = st.matches.find(x => x.status === 'done'); assert.equal(done.counts.goals, 2); assert.ok(done.events.some(e => e.includes('assist')));
assert.equal(st.requests.fetchedToday, 2); assert.equal(st.requests.requestsToday, 4); assert.ok(st.lastFetchAt); assert.equal(st.log.length, 2);
console.log('highlightly status tests: 6 passed');
