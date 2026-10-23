// node tests/matchview.test.mjs
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/bank-store.js';
import { syncDue } from '../lib/sync-due.js';
import { compactDetail, syncDetails } from '../lib/match-detail.js';
import { buildTable, buildBracket, buildView, findMatch, zoneFor, stageOf } from '../lib/match-view.js';
const NOW = Date.parse('2026-10-22T23:00:00Z');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const m = (o) => ({ id: `${o.league || 'UCL'}|2026|${o.date}|${o.home.toLowerCase()}|${o.away.toLowerCase()}`, league: 'UCL', comp_name: 'x', season: 2026, round: null, time: null, kickoff: null, hg: null, ag: null, ht_h: null, ht_a: null, status: 'scheduled', note: null, source: 'paste', verified: false, conflict: null, ...o });

const FULL = { fixture: { id: 1635702, referee: 'A. Ref', venue: { name: 'Parc des Princes', city: 'Paris' }, status: { short: 'FT' } }, teams: { home: { id: 85, name: 'Paris Saint Germain' }, away: { id: 529, name: 'Barcelona' } },
  events: [{ time: { elapsed: 38, extra: null }, team: { id: 85 }, player: { name: 'Doue' }, assist: { name: 'Neves' }, type: 'Goal', detail: 'Normal Goal' }, { time: { elapsed: 27, extra: null }, team: { id: 529 }, player: { name: 'Olmo' }, assist: { name: 'Fermin' }, type: 'subst', detail: 'Substitution 1' }, { time: { elapsed: 9 }, team: { id: 999 }, player: { name: 'Ghost' }, type: 'Goal', detail: 'x' }],
  lineups: [{ team: { id: 85 }, formation: '4-3-3', coach: { name: 'Luis Enrique' }, startXI: [{ player: { id: 153, name: 'O. Dembele', number: 10, pos: 'F', grid: '4:3' } }], substitutes: [{ player: { id: 9, name: 'Sub', number: 12, pos: 'M', grid: null } }] }, { team: { id: 529 }, formation: '4-2-3-1', coach: { name: 'H. Flick' }, startXI: [{ player: { id: 7, name: 'Raphinha', number: 11, pos: 'F', grid: '4:4' } }], substitutes: [] }],
  statistics: [{ team: { id: 85 }, statistics: [{ type: 'Ball Possession', value: '47%' }, { type: 'Total Shots', value: 22 }, { type: 'Red Cards', value: null }] }, { team: { id: 529 }, statistics: [{ type: 'Ball Possession', value: '53%' }, { type: 'Total Shots', value: 18 }, { type: 'Red Cards', value: null }] }],
  players: [{ team: { id: 85 }, players: [{ player: { id: 153 }, statistics: [{ games: { minutes: 20, rating: '6.69' }, goals: { total: 1, assists: null }, cards: { yellow: 1, red: 0 } }] }] }, { team: { id: 529 }, players: [{ player: { id: 7 }, statistics: [{ games: { minutes: 90, rating: '7.80' }, goals: { total: null, assists: 2 }, cards: {} }] }] }] };

