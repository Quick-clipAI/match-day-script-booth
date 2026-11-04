// node tests/striker-import.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { convertGame, findMatch, importStriker, posOf } from '../lib/striker-import.js';
import { buildStats } from '../lib/competition-view.js';
const pl = (id, team, name, o) => ({ player_id: id, name, team_id: team, starter: true, position: 'Center Defender', jersey: '5', minute_on: 0, minute_off: null, goals: 0, assists: 0, shots: 0, shots_on_target: 0, yellow_cards: 0, red_cards: 0, own_goals: 0, saves: null, ...o });
const game = { data: { game: { game_id: '1', date: '2026-10-21', home: { team_id: '110', name: 'Internazionale', score: 1 }, away: { team_id: '493', name: 'Shakhtar Donetsk', score: 0 }, venue: 'San Siro', city: 'Milano', attendance: 73352 },
  team_stats: [{ team_id: '110', possession_pct: 44.9, xg: 0.96, shots: 13, passes: 424, accurate_passes: 369, corners: 5 }, { team_id: '493', possession_pct: 55.1, xg: 1.03, shots: 12, passes: 533, accurate_passes: 484, corners: 4 }],
  players: [pl(1, '110', 'Josep Martinez', { position: 'Goalkeeper' }), pl(2, '110', 'Carlos Augusto', { goals: 1 }), pl(3, '110', 'Dimarco', { position: 'Left Midfielder', minute_off: 59 }),
    pl(4, '110', 'Mkhitaryan', { starter: false, position: null, minute_on: 75, assists: 1 }), pl(5, '110', 'Bench', { starter: false, position: null, minute_on: null }), pl(9, '493', 'Riznyk', { position: 'Goalkeeper' })] } };
const t = (n, f) => { try { f(); } catch (e) { console.log('FAIL', n, e.stack); process.exitCode = 1; } };
t('positions', () => { assert.equal(posOf('Goalkeeper').cls, 'G'); assert.equal(posOf('Center Left Defender').c, 1); assert.equal(posOf('Attacking Midfielder').r, 5); assert.equal(posOf('Right Back').cls, 'D'); });
const d = convertGame(game);
t('convert', () => {
  assert.equal(d.source, 'strikerapi'); assert.equal(d.venue.name, 'San Siro');
  assert.equal(d.stats.find(s => s.label === 'Ball Possession').home, '44.9%'); assert.equal(d.stats.find(s => s.label === 'Passes %').home, '87%');
  const h = d.lineups.home; assert.equal(h.xi.length, 3); assert.equal(h.xi[0].pos, 'G'); assert.equal(h.xi.find(p => p.name === 'Carlos Augusto').g, 1);
  assert.equal(h.xi.find(p => p.name === 'Dimarco').min, 59); assert.equal(h.subs.find(p => p.name === 'Mkhitaryan').min, 15); assert.equal(h.subs.find(p => p.name === 'Bench').min, null);
  assert.ok(h.xi.every(p => /^\d:\d$/.test(p.grid)) && !('_r' in h.xi[0]));
});
const m = (id, h, a, hg, ag) => ({ id, league: 'UCL', season: 2026, date: '2026-10-21', home: h, away: a, hg, ag, status: 'finished', round: 'Matchday 3', comp_name: 'UEFA Champions League', source: 'paste' });
t('find by names when date+score tie', () => {
  const list = [m('a', 'Internazionale Milano', 'Shakhtar Donetsk', 1, 0), m('b', 'Real Betis', 'Feyenoord', 1, 0)];
  assert.equal(findMatch(game.data.game, list).id, 'a');
  assert.equal(findMatch({ ...game.data.game, home: { name: 'Nobody', score: 1 }, away: { name: 'Else', score: 0 } }, list), null);
});
const s = createMemoryStore(); await s.upsertMatches([m('UCL|2026|2026-10-21|internazionale milano|shakhtar donetsk', 'Internazionale Milano', 'Shakhtar Donetsk', 1, 0)]);
await s.saveStriker({ tool: 'get_game', ok: true, game_id: '1', data: { data: game.data } });   // the real saved shape: StrikerAPI's own {data:{game,...}}
const r = await importStriker(s); t('import saves', () => { assert.equal(r.saved, 1); assert.equal(r.unmatched.length, 0); });
const r2 = await importStriker(s); t('re-import is safe', () => assert.equal(r2.saved, 1));
const keep = createMemoryStore(); await keep.upsertMatches([m('X', 'Internazionale Milano', 'Shakhtar Donetsk', 1, 0)]); await keep.saveManualDetail('X', { v: 1, events: [{ type: 'goal', side: 'home', player: 'Someone' }], lineups: {}, stats: [] });
await keep.saveStriker({ tool: 'get_game', ok: true, game_id: '1', data: { data: game.data } });
const k = await importStriker(keep); t('does not overwrite other details', () => { assert.equal(k.kept, 1); assert.equal(k.saved, 0); });
t('scorers and assists from player lines', () => {
  const all = [m('X', 'Internazionale Milano', 'Shakhtar Donetsk', 1, 0)]; const st = buildStats(all, [{ match_id: 'X', data: d }]);
  assert.equal(st.players.scorers[0].name, 'Carlos Augusto'); assert.equal(st.players.scorers[0].club, 'Internazionale Milano'); assert.equal(st.players.assists[0].name, 'Mkhitaryan'); assert.equal(st.players.matchesWithDetails, 1);
});
console.log('striker-import tests done');
