import assert from 'node:assert/strict';
import { buildTeam } from '../lib/team-view.js';
import { clearPlayerCache } from '../lib/player-card.js';
const M = (date, home, away, hg, ag) => ({ id: `EPL|2026|${date}|${home.toLowerCase()}|${away.toLowerCase()}`, league: 'EPL', season: 2026, date, home, away, hg, ag, status: 'finished' });
const ms = [M('2026-10-01', 'Arsenal', 'Chelsea', 2, 0), M('2026-10-20', 'Everton', 'Arsenal', 1, 1)];
const grid = ['1:1', '2:1', '2:2', '2:3', '2:4', '3:1', '3:2', '4:1', '4:2', '4:3', '5:1'];   // 4-2-3-1 → rows 1 (GK), 2 (4), 3 (2), 4 (3), 5 (1)
const names = ['Raya', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'Saka'];
const xi = names.map((name, i) => ({ id: 100 + i, n: i + 1, name, pos: i === 0 ? 'G' : i < 5 ? 'D' : i < 8 ? 'M' : 'F', min: 90, rating: i === 10 ? 8 : 7, g: i === 10 ? 1 : 0, a: 0, grid: grid[i] }));
const old = xi.map(p => ({ ...p, name: p.name === 'Saka' ? 'Trossard' : p.name }));
const dets = [{ match_id: ms[0].id, data: { events: [], lineups: { home: { xi: old, subs: [], formation: null }, away: { xi: [], subs: [] } } } }, { match_id: ms[1].id, data: { events: [], lineups: { home: { xi: [], subs: [] }, away: { xi, subs: [], formation: null } } } }];
const store = { listMatches: async () => ms, listDetailsLike: async () => dets, listPlayers: async () => [], listApiSquads: async () => [], listCoaches: async () => [], listTeamIds: async () => [], listAliases: async () => [] };
clearPlayerCache();
const v = await buildTeam(store, 'Arsenal', '2026-11-11');
const x = v.overview.xi;
assert.equal(x.last, true); assert.equal(x.formation, '4-2-3-1', 'worked out from the grid when the source has none');
assert.equal(x.lines.length, 5); assert.equal(x.lines[0][0].name, 'Saka', 'attack first'); assert.equal(x.lines[4][0].name, 'Raya', 'goalkeeper last');
assert.equal(x.vs, 'Everton'); assert.equal(x.lines[0][0].goals, 1);
console.log('ok');
