import assert from 'node:assert/strict';
import { cardStates } from '../lib/match-view.js';
const matches = { 'EPL|2026|liverpool|manchester united': { id: 'EPL|2026|liverpool|manchester united', league: 'EPL', home: 'Liverpool', away: 'Manchester United', date: '2026-11-21', time: '15:00', status: 'finished', hg: 2, ag: 1, round: 'Matchday 11' } };
const store = { getMatch: async id => matches[id] || null, listMatches: async () => Object.values(matches), listTeamIds: async () => [{ club: 'Liverpool', api_name: 'Liverpool', api_team_id: 40 }], listAliases: async () => [] };
const r = await cardStates(store, [{ k: 'a', id: 'EPL|2026|liverpool|manchester united', home: 'Liverpool', away: 'Manchester United' }, { k: 'b', date: '2026-11-21', home: 'Liverpool', away: 'Manchester United' }, { k: 'c', id: 'nope', home: 'X', away: 'Y' }, { home: 'no key' }]);
assert.equal(r.cards.a.status, 'finished'); assert.equal(r.cards.a.hg, 2); assert.equal(r.cards.b.ag, 1, 'found by date and names when the card has no id');
assert.equal(r.cards.c, undefined, 'an unknown match is left alone'); assert.equal(r.crests.Liverpool, 40);
assert.equal((await cardStates(store, 'junk')).cards && Object.keys((await cardStates(store, 'junk')).cards).length, 0);
console.log('cardstate tests: 5 passed');
