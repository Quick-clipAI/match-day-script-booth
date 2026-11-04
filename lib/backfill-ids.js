// lib/backfill-ids.js — one request learns the API-Football id of every match of a league season, so their details
// (events, line-ups, ratings) can then be fetched by syncDetails, 1 request each. Matches already answered are left alone.
import { norm } from './bank-core.js';
import { sameTeam, findFixture } from './sync-due.js';
import { LEAGUES, currentSeason } from './bank-core.js';

const DAY = 864e5;
export const BACKFILL_API = { UCL: 2, UEL: 3, UECL: 848 };

export async function backfillIds(store, { getSeasonFixtures, league = 'UCL', season, now = Date.now() } = {}) {
  const apiId = BACKFILL_API[league];
  if (!apiId) return { calls: 0, stubs: 0, summary: `no API league id known for ${league}` };
  const all = (await store.listMatches({ league, season })).filter(m => m.status === 'finished');
  const have = new Set((await store.listDetailsLike(league + '|' + season + '|').catch(() => [])).map(d => d.match_id));
  const todo = all.filter(m => !have.has(m.id));
  if (!todo.length) return { calls: 0, stubs: 0, summary: `${league} ${season}: every finished match already has details or a waiting slot` };
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  let json;
  try { json = await getSeasonFixtures(apiId, season); } catch (e) { return { calls: 1, stubs: 0, error: String(e && e.message || e), summary: 'season lookup failed: ' + String(e && e.message || e).slice(0, 140) }; }
  const errs = json && json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : [];
  const fxs = (json && json.response) || [];
  if (errs.length || !fxs.length) {
    const why = errs.length ? errs.join('; ').slice(0, 200) : 'the API returned no fixtures';
    await store.addLog({ kind: 'backfill-ids', ok: false, summary: `${league} ${season}: ${why}`, detail: { league, season, checkedAt: new Date(now).toISOString(), left: json && json.__left != null ? json.__left : null } });
    return { calls: 1, stubs: 0, error: why, summary: `${league} ${season}: ${why}` };
  }
  const stubs = [];
  for (const m of todo) {
    const t = Date.parse(m.date + 'T12:00:00Z');
    const fx = fxs.find(f => f.teams && f.teams.home && f.teams.away && f.fixture && f.fixture.id
      && Math.abs(Date.parse(String(f.fixture.date).slice(0, 10) + 'T12:00:00Z') - t) <= DAY
      && sameTeam(f.teams.home.name, m.home, aliasMap) && sameTeam(f.teams.away.name, m.away, aliasMap));
    if (fx) stubs.push({ match_id: m.id, api_fixture_id: Number(fx.fixture.id) });
  }
  if (stubs.length) await store.addDetailStubs(stubs);
  const summary = `${league} ${season}: ${stubs.length} of ${todo.length} matches queued for details (${fxs.length} fixtures from the API, 1 request)`;
  await store.addLog({ kind: 'backfill-ids', ok: true, summary, detail: { league, season, queued: stubs.length, of: todo.length, checkedAt: new Date(now).toISOString(), left: json.__left != null ? json.__left : null } });
  return { calls: 1, stubs: stubs.length, of: todo.length, summary };
}

/** One request per DATE (not per match): the day's fixtures from every league give the API ids of all our finished matches of that
 *  day that still have no details slot. Newest days first, at most maxDates per call, stops when the day's quota is nearly spent.
 *  Whether past dates are allowed depends on the plan; the API's own refusal is returned as `error`. */
export async function backfillByDates(store, { getFixtures, leagues, todayISO, maxDates = 15, reserve = 30, now = Date.now() } = {}) {
  const keys = (leagues && leagues.length ? leagues : Object.keys(LEAGUES)).filter(l => LEAGUES[l]);
  const todo = [];
  for (const lg of keys) {
    const season = currentSeason(LEAGUES[lg], todayISO || new Date(now).toISOString().slice(0, 10));
    const fin = (await store.listMatches({ league: lg, season }).catch(() => [])).filter(m => m.status === 'finished' && m.date < (todayISO || '9999'));
    const have = new Set((await store.listDetailsLike(lg + '|' + season + '|').catch(() => [])).map(d => d.match_id));
    // a stub (slot) counts as "have": listDetailsLike only lists filled ones, so also skip those already queued
    const queued = new Set((await store.pendingDetails(5000, '', [lg]).catch(() => [])).map(d => d.match_id));
    for (const m of fin) if (!have.has(m.id) && !queued.has(m.id)) todo.push(m);
  }
  if (!todo.length) return { calls: 0, stubs: 0, left: 0, summary: 'every finished match already has details or a waiting slot' };
  const dates = [...new Set(todo.map(m => m.date))].sort().reverse();
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  let calls = 0, stubsN = 0, error = '', leftApi = null, dateDone = 0;
  for (const date of dates.slice(0, maxDates)) {
    if (leftApi != null && leftApi <= reserve) { error = `stopped: only ${leftApi} requests left today`; break; }
    let json; calls++;
    try { json = await getFixtures(date); } catch (e) { error = String(e && e.message || e).slice(0, 160); break; }
    if (json && json.__left != null) leftApi = json.__left;
    const errs = json && json.errors && !Array.isArray(json.errors) ? Object.values(json.errors) : [];
    if (errs.length) { error = errs.join('; ').slice(0, 200); break; }
    const fxs = (json && json.response) || [];
    const stubs = [];
    for (const m of todo.filter(x => x.date === date)) { const fx = findFixture(fxs, m, aliasMap); if (fx && fx.fixture && fx.fixture.id) stubs.push({ match_id: m.id, api_fixture_id: Number(fx.fixture.id) }); }
    if (stubs.length) await store.addDetailStubs(stubs);
    stubsN += stubs.length; dateDone++;
  }
  const summary = `${dateDone} day(s) looked up (${calls} request${calls === 1 ? '' : 's'}), ${stubsN} of ${todo.length} matches queued for details, ${Math.max(0, dates.length - dateDone)} day(s) left` + (error ? `. Stopped: ${error}` : '');
  await store.addLog({ kind: 'backfill-dates', ok: !error, summary, detail: { calls, stubs: stubsN, todo: todo.length, left: leftApi, error: error || null, checkedAt: new Date(now).toISOString() } });
  return { calls, stubs: stubsN, todo: todo.length, daysLeft: Math.max(0, dates.length - dateDone), left: leftApi, error: error || null, summary };
}
