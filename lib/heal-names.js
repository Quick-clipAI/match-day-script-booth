// lib/heal-names.js — finds clubs that are STILL stored under a spelling that has an alias, in any league, and (on request) merges them.
// Why: "merge" renames a club inside ONE league. A club merged in the Bundesliga stayed split in the Champions League ("Leipzig" / "RB Leipzig").
// Also finds coach rows that are two rows for one club (the same alias rule) and keeps the best one.
import { norm } from './bank-core.js';
import { mergeTeams } from './bank-sync.js';
import { canonClub, aliasMapOf } from './coach-canon.js';

const normAliases = aliasRows => {
  const m = new Map();
  for (const a of aliasRows || []) { if (!a || !a.alias || !a.canonical) continue; const k = norm(a.alias); if (k) m.set(k, a.canonical); }
  return m;
};

/** Clubs stored under an alias name: [{ league, from, to, matches }] and coach rows to join: [{ league, season, club, keep, drop: [ids], dropNames }] */
export async function healPreview(store) {
  const [clubs, aliasRows, coaches] = await Promise.all([store.clubIndex(), store.listAliases(), store.listCoaches().catch(() => [])]);
  const map = normAliases(aliasRows);
  const splits = [];
  for (const c of clubs) { const to = map.get(norm(c.club)); if (to && to !== c.club) splits.push({ league: c.league, from: c.club, to, matches: c.matches }); }
  splits.sort((a, b) => a.league.localeCompare(b.league) || a.from.localeCompare(b.from));

  const am = aliasMapOf(aliasRows);
  const groups = new Map();
  for (const r of coaches) { const club = canonClub(r.club, am); const k = `${r.league}|${r.season}|${norm(club)}`; if (!groups.has(k)) groups.set(k, { club, rows: [] }); groups.get(k).rows.push(r); }
  const coachJoins = [];
  for (const [, g] of groups) {
    if (g.rows.length < 2) continue;
    // keep: hand-checked first, then the row already under the canonical name, then the newest
    const score = r => (r.locked ? 4 : 0) + (norm(r.club) === norm(g.club) ? 2 : 0) + (r.api_id ? 1 : 0);
    const sorted = [...g.rows].sort((a, b) => score(b) - score(a) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const keep = sorted[0];
    coachJoins.push({ league: keep.league, season: keep.season, club: g.club, keep: keep.id, keepName: keep.name, drop: sorted.slice(1).map(r => r.id), dropNames: sorted.slice(1).map(r => `${r.club}: ${r.name}`) });
  }
  const renames = coaches.filter(r => canonClub(r.club, am) !== r.club && !coachJoins.some(j => j.drop.includes(r.id))).map(r => ({ id: r.id, league: r.league, season: r.season, from: r.club, to: canonClub(r.club, am) }));
  return { splits, coachJoins, coachRenames: renames };
}

/** Does the merge. Matches: mergeTeams per league (it also drops a duplicate match that exists under both names). Coaches: drop the extra rows, rename the rest. */
export async function healApply(store) {
  const p = await healPreview(store);
  let moved = 0, dropped = 0;
  for (const s of p.splits) { const r = await mergeTeams(store, { league: s.league, from: s.from, to: s.to }); if (!r.error) { moved += r.moved || 0; dropped += r.dropped || 0; } }
  let coachRows = 0;
  for (const j of p.coachJoins) {
    const rows = await store.listCoaches({ league: j.league, season: j.season });
    const keep = rows.find(r => r.id === j.keep); const gone = rows.filter(r => j.drop.includes(r.id));
    if (keep && !keep.api_id) { const withId = gone.find(r => r.api_id); if (withId) await store.upsertCoaches([{ ...keep, api_id: withId.api_id }]); }
    if (gone.length) { await store.deleteCoaches(gone.map(r => r.id)); coachRows += gone.length; }
  }
  const al = aliasMapOf(await store.listAliases());
  for (const r of p.coachRenames) {
    const row = (await store.listCoaches({ league: r.league, season: r.season })).find(x => x.id === r.id);
    if (!row) continue;
    await store.deleteCoaches([row.id]);
    await store.upsertCoaches([{ ...row, club: r.to, id: `${row.league}|${row.season}|${canonClub(r.to, al).toLowerCase()}` }]); coachRows++;
  }
  await store.addLog({ kind: 'merge', ok: true, summary: `Names merged everywhere: ${p.splits.length} club name(s) (${moved} matches moved${dropped ? `, ${dropped} duplicate matches dropped` : ''}), ${coachRows} coach row(s) joined.`, detail: { splits: p.splits, coachJoins: p.coachJoins, coachRenames: p.coachRenames } });
  return { splits: p.splits.length, matchesMoved: moved, matchesDropped: dropped, coachRows };
}
