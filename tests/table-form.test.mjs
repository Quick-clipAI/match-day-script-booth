// node tests/table-form.test.mjs  - the league table carries each team's last five results (oldest first)
import assert from 'node:assert/strict';
import { formByTeam, buildTable } from '../lib/match-view.js';
const m = (date, home, away, hg, ag, status = 'finished') => ({ id: date + home, league: 'EPL', season: 2026, date, home, away, hg, ag, status });
const all = [m('2026-08-01', 'A', 'B', 2, 0), m('2026-08-08', 'B', 'C', 1, 1), m('2026-08-15', 'C', 'A', 0, 3), m('2026-08-22', 'A', 'B', 1, 2), m('2026-08-29', 'C', 'B', 0, 0, 'scheduled'),
  m('2026-09-05', 'A', 'C', 1, 1), m('2026-09-12', 'B', 'A', 0, 1), m('2026-09-19', 'A', 'C', 4, 0), m('2026-09-26', 'C', 'A', 2, 0)];
const f = formByTeam(all);
assert.deepEqual(f.get('A'), ['W', 'L', 'D', 'W', 'W'].slice(0, 0).concat(['L', 'D', 'W', 'W', 'L']));
assert.deepEqual(f.get('B'), ['L', 'D', 'W', 'L'].slice(0, 4));
assert.ok(!f.get('C').includes(undefined) && f.get('C').length <= 5);
const t = buildTable(all, { league: 'EPL', season: 2026 });
assert.deepEqual(t.rows.find(r => r.team === 'A').form, f.get('A'));
console.log('ok');
