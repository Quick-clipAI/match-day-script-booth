// node tests/dossier.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { planContext } from '../lib/bank-context.js';
import { formLine, h2hLine } from '../lib/match-dossier.js';

const mk = (id, lg, season, date, home, away, hg, ag, status) => ({ id, league: lg, comp_name: lg === 'UCL' ? 'UEFA Champions League' : 'Premier League', season, round: '', date, time: '20:00', home, away, hg, ag, status });
const rows = [
  mk('a1', 'UCL', 2026, '2026-10-01', 'Paris Saint-Germain', 'Barcelona', 4, 2, 'finished'),
  mk('a2', 'UCL', 2026, '2026-10-20', 'Manchester City', 'Paris Saint-Germain', 1, 2, 'finished'),
  mk('a3', 'UCL', 2026, '2026-10-21', 'Villarreal', 'Barcelona', 0, 1, 'finished'),
  mk('a4', 'UCL', 2026, '2026-11-05', 'Paris Saint-Germain', 'Villarreal', null, null, 'scheduled'),
  mk('a5', 'UCL', 2025, '2025-12-01', 'Villarreal', 'Paris Saint-Germain', 1, 3, 'finished')
];
// form + h2h helpers
const f = formLine('Paris Saint-Germain', [rows]);
assert.match(f, /won the last 3/); assert.match(f, /W 2-1 at Manchester City/);
assert.match(h2hLine('Paris Saint-Germain', 'Villarreal', [rows]), /Stored meetings \(1\): Paris Saint-Germain 1 wins/);
assert.match(h2hLine('A', 'B', [rows]), /No earlier/);
// planContext: "biggest match" with no club named returns a briefing, not reputation
const s = createMemoryStore(); await s.upsertMatches(rows);
const out = await planContext('Which match are the biggest tonight?', '2026-11-05', s, {});
assert.ok(out.text.includes('UPCOMING MATCHES')); assert.match(out.text, /Paris Saint-Germain v Villarreal/);
assert.match(out.text, /Form, last/); assert.match(out.text, /NO injuries/);
// a follow-up league hint is used
const out2 = await planContext('what are the big games', '2026-11-05', s, { focus: 'UCL' });
assert.ok(out2.text.includes('UPCOMING MATCHES'));
// a club question is untouched
const out3 = await planContext('How is Barcelona doing', '2026-11-05', s, {});
assert.ok(!out3.text.includes('UPCOMING MATCHES'));
console.log('dossier tests: 6 passed');
