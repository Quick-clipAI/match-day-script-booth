import assert from 'node:assert/strict';
import { trophiesFor } from '../lib/trophies.js';
const rows = [['UCL', '2023-24', 'Real Madrid'], ['UCL', '2021-22', 'Real Madrid'], ['USC', '2024', 'Real Madrid'], ['UCL', '2002-03', 'AC Milan'], ['UEL', '1990-91', 'Inter Milan'], ['UECL', '2023-24', 'Olympiacos'], ['UCL', '2014-15', 'Barcelona'], ['UEL', '1998-99', 'Parma']].map(([competition, season, club]) => ({ competition, season, club }));
const r = trophiesFor(rows, 'Real Madrid'); assert.deepEqual(r.map(x => [x.key, x.count]), [['UCL', 2], ['USC', 1]]); assert.deepEqual(r[0].seasons, ['2023-24', '2021-22'], 'newest first');
assert.equal(trophiesFor(rows, 'Milan')[0].count, 1); assert.equal(trophiesFor(rows, 'AC Milan')[0].count, 1);
assert.equal(trophiesFor(rows, 'Internazionale Milano')[0].key, 'UEL'); assert.equal(trophiesFor(rows, 'Olympiacos')[0].count, 1); assert.equal(trophiesFor(rows, 'Parma Calcio 1913')[0].key, 'UEL');
assert.deepEqual(trophiesFor(rows, 'Arsenal'), []); assert.equal(trophiesFor(rows, 'Barcelona')[0].count, 1);
console.log('ok');
