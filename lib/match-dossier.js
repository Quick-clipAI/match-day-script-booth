// lib/match-dossier.js — a short briefing per match, built only from stored results: where each club stands, its recent run
// across all competitions, previous meetings, and (where full match stats were saved) its goal and assist leaders.
// The chat adds this to the AI's prompt so "which match is the biggest?" is answered from form and stakes, not from reputation.
import { norm } from './bank-core.js';

const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');
const res = (m, club) => { if (m.hg == null || m.ag == null) return null; const h = norm(m.home) === norm(club); const d = h ? m.hg - m.ag : m.ag - m.hg; return d > 0 ? 'W' : d < 0 ? 'L' : 'D'; };
const dshort = d => { const [, mo, da] = String(d).split('-'); return Number(da) + '/' + Number(mo); };
const involves = (m, club) => norm(m.home) === norm(club) || norm(m.away) === norm(club);

/** Club's finished matches, newest first, from every list given. */
export function finishedOf(club, lists) {
  const seen = new Set(), out = [];
  for (const l of lists) for (const m of l) if (m.status === 'finished' && m.hg != null && involves(m, club) && !seen.has(m.id)) { seen.add(m.id); out.push(m); }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function formLine(club, lists, n = 5) {
  const fin = finishedOf(club, lists); if (!fin.length) return null;
  const last = fin.slice(0, n).map(m => {
    const home = norm(m.home) === norm(club), opp = home ? m.away : m.home, r = res(m, club);
    return `${r} ${home ? m.hg : m.ag}-${home ? m.ag : m.hg} ${home ? 'v' : 'at'} ${opp} (${[m._short, dshort(m.date)].filter(Boolean).join(' ')})`;
  });
  const rs = fin.map(m => res(m, club));
  let w = 0; while (w < rs.length && rs[w] === 'W') w++;
  let l = 0; while (l < rs.length && rs[l] === 'L') l++;
  let u = 0; while (u < rs.length && rs[u] !== 'L') u++;
  const run = w >= 2 ? `won the last ${w}` : l >= 2 ? `lost the last ${l}` : u >= 3 ? `unbeaten in the last ${u}` : '';
  const gf = fin.slice(0, n).reduce((s, m) => s + (norm(m.home) === norm(club) ? m.hg : m.ag), 0), ga = fin.slice(0, n).reduce((s, m) => s + (norm(m.home) === norm(club) ? m.ag : m.hg), 0);
  return `last ${last.length} (newest first): ${last.join('; ')}${run ? '. Run: ' + run : ''}. Goals in those ${last.length}: ${gf} scored, ${ga} conceded`;
}

export function h2hLine(a, b, lists) {
  const seen = new Set(), h = [];
  for (const l of lists) for (const m of l) if (m.status === 'finished' && m.hg != null && !seen.has(m.id) && involves(m, a) && involves(m, b)) { seen.add(m.id); h.push(m); }
  if (!h.length) return `No earlier ${a} v ${b} match is stored.`;
  h.sort((x, y) => (x.date < y.date ? 1 : -1));
  let wa = 0, wb = 0, d = 0; h.forEach(m => { const r = res(m, a); if (r === 'W') wa++; else if (r === 'L') wb++; else d++; });
  return `Stored meetings (${h.length}): ${a} ${wa} wins, ${b} ${wb} wins, ${d} draws. Latest: ` + h.slice(0, 4).map(m => `${m.date} ${m.home} ${m.hg}-${m.ag} ${m.away}`).join('; ');
}

const ZONE_TXT = { q: 'in the qualification places', po: 'in the play-off places', out: 'outside the qualification and play-off places' };

/** @param ctx { match, short, table (buildTable result or null), domestic: Map(club -> {league, rank, P, Pts}), lists (all matches arrays, with _short), scorers: Map(club -> 'Name 3, Name 2') } */
export function dossier(ctx) {
  const { match: m, short, table, domestic, lists, leaders } = ctx;
  const side = club => {
    const out = [];
    const row = table && table.rows.find(r => norm(r.team) === norm(club));
    if (row && !row.P) out.push(`${short} table: no match played yet, so no real position`);
    else if (row) out.push(`${short} table${table.complete ? '' : ' so far'}: ${ord(row.rank)} on ${row.Pts} points (${row.P} played, ${row.W}W ${row.D}D ${row.L}L, goals ${row.GF}-${row.GA})${row.zone && ZONE_TXT[row.zone] ? ', ' + ZONE_TXT[row.zone] : ''}`);
    const dm = domestic && domestic.get(club);
    if (dm) out.push(`${dm.league}: ${ord(dm.rank)} on ${dm.Pts} points after ${dm.P} matches`);
    const f = formLine(club, lists); out.push(f ? 'Form, ' + f : 'No stored results for this season yet');
    const ld = leaders && leaders(club); if (ld && ld.length) out.push('Best recent performers (our stored match ratings, last 5 matches we have stats for): ' + ld.map(p => `${p.name} ${p.avg} avg in ${p.n}${p.g ? ', ' + p.g + ' goal' + (p.g > 1 ? 's' : '') : ''}${p.a ? ', ' + p.a + ' assist' + (p.a > 1 ? 's' : '') : ''}`).join('; '));
    return `  ${club}:\n    - ` + out.join('\n    - ');
  };
  const rows = table && table.rows;
  const hr = rows && rows.find(r => norm(r.team) === norm(m.home)), ar = rows && rows.find(r => norm(r.team) === norm(m.away));
  const stakes = hr && ar && hr.P && ar.P ? `Stakes: ${m.home} ${ord(hr.rank)} (${hr.Pts} pts) v ${m.away} ${ord(ar.rank)} (${ar.Pts} pts); ${Math.abs(hr.Pts - ar.Pts)} point(s) apart` : '';
  return [`MATCH: ${m.home} v ${m.away}${m.time ? ' (' + m.time + ')' : ''}${m.round ? ', ' + m.round : ''}`, side(m.home), side(m.away), '  ' + h2hLine(m.home, m.away, lists), stakes ? '  ' + stakes : ''].filter(Boolean).join('\n');
}
