// lib/match-view.js  — everything the match screen needs besides the saved line-ups/statistics:
// the league table with qualification zones, and the knockout bracket. Built from the matches already in the bank (no API credits).
import { LEAGUES, norm, computeTable, seasonLabel } from './bank-core.js';
import { crestIds } from './crests.js';

/* Qualification / relegation places per competition. These are the USUAL places; extra European places depend on UEFA rankings and
 * cup winners and can change from year to year, so this table is the one place to edit. A competition with no entry shows no colours. */
const last = n => ({ last: n });
export const ZONES = {
  EPL:        [{ from: 1, to: 4, key: 'ucl', label: 'Champions League' }, { from: 5, to: 5, key: 'uel', label: 'Europa League' }, { from: 6, to: 6, key: 'uecl', label: 'Conference League' }, { ...last(3), key: 'rel', label: 'Relegation' }],
  LALIGA:     [{ from: 1, to: 4, key: 'ucl', label: 'Champions League' }, { from: 5, to: 6, key: 'uel', label: 'Europa League' }, { from: 7, to: 7, key: 'uecl', label: 'Conference League' }, { ...last(3), key: 'rel', label: 'Relegation' }],
  SERIEA:     [{ from: 1, to: 4, key: 'ucl', label: 'Champions League' }, { from: 5, to: 5, key: 'uel', label: 'Europa League' }, { from: 6, to: 6, key: 'uecl', label: 'Conference League' }, { ...last(3), key: 'rel', label: 'Relegation' }],
  BUNDESLIGA: [{ from: 1, to: 4, key: 'ucl', label: 'Champions League' }, { from: 5, to: 5, key: 'uel', label: 'Europa League' }, { from: 6, to: 6, key: 'uecl', label: 'Conference League' }, { from: 16, to: 16, key: 'po', label: 'Relegation play-off' }, { ...last(2), key: 'rel', label: 'Relegation' }],
  LIGUE1:     [{ from: 16, to: 16, key: 'po', label: 'Relegation play-off' }, { ...last(2), key: 'rel', label: 'Relegation' }],
  SPL:        [{ ...last(3), key: 'rel', label: 'Relegation' }],
  // 2024+ format: 36 clubs in one table
  UCL:  [{ from: 1, to: 8, key: 'q', label: 'Qualified (Round of 16)' }, { from: 9, to: 24, key: 'po', label: 'Play-offs' }, { from: 25, to: 99, key: 'out', label: 'Eliminated' }],
  UEL:  [{ from: 1, to: 8, key: 'q', label: 'Qualified (Round of 16)' }, { from: 9, to: 24, key: 'po', label: 'Play-offs' }, { from: 25, to: 99, key: 'out', label: 'Eliminated' }],
  UECL: [{ from: 1, to: 8, key: 'q', label: 'Qualified (Round of 16)' }, { from: 9, to: 24, key: 'po', label: 'Play-offs' }, { from: 25, to: 99, key: 'out', label: 'Eliminated' }]
};
// matches in the league phase, for the 36-club tournaments (a full phase: 8, 8 and 6 matchdays of 18 matches)
const PHASE_MATCHES = { UCL: 144, UEL: 144, UECL: 108 };
const LEAGUE_PHASE = /^(matchday|league stage)\b/i;
const isCupTable = k => Object.prototype.hasOwnProperty.call(PHASE_MATCHES, k);

const STAGES = [
  ['Play-offs', /play-?offs?/i], ['Round of 16', /round of 16|8th finals?|last 16/i], ['Quarter-finals', /quarter/i], ['Semi-finals', /semi/i], ['Final', /^final$/i]
];
export const stageOf = round => { for (const [n, rx] of STAGES) if (rx.test(String(round || ''))) return n; return null; };

export function zoneFor(league, pos, teamCount) {
  for (const z of ZONES[league] || []) {
    const from = z.last ? teamCount - z.last + 1 : z.from, to = z.last ? teamCount : z.to;
    if (pos >= from && pos <= to) return z.key;
  }
  return null;
}

/** Last five results per team, oldest first ('W' | 'D' | 'L'), from the finished matches given. */
export function formByTeam(matches, n = 5) {
  const fin = matches.filter(m => m.status === 'finished' && Number.isInteger(m.hg) && Number.isInteger(m.ag))
    .sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.time || '').localeCompare(String(y.time || '')));
  const out = new Map(); const push = (t, r) => { if (!out.has(t)) out.set(t, []); out.get(t).push(r); };
  for (const m of fin) { const h = m.hg > m.ag ? 'W' : m.hg < m.ag ? 'L' : 'D'; push(m.home, h); push(m.away, h === 'W' ? 'L' : h === 'L' ? 'W' : 'D'); }
  for (const [t, l] of out) out.set(t, l.slice(-n));
  return out;
}

