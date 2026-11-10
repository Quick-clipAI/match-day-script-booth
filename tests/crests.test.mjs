import assert from 'node:assert/strict';
import { crestIds, crestKey } from '../lib/crests.js';
const rows = [
  { club: 'RB Leipzig', api_name: 'RB Leipzig', api_team_id: 173 }, { club: 'AS Roma', api_name: 'AS Roma', api_team_id: 497 },
  { club: 'VfB Stuttgart', api_name: 'VfB Stuttgart', api_team_id: 172 }, { club: 'AC Milan', api_name: 'AC Milan', api_team_id: 489 },
  { club: 'Celta Vigo', api_name: 'Celta Vigo', api_team_id: 538 }, { club: 'Internazionale Milano', api_name: 'Inter', api_team_id: 505 },
  { club: 'Inter Miami', api_name: 'Inter Miami', api_team_id: 9568 }, { club: 'Union Berlin', api_name: 'Union Berlin', api_team_id: 182 },
  { club: 'Real Madrid', api_name: 'Real Madrid', api_team_id: 541 }, { club: 'Real Sociedad', api_name: 'Real Sociedad', api_team_id: 548 },
  { club: 'Alpha', api_name: 'Alpha', api_team_id: 1 }, { club: 'FC Alpha', api_name: 'FC Alpha', api_team_id: 2 }];
const store = { listTeamIds: async () => rows, listAliases: async () => [{ alias: 'celta', canonical: 'Celta Vigo' }] };
const r = await crestIds(store, ['Leipzig', 'Roma', 'Stuttgart', 'Milan', 'Celta', 'Inter', 'Real Madrid', 'Union SG', 'Benfica', 'Alpha', 'Inter Miami']);
assert.equal(r['Leipzig'], 173); assert.equal(r['Roma'], 497); assert.equal(r['Stuttgart'], 172); assert.equal(r['Milan'], 489);
assert.equal(r['Celta'], 538, 'alias');
assert.equal(r['Inter'], 505, 'api_name "Inter" matches Internazionale');
assert.equal(r['Real Madrid'], 541); assert.equal(r['Inter Miami'], 9568);
assert.equal(r['Union SG'], undefined, 'a different club must not get Union Berlin');
assert.equal(r['Benfica'], undefined, 'unknown club has no crest');
assert.equal(r['Alpha'], 1, 'exact name wins over a look-alike');
assert.equal(crestKey('TSG 1899 Hoffenheim'), 'hoffenheim');
console.log('crests tests: 11 passed');
