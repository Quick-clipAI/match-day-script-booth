// lib/coach-flags.js — compares the head coach in our club table with the coach named in the club's recent saved line-ups
// (and, on request, with a list from another source). It reads only what is already stored: it costs NO API requests and changes nothing by itself.
import { personNorm, sameClub, strictSameClub } from './bank-profiles.js';
import { lev, canonName, fullestName } from './coach-canon.js';

const SKIP = new Set(['de', 'da', 'do', 'dos', 'van', 'von', 'der', 'den', 'di', 'el', 'al', 'jr', 'junior']);
const toks = s => personNorm(s).split(' ').filter(Boolean);

/** Same person? "A. Hütter" = "Adolf Hütter" = "Adi Hutter"; "Slot" = "Arne Slot". Compares the surname, then the first initial when both have one. */
export function sameCoach(a, b, nameMap = null) {
  if (nameMap && nameMap.size) { a = canonName(a, nameMap); b = canonName(b, nameMap); }   // spellings merged by hand are one person
  const x = toks(a), y = toks(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ') || [...x].sort().join(' ') === [...y].sort().join(' ')) return true;   // also "Carille Fabio" = "Fábio Carille"
  const core = t => t.filter(k => !SKIP.has(k));
  const cx = core(x), cy = core(y);
  const sx = cx[cx.length - 1], sy = cy[cy.length - 1];
  if (!sx || !sy) return false;
  const close = (p, q) => p === q || (Math.abs(p.length - q.length) <= 1 && (p.startsWith(q) || q.startsWith(p)) && Math.min(p.length, q.length) >= 5) || (p.replace(/oe|ue|ae/g, m => m[0]) === q.replace(/oe|ue|ae/g, m => m[0]));   // Hutter / Hutter, Hoeness / Hoenes
  const sameSurname = close(sx, sy) || (cx.length === 1 && cy.includes(cx[0])) || (cy.length === 1 && cx.includes(cy[0]));
  if (!sameSurname) return false;
  const fx = cx.length > 1 ? cx[0][0] : null, fy = cy.length > 1 ? cy[0][0] : null;
  return !fx || !fy || fx === fy;
}

/** Probably the same person written differently ("M. Mićović" / "Marko Mitrović", or a nickname: same surname, other first name): same first initial and a surname within 2 letters. Only a suggestion; a person confirms the merge. */
export function variantCoach(a, b, nameMap = null) {
  if (!a || !b || sameCoach(a, b, nameMap)) return false;
  const core = t => t.filter(k => !SKIP.has(k));
  const x = core(toks(canonName(a, nameMap))), y = core(toks(canonName(b, nameMap)));
  if (!x.length || !y.length) return false;
  const sx = x[x.length - 1], sy = y[y.length - 1];
  // nickname: the same surname with two different first names (José / Pepe Bordalás, Cristian / Kily González)
  if (sx === sy && x.length > 1 && y.length > 1 && x[0].length > 1 && y[0].length > 1 && sx.length >= 4) return true;
  if (Math.min(sx.length, sy.length) < 4) return false;
  const d = lev(sx, sy);
  if (d > 2 || (d === 2 && Math.min(sx.length, sy.length) < 6)) return false;
  const fx = x.length > 1 ? x[0][0] : null, fy = y.length > 1 ? y[0][0] : null;
  return !fx || !fy || fx === fy;
}

/** Clubs of one league (every name stored in the coach table): the pool that keeps "Barcelona" apart from "RCD Espanyol de Barcelona". */
const poolOf = (coaches, league) => [...new Set(coaches.filter(c => c.league === league).map(c => c.club))];

/**
 * coaches: rows of bank_coaches. lineups: [{ league, club, date, coach, id }] newest first per club (from store.lineupCoaches()).
 * Returns flags: the newest line-up coach differs from our table coach, unless that name was already reviewed (lineup_ack).
 */
export function computeCoachFlags(coaches, lineups, { aliasMap = new Map(), nameMap = null, recent = 3 } = {}) {
  const season = new Map();                                         // newest season per league: only those clubs are checked
  for (const c of coaches) if (!season.has(c.league) || c.season > season.get(c.league)) season.set(c.league, c.season);
  const flags = [];
  for (const c of coaches) {
    if (c.season !== season.get(c.league)) continue;
    const pool = poolOf(coaches, c.league);
    const mine = lineups.filter(l => l.league === c.league && strictSameClub(l.club, c.club, pool, aliasMap)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, recent);
    if (!mine.length) continue;
    const latest = mine[0];
    if (!latest.coach || sameCoach(latest.coach, c.name, nameMap)) continue;
    if (variantCoach(latest.coach, c.name, nameMap)) continue;      // a spelling difference: listed by computeCoachVariants, not a different coach
    if (c.lineup_ack && sameCoach(c.lineup_ack, latest.coach, nameMap)) continue;
    const same = mine.filter(l => sameCoach(l.coach, latest.coach, nameMap)).length;
    flags.push({ id: c.id, league: c.league, club: c.club, table_coach: c.name, table_as_of: c.as_of || null, locked: !!c.locked, lineup_coach: latest.coach, lineup_date: latest.date, lineup_match: latest.id, lineups_checked: mine.length, lineups_agree: same });
  }
  return flags.sort((a, b) => a.league.localeCompare(b.league) || a.club.localeCompare(b.club));
}

/** Clubs where our table, a recent line-up (or a list) write the SAME coach in different ways. names: every spelling seen; suggested: the fullest one. */
export function computeCoachVariants(coaches, lineups, { aliasMap = new Map(), nameMap = null, recent = 3, extra = new Map() } = {}) {
  const season = new Map();
  for (const c of coaches) if (!season.has(c.league) || c.season > season.get(c.league)) season.set(c.league, c.season);
  const out = [];
  for (const c of coaches) {
    if (c.season !== season.get(c.league)) continue;
    const pool = poolOf(coaches, c.league);
    const seen = lineups.filter(l => l.league === c.league && strictSameClub(l.club, c.club, pool, aliasMap)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, recent).map(l => l.coach).concat(extra.get(c.id) || []);
    const names = [...new Set([c.name, ...seen].filter(Boolean))];
    const odd = names.filter(n => n !== c.name && variantCoach(n, c.name, nameMap));
    if (!odd.length) continue;
    const all = [...new Set([c.name, ...odd])];
    out.push({ id: c.id, league: c.league, club: c.club, table_coach: c.name, names: all, suggested: fullestName(all) });
  }
  return out.sort((a, b) => a.league.localeCompare(b.league) || a.club.localeCompare(b.club));
}

// Other sources write some clubs differently from our table (name used in the file -> name in our table)
const CLUB_ALT = { 'inter': 'Internazionale Milano', 'lyon': 'Olympique Lyonnais', 'brest': 'Stade Brestois 29', 'rennes': 'Stade Rennais FC 1901', 'red bull new york': 'New York Red Bulls', 'dc united': 'D.C. United', 'al qadsiah': 'Al-Qadisiyah', 'al hazem': 'Al-Hazm', 'al taawoun': 'Al Taawon', 'deportivo a coruna': 'Deportivo La Coruna', 'milan': 'AC Milan', 'monaco': 'AS Monaco', 'brighton hove albion': 'Brighton', 'brighton and hove albion': 'Brighton', 'newcastle united': 'Newcastle', 'leeds united': 'Leeds', 'ipswich town': 'Ipswich', 'orlando city': 'Orlando City SC', 'seattle sounders fc': 'Seattle Sounders', 'chicago fire fc': 'Chicago Fire', 'houston dynamo fc': 'Houston Dynamo', 'fc cincinnati': 'Cincinnati', 'new york city fc': 'New York City', 'toronto fc': 'Toronto', 'fc dallas': 'Dallas', 'austin fc': 'Austin', 'charlotte fc': 'Charlotte', 'san diego fc': 'San Diego', 'cf montreal': 'Montreal', 'inter miami cf': 'Inter Miami' };

/** Our coach row for a club name from another source: exact name first, then a known alternative name, then the looser same-club rule (only when it is unambiguous). */
function findCoachRow(coaches, club, league, aliasMap) {
  const pool = coaches.filter(c => !league || c.league === league);
  const n = personNorm(club);
  const exact = pool.filter(c => personNorm(c.club) === n);
  if (exact.length) return exact.sort((a, b) => b.season - a.season)[0];
  const alt = CLUB_ALT[n] ? pool.filter(c => personNorm(c.club) === personNorm(CLUB_ALT[n])) : [];
  if (alt.length) return alt.sort((a, b) => b.season - a.season)[0];
  if (new Set(pool.filter(c => sameClub(club, c.club, aliasMap)).map(c => personNorm(c.club))).size > 1) return null;   // "Paris" could be two clubs: do not guess
  const names = pool.map(c => c.club);
  const loose = pool.filter(c => strictSameClub(club, c.club, names, aliasMap));
  const kinds = new Set(loose.map(c => personNorm(c.club)));
  return kinds.size === 1 ? loose.sort((a, b) => b.season - a.season)[0] : null;   // "Paris" could be two clubs: do not guess
}

/** Compares our coaches with a list from another source: rows [{ club, coach, league? }]. Optional lineups (from store.lineupCoaches) mark rows where a saved line-up names the same coach as the list. */
export function compareCoachList(coaches, list, { aliasMap = new Map(), nameMap = null, lineups = [] } = {}) {
  const rows = [];
  const seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const club = String(it && it.club || '').trim(), coach = String(it && it.coach || '').trim();
    if (!club) continue;
    const cur = findCoachRow(coaches, club, it.league || null, aliasMap);
    if (!cur) { rows.push({ status: 'no-club', club, coach, league: it.league || null }); continue; }
    if (seen.has(cur.id)) continue; seen.add(cur.id);
    if (!coach) { rows.push({ status: 'no-coach', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, coach: '' }); continue; }
    if (sameCoach(coach, cur.name, nameMap)) { rows.push({ status: 'same', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, coach }); continue; }
    const cpool = poolOf(coaches, cur.league);
    const mine = lineups.filter(l => l.league === cur.league && strictSameClub(l.club, cur.club, cpool, aliasMap)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const latest = mine[0];
    if (variantCoach(coach, cur.name, nameMap)) { const all = [...new Set([cur.name, coach, ...(latest && variantCoach(latest.coach, cur.name, nameMap) ? [latest.coach] : [])])]; rows.push({ status: 'variant', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, coach, names: all, suggested: fullestName(all) }); continue; }
    rows.push({ status: 'different', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, locked: !!cur.locked, coach, lineup_coach: latest ? latest.coach : null, lineup_agrees: !!(latest && sameCoach(latest.coach, coach, nameMap)) });
  }
  const n = s => rows.filter(r => r.status === s).length;
  return { rows: rows.filter(r => r.status !== 'same'), same: n('same'), variants: n('variant'), different: n('different'), agreeWithLineup: rows.filter(r => r.status === 'different' && r.lineup_agrees).length, unmatched: n('no-club') + n('no-coach') };
}
