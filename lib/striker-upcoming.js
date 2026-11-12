// lib/striker-upcoming.js — puts StrikerAPI's not-yet-played Champions League matches into bank_matches as "scheduled".
// Only clubs we already know (by name or alias) are used; a match we already hold (same two clubs within 3 days) is left alone;
// finished matches are never touched.
import { LEAGUES, makeRow, matchId, norm } from './bank-core.js';
import { sameTeam } from './sync-due.js';

const dayNum = d => Date.parse(d + 'T00:00:00Z') / 86400000;

export async function importUpcoming(store, games, { league = 'UCL', season = 2026, dryRun = false } = {}) {
  const cfg = LEAGUES[league];
  const existing = await store.listMatches({ league, season });
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const clubs = new Map(); existing.forEach(m => { clubs.set(norm(m.home), m.home); clubs.set(norm(m.away), m.away); });
  const names = [...clubs.values()];
  const resolve = raw => { const x = norm(raw); if (clubs.has(x)) return clubs.get(x); const hit = names.filter(n => sameTeam(raw, n, aliasMap)); return hit.length === 1 ? hit[0] : null; };
  const out = { games: games.length, added: 0, already: 0, unknownClubs: [], bad: 0, rows: [] };
  const seen = new Set();
  for (const g of games) {
    const date = g && String(g.date || '').slice(0, 10);
    const hn = g && g.home && g.home.name, an = g && g.away && g.away.name;
    if (!date || !hn || !an || (g.status && g.status !== 'scheduled')) { out.bad++; continue; }
    const home = resolve(hn), away = resolve(an);
    if (!home || !away) { out.unknownClubs.push(!home ? hn : an); continue; }
    const pair = [norm(home), norm(away)].sort().join('|') + '|' + date;
    if (seen.has(pair)) continue; seen.add(pair);
    const dup = existing.some(m => [norm(m.home), norm(m.away)].sort().join('|') === [norm(home), norm(away)].sort().join('|') && Math.abs(dayNum(m.date) - dayNum(date)) <= 3);
    if (dup) { out.already++; continue; }
    const time = /T(\d\d:\d\d)/.exec(String(g.date || '')) ? RegExp.$1 : null;
    const r = makeRow(cfg, { season, date, time, home, away, status: 'scheduled', source: 'strikerapi', round: g.round || g.stage || 'League phase' });
    if (r.error) { out.bad++; continue; }
    r.row.id = matchId(cfg, season, date, home, away);
    out.rows.push(r.row);
  }
  out.unknownClubs = [...new Set(out.unknownClubs)];
  if (!dryRun && out.rows.length) { await store.upsertMatches(out.rows); out.added = out.rows.length; }
  out.summary = `StrikerAPI upcoming: ${dryRun ? out.rows.length + ' would be added' : out.added + ' added'}, ${out.already} already held, ${out.unknownClubs.length} unknown club name(s), ${out.bad} unusable`;
  if (!dryRun) await store.addLog({ kind: 'striker-upcoming', ok: true, summary: out.summary, detail: { unknown: out.unknownClubs.slice(0, 20), added: out.added } });
  out.rows = out.rows.slice(0, 5).map(r => `${r.date} ${r.home} v ${r.away}`);
  return out;
}
