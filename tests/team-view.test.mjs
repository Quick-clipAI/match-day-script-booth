// node tests/team-view.test.mjs  - the team screen's data: matches over two competitions, tables with me flag, best XI, squad
import assert from 'node:assert/strict';
import { buildTeam } from '../lib/team-view.js';
import { clearPlayerCache } from '../lib/player-card.js';
const M = (lg, date, home, away, hg, ag, status = 'finished') => ({ id: `${lg}|2026|${home.toLowerCase()}|${away.toLowerCase()}`, league: lg, season: 2026, date, time: '15:00', home, away, hg, ag, status, round: 'Regular Season' });
const matches = {
  EPL: [M('EPL', '2026-08-15', 'Arsenal', 'Chelsea', 2, 1), M('EPL', '2026-09-12', 'Chelsea', 'Arsenal', 0, 0), M('EPL', '2026-11-21', 'Arsenal', 'Everton', null, null, 'scheduled')],
  UCL: [M('UCL', '2026-09-20', 'Arsenal', 'PSG', 1, 3)] };
const pl = (n, pos, rating, g = 0, id) => ({ n: id, id, name: n, pos, min: 90, rating, g, a: 0 });
const detail = (id, home, away, xi, side = 'home') => ({ match_id: id, data: { events: [], lineups: { home: { xi: side === 'home' ? xi : [], subs: [] }, away: { xi: side === 'away' ? xi : [], subs: [] } } } });
const xi = [pl('Raya', 'G', 7.0, 0, 1), pl('Saliba', 'D', 7.4, 0, 2), pl('Gabriel', 'D', 7.1, 0, 3), pl('Rice', 'M', 7.6, 0, 4), pl('B. Saka', 'F', 8.0, 1, 5)];
const dets = [detail('EPL|2026|arsenal|chelsea', 'Arsenal', 'Chelsea', xi), detail('EPL|2026|chelsea|arsenal', 'Chelsea', 'Arsenal', xi, 'away')];
const store = {
  listMatches: async ({ league }) => matches[league] || [], listDetailsLike: async p => dets.filter(d => d.match_id.startsWith(p)),
  listPlayers: async () => [{ club: 'Arsenal', league: 'EPL', season: 2026, name: 'Bukayo Saka', position: 'Forward', shirt: 7, dob: '2001-09-05', nationality: 'England' }, { club: 'Arsenal', league: 'EPL', season: 2026, name: 'David Raya', position: 'Goalkeeper', shirt: 22, dob: '1995-09-15', nationality: 'Spain' }, { club: 'Chelsea', league: 'EPL', season: 2026, name: 'X Y', position: 'Defender' }, { club: 'Arsenal', league: 'EPL', season: 2026, name: 'No Position', position: null }],
  listCoaches: async () => [{ club: 'Arsenal', league: 'EPL', season: 2026, name: 'Mikel Arteta', nationality: 'Spain' }],
  listTeamIds: async () => [{ club: 'Arsenal', api_name: 'Arsenal', api_team_id: 42 }], listAliases: async () => [] };
clearPlayerCache();
const v = await buildTeam(store, 'Arsenal', '2026-11-11');
assert.equal(v.club, 'Arsenal'); assert.equal(v.crest, 42);
assert.deepEqual(v.competitions.map(c => c.key), ['EPL', 'UCL'], 'domestic league first');
assert.equal(v.fixtures.length, 4); assert.equal(v.overview.next.away, 'Everton');
assert.deepEqual(v.overview.form, ['W', 'D', 'L'], 'oldest first across competitions');
const t = v.tables.find(x => x.key === 'EPL').table; assert.equal(t.rows.filter(r => r.me).length, 1); assert.equal(t.rows.find(r => r.me).team, 'Arsenal');
assert.equal(v.stats.competitions[0].W, 1); assert.equal(v.stats.competitions[0].cleanSheets, 1);
assert.equal(v.overview.xi.lines[0][0].name, 'B. Saka'); assert.equal(v.overview.xi.lines[3][0].name, 'Raya');
assert.equal(v.squad.length, 3, 'a player with no position does not break the screen'); assert.equal(v.squad.find(g => g.group === 'Forwards').players[0].pid, 5, 'photo id from the line-up');
assert.equal(v.overview.coach.name, 'Mikel Arteta');
assert.equal(await buildTeam(store, 'Nobody FC', '2026-11-11'), null);
console.log('ok');