export function buildTable(allMatches, match) {
  const key = match.league, cfg = LEAGUES[key];
  if (!cfg || (cfg.type !== 'league' && !isCupTable(key))) return null;
  const pool = isCupTable(key) ? allMatches.filter(m => LEAGUE_PHASE.test(m.round || '')) : allMatches;
  if (!pool.length) return null;
  const t = computeTable(pool, cfg);
  const zones = ZONES[key] || [];
  const formOf = formByTeam(pool);
  const rows = t.rows.map(r => ({ rank: r.rank, team: r.team, P: r.P, W: r.W, D: r.D, L: r.L, GF: r.GF, GA: r.GA, GD: r.GD, Pts: r.Pts, form: formOf.get(r.team) || [], zone: zoneFor(key, r.rank, t.rows.length) }));
  const need = isCupTable(key) ? PHASE_MATCHES[key] : (cfg.teams ? cfg.teams * (cfg.teams - 1) : null);
  const complete = !!need && t.playedMatches >= need;
  const legend = zones.map(z => { const n = rows.filter(r => r.zone === z.key).length; return n ? { key: z.key, label: z.label } : null; }).filter(Boolean);
  const seen = new Set(); const legendUnique = legend.filter(l => (seen.has(l.key) ? false : (seen.add(l.key), true)));
  return { competition: cfg.short, season: match.season, label: seasonLabel(cfg, match.season), rows, legend: legendUnique, played: t.playedMatches, complete, tieUndecided: t.tieUndecided,
    note: zones.length ? (complete ? null : 'Places so far, not final.') : 'No qualification places are set for this competition.',
    usual: zones.length > 0 && !isCupTable(key) };
}

export function buildBracket(allMatches, match) {
  if (!isCupTable(match.league)) return null;
  const ko = allMatches.filter(m => !LEAGUE_PHASE.test(m.round || '') && stageOf(m.round));
  if (!ko.length) return { stages: [] };
  const stages = [];
  for (const [name] of STAGES) {
    const ms = ko.filter(m => stageOf(m.round) === name); if (!ms.length) continue;
    const ties = new Map();
    for (const m of ms) {
      const k = [norm(m.home), norm(m.away)].sort().join('|');
      if (!ties.has(k)) ties.set(k, { a: m.home, b: m.away, legs: [] });
      ties.get(k).legs.push({ id: m.id, date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, status: m.status, note: m.note || null });
    }
    const list = [...ties.values()].map(t => {
      t.legs.sort((x, y) => (x.date < y.date ? -1 : 1));
      const done = t.legs.every(l => l.status === 'finished' && l.hg != null);
      let sa = 0, sb = 0;
      t.legs.forEach(l => { if (l.status !== 'finished' || l.hg == null) return; if (l.home === t.a) { sa += l.hg; sb += l.ag; } else { sa += l.ag; sb += l.hg; } });
      const agg = t.legs.some(l => l.status === 'finished') ? { a: sa, b: sb } : null;
      return { a: t.a, b: t.b, legs: t.legs, agg, decided: done, note: t.legs.map(l => l.note).filter(Boolean).pop() || null };
    });
    stages.push({ name, ties: list });
  }
  return { stages, current: stageOf(match.round) };
}

export const publicMatch = m => ({ id: m.id, league: m.league, competition: (LEAGUES[m.league] && LEAGUES[m.league].short) || m.comp_name, season: m.season, round: m.round || '', date: m.date, time: m.time || '', kickoff: m.kickoff || null,
  home: m.home, away: m.away, hg: m.status === 'finished' ? m.hg : null, ag: m.status === 'finished' ? m.ag : null, ht_h: m.status === 'finished' ? m.ht_h : null, ht_a: m.status === 'finished' ? m.ht_a : null, status: m.status, note: m.note || null });

export async function findMatch(store, q) {
  if (q.id) return await store.getMatch(String(q.id).slice(0, 200));
  if (q.date && q.home && q.away) {
    const list = await store.listMatches({ fromDate: q.date, toDate: q.date });
    const h = norm(q.home), a = norm(q.away);
    return list.find(m => norm(m.home) === h && norm(m.away) === a) || null;
  }
  return null;
}

export async function buildView(store, match) {
  const [all, det] = await Promise.all([store.listMatches({ league: match.league, season: match.season }), store.getDetail(match.id).catch(() => null)]);
  const data = det && det.data ? det.data : null;
  return { match: publicMatch(match), detail: data && !data.unavailable ? data : null, detailState: data ? (data.unavailable ? 'unavailable' : 'ok') : (match.status === 'finished' ? (det ? 'pending' : 'none') : 'upcoming'),
    table: buildTable(all, match), bracket: buildBracket(all, match), crests: await crestIds(store, [...new Set([match.home, match.away, ...all.flatMap(m => [m.home, m.away])])]).catch(() => ({})) };
}

/** Fresh state of the fixture cards shown under chat answers (a card made before the match stays "Upcoming" otherwise).
 *  refs: [{ k, id, date, home, away }]  ->  { cards: { [k]: { status, hg, ag, date, time, kickoff, round } }, crests: { name: apiTeamId } } */
export async function cardStates(store, refs) {
  const cards = {}, names = [];
  for (const r of (Array.isArray(refs) ? refs : []).slice(0, 24)) {
    if (!r || !r.k) continue;
    if (r.home) names.push(String(r.home).slice(0, 80)); if (r.away) names.push(String(r.away).slice(0, 80));
    const m = await findMatch(store, { id: r.id ? String(r.id) : '', date: String(r.date || ''), home: String(r.home || ''), away: String(r.away || '') }).catch(() => null);
    if (m) cards[r.k] = { status: m.status, hg: m.hg == null ? null : m.hg, ag: m.ag == null ? null : m.ag, date: m.date, time: m.time || null, kickoff: m.kickoff || null, round: m.round || null };
  }
  return { cards, crests: await crestIds(store, names).catch(() => ({})) };
}