await t('compactDetail: sides, events, line-ups with ratings, paired stats, best player', () => {
  const d = compactDetail(FULL, '2026-10-22T23:00:00Z');
  assert.equal(d.events.length, 2, 'event for an unknown team is dropped');
  assert.equal(d.events[0].side, 'home'); assert.equal(d.events[1].type, 'subst'); assert.equal(d.events[1].other, 'Fermin');
  assert.equal(d.lineups.home.formation, '4-3-3'); assert.equal(d.lineups.home.coach, 'Luis Enrique');
  const dem = d.lineups.home.xi[0]; assert.equal(dem.rating, 6.69); assert.equal(dem.g, 1); assert.equal(dem.yc, 1); assert.equal(dem.grid, '4:3');
  assert.deepEqual(d.stats[0], { label: 'Ball Possession', home: '47%', away: '53%' }); assert.equal(d.stats[2].home, 0);
  assert.equal(d.best.name, 'Raphinha'); assert.equal(d.best.side, 'away'); assert.equal(d.venue.name, 'Parc des Princes');
});
await t('compactDetail: an answer with nothing in it is marked unavailable', () => {
  const d = compactDetail({ teams: { home: { id: 1 }, away: { id: 2 } }, events: [], lineups: [], statistics: [], players: [] }); assert.equal(d.unavailable, true);
  assert.equal(compactDetail(null), null);
});
await t('syncDue records the API fixture id; syncDetails fetches once, 1 request, then never again', async () => {
  const s = createMemoryStore(); await s.upsertMatches([m({ date: '2026-10-22', home: 'Paris Saint-Germain', away: 'Barcelona', kickoff: '2026-10-22T19:00:00Z' })]);
  const getFixtures = async () => ({ response: [{ fixture: { id: 1635702, date: '2026-10-22T19:00:00+00:00', status: { short: 'FT' } }, league: { name: 'x', country: 'World' }, teams: { home: { name: 'Paris Saint Germain' }, away: { name: 'FC Barcelona' } }, goals: { home: 4, away: 2 }, score: { halftime: { home: 1, away: 0 }, penalty: {} } }] });
  await syncDue(s, { getFixtures, now: NOW });
  const id = (await s.listMatches({}))[0].id;
  assert.equal((await s.getDetail(id)).api_fixture_id, 1635702); assert.equal((await s.getDetail(id)).data, null);
  const calls = []; const getDetail = async (i) => { calls.push(i); return { response: [FULL] }; };
  const r = await syncDetails(s, { getDetail, now: NOW }); assert.equal(r.calls, 1); assert.equal(r.saved, 1); assert.deepEqual(calls, [1635702]);
  const r2 = await syncDetails(s, { getDetail, now: NOW + 60000 }); assert.equal(r2.calls, 0, 'already saved');
  assert.equal((await s.getDetail(id)).data.lineups.home.formation, '4-3-3');
});
await t('an API error stops the loop and pauses details for an hour (cannot burn the daily quota)', async () => {
  const s = createMemoryStore(); await s.addDetailStubs([{ match_id: 'a', api_fixture_id: 1 }, { match_id: 'b', api_fixture_id: 2 }, { match_id: 'c', api_fixture_id: 3 }]);
  let calls = 0; const getDetail = async () => { calls++; return { errors: { requests: 'You have reached the request limit for the day' }, response: [] }; };
  const r = await syncDetails(s, { getDetail, now: NOW }); assert.equal(calls, 1); assert.equal(r.saved, 0);
  const r2 = await syncDetails(s, { getDetail, now: NOW + 20 * 60000 }); assert.equal(calls, 1, 'paused'); assert.match(r2.summary, /paused/);
  const r3 = await syncDetails(s, { getDetail, now: NOW + 90 * 60000 }); assert.equal(calls, 2, 'tries again after an hour');
});
await t('an empty answer for a fixture is stored as unavailable and not asked again', async () => {
  const s = createMemoryStore(); await s.addDetailStubs([{ match_id: 'a', api_fixture_id: 1 }]);
  await syncDetails(s, { getDetail: async () => ({ errors: [], response: [] }), now: NOW }); assert.equal((await s.getDetail('a')).data.unavailable, true);
  assert.equal((await syncDetails(s, { getDetail: async () => assert.fail('no'), now: NOW + 1 })).calls, 0);
});
await t('stubs older than 3 days are not chased', async () => {
  const s = createMemoryStore(); await s.addDetailStubs([{ match_id: 'a', api_fixture_id: 1 }]);
  const r = await syncDetails(s, { getDetail: async () => assert.fail('no'), now: Date.now() + 5 * 864e5 }); assert.equal(r.calls, 0);
});

// ---- tables
const teams20 = Array.from({ length: 20 }, (_, i) => 'Club' + String.fromCharCode(65 + i));
function leagueRows() { const out = []; let k = 0; for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) { out.push(m({ league: 'EPL', id: 'EPL|2026|' + k++, date: '2026-09-01', home: teams20[i], away: teams20[j], status: 'finished', hg: 2, ag: 0 })); } return out; }
await t('league table: positions, zones (1-4 UCL, 5 UEL, 6 UECL, last 3 relegation), highlight data, final flag', () => {
  const rows = leagueRows(); const tb = buildTable(rows, rows[0]);
  assert.equal(tb.rows.length, 20); assert.equal(tb.rows[0].team, 'ClubA'); assert.equal(tb.rows[0].zone, 'ucl'); assert.equal(tb.rows[3].zone, 'ucl'); assert.equal(tb.rows[4].zone, 'uel'); assert.equal(tb.rows[5].zone, 'uecl'); assert.equal(tb.rows[6].zone, null);
  assert.equal(tb.rows[17].zone, 'rel'); assert.equal(tb.rows[19].zone, 'rel'); assert.equal(tb.rows[16].zone, null);
  assert.equal(tb.complete, false, 'only half the matches exist (one leg each)'); assert.match(tb.note, /so far/);
  assert.deepEqual(tb.legend.map(l => l.key), ['ucl', 'uel', 'uecl', 'rel']);
});
await t('Bundesliga: 16th play-off, last 2 relegated (18 clubs)', () => {
  assert.equal(zoneFor('BUNDESLIGA', 16, 18), 'po'); assert.equal(zoneFor('BUNDESLIGA', 17, 18), 'rel'); assert.equal(zoneFor('BUNDESLIGA', 18, 18), 'rel'); assert.equal(zoneFor('BUNDESLIGA', 15, 18), null);
});
await t('Champions League league phase: 1-8 qualified, 9-24 play-offs, 25+ eliminated; only league-phase rounds count', () => {
  const ts = Array.from({ length: 36 }, (_, i) => 'T' + String(i).padStart(2, '0')); const rows = [];
  for (let i = 0; i < 36; i += 2) rows.push(m({ id: 'u' + i, date: '2026-09-16', round: 'Matchday 1', home: ts[i], away: ts[i + 1], status: 'finished', hg: 1, ag: 0 }));
  rows.push(m({ id: 'ko', date: '2027-02-17', round: 'Knockout Round Play-offs', home: 'T00', away: 'T02', status: 'finished', hg: 5, ag: 0 }));
  const tb = buildTable(rows, rows[0]);
  assert.equal(tb.rows.length, 36, 'the play-off tie is not in the league table'); assert.equal(tb.rows[0].zone, 'q'); assert.equal(tb.rows[7].zone, 'q'); assert.equal(tb.rows[8].zone, 'po'); assert.equal(tb.rows[23].zone, 'po'); assert.equal(tb.rows[24].zone, 'out'); assert.equal(tb.rows[35].zone, 'out');
  assert.equal(tb.complete, false); assert.equal(tb.rows[0].P, 1);
});
await t('no table for a friendly / Inter Miami', () => { assert.equal(buildTable([m({ league: 'INTERMIAMI', date: '2026-01-01', home: 'Inter Miami', away: 'X' })], { league: 'INTERMIAMI', season: 2026 }), null); });

