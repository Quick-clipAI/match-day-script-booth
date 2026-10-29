// node tests/suspects.test.mjs
import assert from 'node:assert/strict';
import { clubSuspects } from '../lib/club-suspects.js';
const c = (club, matches = 5) => ({ club, matches, last_season: 2026 });
const found = (clubs, matches = [], d) => clubSuspects(clubs, matches, d).map(x => x.a + '|' + x.b);
assert.deepEqual(found([c('Celta'), c('Celta Vigo'), c('Real Madrid')]), ['Celta|Celta Vigo']);
assert.deepEqual(found([c('Atlético de Madrid'), c('Atletico Madrid')]), ['Atlético de Madrid|Atletico Madrid']);
assert.deepEqual(found([c('Al Taawoun'), c('Al Taawon')]), ['Al Taawoun|Al Taawon']);
assert.deepEqual(found([c('Real Madrid'), c('Real Sociedad'), c('Barcelona')]), []);
assert.deepEqual(found([c('Celta'), c('Celta Vigo')], [{ home: 'Celta', away: 'Celta Vigo' }]), []);          // they play each other
assert.deepEqual(found([c('Al Taawoun'), c('Al Taawon')], [], new Set(['Al Taawon\u0001Al Taawoun'])), []);   // dismissed
assert.deepEqual(found([c('Union Berlin'), c('Union SG')]), []);                                              // different words
console.log('7 suspect tests passed');
