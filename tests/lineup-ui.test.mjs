// node tests/lineup-ui.test.mjs  — the line-up screen pieces in index.html, run with small stand-ins for the page's helpers
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('const MV_SIL'), html.indexOf('/* ---- Table */'));
const escapeHtml = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const mvRt = r => `<b class="mv-rt">${Number(r).toFixed(1)}</b>`;
const clubMark = n => `[${n}]`, mvNoDetail = () => 'NO DETAIL';
const mvMin = e => (e.m == null ? '' : e.m + (e.x ? '+' + e.x : '') + "'");
const f = new Function('escapeHtml', 'mvRt', 'clubMark', 'mvNoDetail', 'mvMin', src + '; return { mvSameName, mvSubMinutes, mvAv, mvLineupHtml, mvSurname };');
const { mvSameName, mvSubMinutes, mvAv, mvLineupHtml, mvSurname } = f(escapeHtml, mvRt, clubMark, mvNoDetail, mvMin);
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };

t('names: initial vs full name', () => { assert(mvSameName('B. Barcola', 'Bradley Barcola')); assert(mvSameName('J. Strand Larsen', 'Jörgen Strand Larsen')); assert(mvSameName('Víctor Muñoz', 'Victor Munoz')); assert(!mvSameName('J. Gomez', 'Joe Willock')); assert(!mvSameName('M. Silva', 'Bernardo Silva')); });
t('surname drops the initial', () => { assert.equal(mvSurname('J. Strand Larsen'), 'Strand Larsen'); assert.equal(mvSurname('Víctor Muñoz'), 'Víctor Muñoz'); });
const xi = [{ id: 2864, n: 9, name: 'A. Isak', min: 89, rating: 7.75, g: 1 }, { id: 161904, n: 29, name: 'B. Barcola', min: 69, rating: 6.9, yc: 1, a: 1 }];
const subs = [{ id: 338751, n: 23, name: 'Víctor Muñoz', min: 21, rating: 6.75, pos: 'F' }, { id: 1600, n: 21, name: 'K. Tsimikas', min: 0, rating: 0, pos: 'D' }, { id: null, n: 3, name: 'W. Endo', min: 0, rating: 0, pos: 'M' }];
const events = [{ type: 'subst', side: 'away', m: 69, x: 0, player: 'Bradley Barcola', other: 'Víctor Muñoz' }, { type: 'subst', side: 'away', m: 90, x: 1, player: 'Alexander Isak', other: 'Joe Gomez' }];
const L = { formation: '4-2-3-1', coach: 'A. Iraola', xi, subs };
t('substitution minutes', () => { const m = mvSubMinutes({ events }, 'away', L); assert.equal(m.off.get(xi[1]), "69'"); assert.equal(m.on.get(subs[0]), "69'"); assert.equal(m.off.get(xi[0]), "90+1'"); });
t('no rating for a player who did not play', () => { assert(!mvAv(subs[1]).includes('mv-rt')); assert(mvAv(subs[0]).includes('mv-rt')); assert(mvAv(xi[0]).includes('7.8') || mvAv(xi[0]).includes('7.7')); });
t('photo only with an id, blank portrait always underneath', () => { assert(mvAv(subs[2]).includes('mv-sil')); assert(!mvAv(subs[2]).includes('<img')); assert(mvAv(xi[0]).includes('players/2864.png')); });
t('line-up page: no green pitch, bench lists the unused', () => { const out = mvLineupHtml({ match: { home: 'Crystal Palace', away: 'Liverpool' }, detail: { events, lineups: { away: L } } }); assert(out.includes('Bench')); assert(out.includes('Subbed off')); assert(out.includes('Tsimikas')); assert(!/#1f4a33|#17382a/.test(html.slice(html.indexOf('.mv-pitch{'), html.indexOf('.mv-pitch{') + 300))); });
console.log(`lineup ui tests: ${n} passed`);
