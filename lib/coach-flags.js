// lib/coach-flags.js — compares the head coach in our club table with the coach named in the club's recent saved line-ups
// (and, on request, with a list from another source). It reads only what is already stored: it costs NO API requests and changes nothing by itself.
import { personNorm, sameClub } from './bank-profiles.js';

const SKIP = new Set(['de', 'da', 'do', 'dos', 'van', 'von', 'der', 'den', 'di', 'el', 'al', 'jr', 'junior']);
const toks = s => personNorm(s).split(' ').filter(Boolean);

/** Same person? "A. Hütter" = "Adolf Hütter" = "Adi Hutter"; "Slot" = "Arne Slot". Compares the surname, then the first initial when both have one. */
export function sameCoach(a, b) {
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

/**
 * coaches: rows of bank_coaches. lineups: [{ league, club, date, coach, id }] newest first per club (from store.lineupCoaches()).
 * Returns flags: the newest line-up coach differs from our table coach, unless that name was already reviewed (lineup_ack).
 */
export function computeCoachFlags(coaches, lineups, { aliasMap = new Map(), recent = 3 } = {}) {
  const season = new Map();                                         // newest season per league: only those clubs are checked
  for (const c of coaches) if (!season.has(c.league) || c.season > season.get(c.league)) season.set(c.league, c.season);
  const flags = [];
  for (const c of coaches) {
    if (c.season !== season.get(c.league)) continue;
    const mine = lineups.filter(l => l.league === c.league && sameClub(l.club, c.club, aliasMap)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, recent);
    if (!mine.length) continue;
    const latest = mine[0];
    if (!latest.coach || sameCoach(latest.coach, c.name)) continue;
    if (c.lineup_ack && sameCoach(c.lineup_ack, latest.coach)) continue;
    const same = mine.filter(l => sameCoach(l.coach, latest.coach)).length;
    flags.push({ id: c.id, league: c.league, club: c.club, table_coach: c.name, table_as_of: c.as_of || null, locked: !!c.locked, lineup_coach: latest.coach, lineup_date: latest.date, lineup_match: latest.id, lineups_checked: mine.length, lineups_agree: same });
  }
  return flags.sort((a, b) => a.league.localeCompare(b.league) || a.club.localeCompare(b.club));
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
  const loose = pool.filter(c => sameClub(club, c.club, aliasMap));
  const names = new Set(loose.map(c => personNorm(c.club)));
  return names.size === 1 ? loose.sort((a, b) => b.season - a.season)[0] : null;   // "Paris" could be two clubs: do not guess
}

/** Compares our coaches with a list from another source: rows [{ club, coach, league? }]. Optional lineups (from store.lineupCoaches) mark rows where a saved line-up names the same coach as the list. */
export function compareCoachList(coaches, list, { aliasMap = new Map(), lineups = [] } = {}) {
  const rows = [];
  const seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const club = String(it && it.club || '').trim(), coach = String(it && it.coach || '').trim();
    if (!club) continue;
    const cur = findCoachRow(coaches, club, it.league || null, aliasMap);
    if (!cur) { rows.push({ status: 'no-club', club, coach, league: it.league || null }); continue; }
    if (seen.has(cur.id)) continue; seen.add(cur.id);
    if (!coach) { rows.push({ status: 'no-coach', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, coach: '' }); continue; }
    if (sameCoach(coach, cur.name)) { rows.push({ status: 'same', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, coach }); continue; }
    const mine = lineups.filter(l => l.league === cur.league && sameClub(l.club, cur.club, aliasMap)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const latest = mine[0];
    rows.push({ status: 'different', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, locked: !!cur.locked, coach, lineup_coach: latest ? latest.coach : null, lineup_agrees: !!(latest && sameCoach(latest.coach, coach)) });
  }
  const n = s => rows.filter(r => r.status === s).length;
  return { rows: rows.filter(r => r.status !== 'same'), same: n('same'), different: n('different'), agreeWithLineup: rows.filter(r => r.status === 'different' && r.lineup_agrees).length, unmatched: n('no-club') + n('no-coach') };
}
