// lib/backfill-ids.js — one request learns the API-Football id of every match of a league season, so their details
// (events, line-ups, ratings) can then be fetched by syncDetails, 1 request each. Matches already answered are left alone.
import { norm } from './bank-core.js';
import { sameTeam } from './sync-due.js';

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
