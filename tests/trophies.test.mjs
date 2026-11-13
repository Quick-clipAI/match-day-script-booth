import assert from 'node:assert/strict';
import { trophiesFor } from '../lib/trophies.js';
const rows = [['UCL', '2023-24', 'Real Madrid'], ['UCL', '2021-22', 'Real Madrid'], ['USC', '2024', 'Real Madrid'], ['UCL', '2002-03', 'AC Milan'], ['UEL', '1990-91', 'Inter Milan'], ['UECL', '2023-24', 'Olympiacos'], ['UCL', '2014-15', 'Barcelona'], ['UEL', '1998-99', 'Parma']].map(([competition, season, club]) => ({ competition, season, club }));
const r = trophiesFor(rows, 'Real Madrid'); assert.deepEqual(r.map(x => [x.key, x.count]), [['UCL', 2], ['USC', 1]]); assert.deepEqual(r[0].seasons, ['2023-24', '2021-22'], 'newest first');
assert.equal(trophiesFor(rows, 'Milan')[0].count, 1); assert.equal(trophiesFor(rows, 'AC Milan')[0].count, 1);
assert.equal(trophiesFor(rows, 'Internazionale Milano')[0].key, 'UEL'); assert.equal(trophiesFor(rows, 'Olympiacos')[0].count, 1); assert.equal(trophiesFor(rows, 'Parma Calcio 1913')[0].key, 'UEL');
assert.deepEqual(trophiesFor(rows, 'Arsenal'), []); assert.equal(trophiesFor(rows, 'Barcelona')[0].count, 1);
console.log('ok');
{
  const { ROWS } = await import('../lib/data/domestic-trophies.js');
  const rows = ROWS.map(([competition, season, club]) => ({ competition, season, club }));
  const n = (club, key) => (trophiesFor(rows, club).find(x => x.key === key) || { count: 0 }).count;
  assert.equal(n('Liverpool', 'ENG'), 20); assert.equal(n('Manchester United', 'ENG'), 20); assert.equal(n('Arsenal', 'ENG'), 14); assert.equal(n('Leeds', 'ENG'), 3);
  assert.equal(n('Real Madrid', 'ESP'), 36); assert.equal(n('Barcelona', 'ESP'), 29); assert.equal(n('Athletic Club', 'ESP'), 8);
  assert.equal(n('Juventus', 'ITA'), 36); assert.equal(n('Internazionale Milano', 'ITA'), 21); assert.equal(n('Milan', 'ITA'), 19);
  assert.equal(n('Bayern München', 'GER'), 35); assert.equal(n('Borussia Dortmund', 'GER'), 8); assert.equal(n('Leverkusen', 'GER'), 1);
  assert.equal(n('Paris Saint-Germain', 'FRA'), 14); assert.equal(n('Marseille', 'FRA'), 9); assert.equal(n('Olympique Lyonnais', 'FRA'), 7);
  assert.equal(n('Al-Hilal Saudi', 'SPL'), 19); assert.equal(n('Al-Nassr', 'SPL'), 9); assert.equal(n('Inter Miami', 'MLSC'), 1);
  assert.equal(ROWS.filter(r => r[0] === 'ITA' && /2004-05|1926-27/.test(r[1])).length, 0, 'revoked Italian titles are not counted');
  console.log('ok domestic');
}
