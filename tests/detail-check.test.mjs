import assert from 'node:assert/strict';
import { checkDetail, findPlayer } from '../lib/detail-check.js';
const squad = ['Daniel Muñoz', 'Jean-Philippe Mateta', 'Dean Henderson', 'Ismaïla Sarr'];
assert.equal(findPlayer('Daniel Munoz', squad).kind, 'exact');
assert.equal(findPlayer('D. Muñoz', squad).name, 'Daniel Muñoz');
assert.equal(findPlayer('Jean Philippe Mateta', squad).name, 'Jean-Philippe Mateta');
assert.equal(findPlayer('Ismaila Sar', squad).name, 'Ismaïla Sarr');
assert.equal(findPlayer('Nobody Atall', squad), null);
const P = (name, n, extra = {}) => ({ name, n, pos: 'M', ...extra });
const xi = [P('Dean Henderson', 1), P('Daniel Muñoz', 2), P('J. Mateta', 9), P('Brand New', 10), ...Array.from({ length: 7 }, (_, i) => P('Filler ' + i, 20 + i))];
const item = { league: 'UEL', date: '2026-11-26', home: 'Crystal Palace', away: 'Ajax', score: { hg: 2, ag: 1 },
  lineups: { home: { coach: 'Oliver Glasner', xi, subs: [] }, away: { coach: 'Someone', xi: xi.slice(0, 10), subs: [P('Filler 0', 20)] } },
  events: [{ minute: 30, team: 'home', type: 'sub', on: 'Ghost Player', off: 'Daniel Muñoz' }, { minute: 50, team: 'home', type: 'yellow', player: 'Daniel Muñoz' }], stats: { yellow_cards: [0, 0] } };
const out = checkDetail(item, { hg: 0, ag: 0, date: '2026-11-26' }, { squads: { home: squad, away: null }, coaches: { home: 'Glasner', away: null } });
const txt = out.map(o => o.text).join('\n');
assert.match(txt, /Score differs/); assert.match(txt, /not in our squad list: .*Brand New/); assert.match(txt, /spelled differently.*J. Mateta → Jean-Philippe Mateta/);
assert.match(txt, /Ajax: 10 starters, not 11/); assert.match(txt, /no squad for this club/); assert.match(txt, /Ghost Player/); assert.match(txt, /Events after the player left/); assert.match(txt, /Yellow cards: the statistics say 0, the events list 1/);
assert.ok(!/coach is/.test(txt), 'Glasner = Oliver Glasner');
assert.ok(checkDetail({ ...item, lineups: {} , events: [] }, null, {}).every(o => o.level === 'info'));
console.log('detail-check tests ok');
