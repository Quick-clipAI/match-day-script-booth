// lib/coach-flags.js — compares the head coach in our club table with the coach named in the club's recent saved line-ups
// (and, on request, with a list from another source). It reads only what is already stored: it costs NO API requests and changes nothing by itself.
import { personNorm, sameClub } from './bank-profiles.js';

const SKIP = new Set(['de', 'da', 'do', 'dos', 'van', 'von', 'der', 'den', 'di', 'el', 'al', 'jr', 'junior']);
const toks = s => personNorm(s).split(' ').filter(Boolean);

/** Same person? "A. Hütter" = "Adolf Hütter" = "Adi Hutter"; "Slot" = "Arne Slot". Compares the surname, then the first initial when both have one. */
export function sameCoach(a, b) {
  const x = toks(a), y = toks(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
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

/** Compares our coaches with a list from another source: rows [{ club, coach, league? }]. Returns { rows, same, different, unmatched }. */
export function compareCoachList(coaches, list, { aliasMap = new Map() } = {}) {
  const rows = [];
  for (const it of Array.isArray(list) ? list : []) {
    const club = String(it && it.club || '').trim(), coach = String(it && it.coach || '').trim();
    if (!club) continue;
    const mine = coaches.filter(c => (!it.league || c.league === it.league) && sameClub(club, c.club, aliasMap));
    const cur = mine.sort((a, b) => b.season - a.season)[0];
    if (!cur) { rows.push({ status: 'no-club', club, coach, league: it.league || null }); continue; }
    if (!coach) { rows.push({ status: 'no-coach', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, coach: '' }); continue; }
    rows.push({ status: sameCoach(coach, cur.name) ? 'same' : 'different', id: cur.id, club: cur.club, league: cur.league, table_coach: cur.name, locked: !!cur.locked, coach });
  }
  const n = s => rows.filter(r => r.status === s).length;
  return { rows: rows.filter(r => r.status !== 'same'), same: n('same'), different: n('different'), unmatched: n('no-club') + n('no-coach') };
}
