// node tests/openmatchday.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../lib/bank-store.js';
import { parseCsv, convertRow, importOpenMatchday } from '../lib/openmatchday-import.js';
const csv = 'match_id,openmatchday_ft_home,openmatchday_ft_away,openmatchday_home_shots,openmatchday_away_shots,openmatchday_home_target,openmatchday_away_target,openmatchday_home_corners,openmatchday_away_corners,openmatchday_home_fouls,openmatchday_away_fouls,openmatchday_home_yellow,openmatchday_away_yellow,openmatchday_home_red,openmatchday_away_red,openmatchday_ht_home,openmatchday_ht_away,openmatchday_goal_minutes,note\n'
  + 'EPL|2026|a|b,2,1,10,5,4,2,6,3,9,12,1,2,0,0,1,0,"21,52,77","a, ""quoted"""\n'
  + 'EPL|2026|c|d,1,1,8,8,3,3,4,4,10,10,2,2,0,0,0,0,"10",x\n'
  + 'EPL|2026|e|f,3,0,8,8,3,3,4,4,10,10,2,2,0,0,0,0,"1,2,3",x\n';
const rows = parseCsv(csv); assert.equal(rows.length, 3); assert.equal(rows[0].note, 'a, "quoted"'); assert.equal(rows[0].openmatchday_goal_minutes, '21,52,77');
const m = (id, hg, ag) => ({ id, league: 'EPL', comp_name: 'Premier League', season: 2026, round: '', date: '2026-09-01', home: 'A', away: 'B', status: 'finished', hg, ag });
const s = createMemoryStore();
await s.upsertMatches([m('EPL|2026|a|b', 2, 1), m('EPL|2026|c|d', 1, 1), m('EPL|2026|e|f', 2, 0)]);   // e|f: our score differs
await s.saveManualDetail('EPL|2026|c|d', { v: 1, source: 'api-football', events: [], lineups: {}, stats: [] });   // fuller stats already there
const r = await importOpenMatchday(s, rows);
assert.equal(r.saved, 1); assert.equal(r.kept, 1); assert.equal(r.scoreDiffers, 1);
const d = (await s.getDetail('EPL|2026|a|b')).data;
assert.equal(d.source, 'openmatchday'); assert.equal(d.stats[0].label, 'Total Shots'); assert.deepEqual(d.halftime, { home: 1, away: 0 }); assert.deepEqual(d.goalMinutes, [21, 52, 77]);
assert.equal((await s.getDetail('EPL|2026|c|d')).data.source, 'api-football');
assert.equal(convertRow(rows[1], m('x', 1, 1)).goalMinutes, null);       // 1 minute listed for 2 goals: not kept
const again = await importOpenMatchday(s, rows); assert.equal(again.saved, 1);   // repeat is safe
console.log('openmatchday tests: 8 passed');
