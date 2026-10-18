// Run: node tests/matcher.test.mjs   (exits 1 on any failure)
import fs from 'fs';
import { norm, cleanDisplay, matchKnownClub } from '../lib/bank-core.js';
import { createMemoryStore } from '../lib/bank-store.js';
import { importText } from '../lib/bank-sync.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const K = names => new Map(names.map(n => [norm(n), n]));
// Paris FC must never become PSG, in either direction and with or without both in the file
ok(matchKnownClub('Paris FC', K(['Paris Saint Germain']), new Map()) === null, 'Paris FC is not PSG (PSG known)');
ok(matchKnownClub('Paris Saint-Germain FC', K(['Paris FC']), new Map()) === null, 'PSG is not Paris FC (Paris FC known)');
ok(matchKnownClub('Paris FC', K(['Paris FC', 'Paris Saint Germain']), new Map()) === 'Paris FC', 'exact Paris FC wins');
ok(cleanDisplay('Paris FC') === 'Paris FC' && cleanDisplay('Arsenal FC') === 'Arsenal', 'FC kept only for Paris FC');
// two different names in the same file are two clubs
ok(matchKnownClub('Foo Rovers', K(['Foo Rovers United']), new Map(), new Set([norm('Foo Rovers'), norm('Foo Rovers United')])) === null, 'same-file names stay apart');
ok(matchKnownClub('Leeds', K(['Leeds United']), new Map()) === 'Leeds United', 'Leeds -> Leeds United still works');
ok(matchKnownClub('Celta Vigo', K(['Celta']), new Map()) === 'Celta', 'Celta Vigo -> Celta still works');
ok(matchKnownClub('Guinea', K(['Equatorial Guinea']), new Map()) === null, 'Guinea is not Equatorial Guinea');
// spelling pairs between sources
for (const [a, b] of [['Dinamo Zagreb', 'GNK Dinamo'], ['Union St. Gilloise', 'Union SG'], ['Sparta Prague', 'Sparta Praha'], ['Slavia Prague', 'Slavia Praha'], ['Lillestrom', 'Lillestrøm'], ['Bodo/Glimt', 'Bodø/Glimt'], ['NEC Nijmegen', 'N.E.C. Nijmegen'], ['Olympiakos', 'Olympiacos'], ['Olympique Lyonnais', 'Lyon'], ['Hapoel Be-er Sheva', 'Hapoel Beer-Sheva']]) {
  ok(matchKnownClub(a, K([b]), new Map()) === b, a + ' -> ' + b);
  ok(matchKnownClub(b, K([a]), new Map()) === a, b + ' -> ' + a);
}
ok(matchKnownClub('N.E.C.', K(['N.E.C. Nijmegen']), new Map(), new Set([norm('N.E.C.'), norm('N.E.C. Nijmegen')])) === 'N.E.C. Nijmegen', 'N.E.C. and N.E.C. Nijmegen in one file merge');
// the real Ligue 1 file (skipped if the file is not next to this test)
const f = new URL('./fixtures/fr.1.2026-27.json', import.meta.url);
if (fs.existsSync(f)) {
  const store = createMemoryStore();
  await importText(store, { text: fs.readFileSync(f, 'utf8'), league: 'LIGUE1', season: 2026, dryRun: false, today: '2026-10-17' });
  const ms = await store.listMatches({ league: 'LIGUE1', season: 2026 }); const c = {};
  ms.forEach(m => { c[m.home] = (c[m.home] || 0) + 1; c[m.away] = (c[m.away] || 0) + 1; });
  ok(ms.length === 306 && Object.keys(c).length === 18 && Object.values(c).every(v => v === 34), 'Ligue 1: 306 matches, 18 clubs, 34 each');
  ok(!!c['Paris FC'] && !!c['Paris Saint-Germain'] && ms.every(m => m.home !== m.away), 'Paris FC and PSG are separate; no club plays itself');
}
console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