// ---- bracket
await t('stageOf names', () => { assert.equal(stageOf('Knockout Round Play-offs'), 'Play-offs'); assert.equal(stageOf('Round of 16'), 'Round of 16'); assert.equal(stageOf('Quarter-finals'), 'Quarter-finals'); assert.equal(stageOf('Final'), 'Final'); assert.equal(stageOf('Matchday 3'), null); });
await t('bracket: two legs become one tie with an aggregate; empty when no knockout matches exist', () => {
  const ko = [m({ id: 'l1', date: '2027-03-10', round: 'Round of 16', home: 'PSG', away: 'Barca', status: 'finished', hg: 2, ag: 1 }), m({ id: 'l2', date: '2027-03-17', round: 'Round of 16', home: 'Barca', away: 'PSG', status: 'finished', hg: 1, ag: 1 }), m({ id: 'l3', date: '2027-03-10', round: 'Round of 16', home: 'A', away: 'B' })];
  const b = buildBracket(ko, { league: 'UCL', round: 'Round of 16' });
  assert.equal(b.stages.length, 1); assert.equal(b.stages[0].ties.length, 2);
  const tie = b.stages[0].ties.find(x => x.a === 'PSG'); assert.deepEqual(tie.agg, { a: 3, b: 2 }); assert.equal(tie.legs.length, 2); assert.equal(tie.decided, true);
  assert.equal(b.stages[0].ties.find(x => x.a === 'A').agg, null);
  assert.deepEqual(buildBracket([m({ date: '2026-09-16', round: 'Matchday 1', home: 'A', away: 'B' })], { league: 'UCL' }).stages, []);
  assert.equal(buildBracket([], { league: 'EPL' }), null);
});

// ---- view
await t('buildView: states upcoming / none / pending / ok / unavailable; lookup by id and by date+names', async () => {
  const s = createMemoryStore(); const a = m({ date: '2026-10-20', round: 'Matchday 3', home: 'Paris Saint-Germain', away: 'Barcelona', status: 'finished', hg: 4, ag: 2 }), up = m({ date: '2026-12-01', round: 'Matchday 6', home: 'Paris Saint-Germain', away: 'Chelsea' });
  await s.upsertMatches([a, up]);
  assert.equal((await buildView(s, up)).detailState, 'upcoming'); assert.equal((await buildView(s, a)).detailState, 'none');
  await s.addDetailStubs([{ match_id: a.id, api_fixture_id: 5 }]); assert.equal((await buildView(s, a)).detailState, 'pending');
  await s.saveDetail(a.id, compactDetail(FULL)); const v = await buildView(s, a); assert.equal(v.detailState, 'ok'); assert.equal(v.detail.stats.length, 3); assert.equal(v.match.hg, 4); assert.ok(v.table);
  assert.equal((await buildView(s, up)).match.hg, null, 'no score is shown for an upcoming match');
  assert.equal((await findMatch(s, { id: a.id })).home, 'Paris Saint-Germain'); assert.equal((await findMatch(s, { date: '2026-10-20', home: 'paris saint germain', away: 'barcelona' })).id, a.id); assert.equal(await findMatch(s, { id: 'nope' }), null);
  await s.saveDetail(a.id, { v: 1, unavailable: true }); assert.equal((await buildView(s, a)).detailState, 'unavailable');
});
console.log(n + ' match-view tests passed');
