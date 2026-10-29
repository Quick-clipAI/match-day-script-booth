// lib/club-suspects.js  Finds club names in one league that are probably the SAME club spelled two ways.
// Signals: one name's words are all inside the other's ("Celta" / "Celta Vigo"), or the names differ by 1-2 letters.
// Two names that have played EACH OTHER in the league are different clubs and are never listed.
import { norm } from './bank-core.js';
import { sameClub } from './bank-profiles.js';

function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const key = (a, b) => (a < b ? a + '\u0001' + b : b + '\u0001' + a);

/** clubs: [{club, matches, last_season}], matches: stored matches of the league, dismissed: Set of key(a,b). */
export function clubSuspects(clubs, matches, dismissed = new Set()) {
  const met = new Set(matches.map(m => key(m.home, m.away)));
  const out = [];
  for (let i = 0; i < clubs.length; i++) for (let j = i + 1; j < clubs.length; j++) {
    const a = clubs[i], b = clubs[j];
    if (met.has(key(a.club, b.club)) || dismissed.has(key(a.club, b.club))) continue;
    const x = norm(a.club).replace(/ /g, ''), y = norm(b.club).replace(/ /g, '');
    let why = '';
    if (sameClub(a.club, b.club)) why = 'one name is part of the other';
    else if (Math.min(x.length, y.length) >= 6 && /\D/.test(x) && lev(x, y) <= 2 && !/\d/.test(a.club + b.club)) why = 'spelled almost the same';
    if (why) out.push({ a: a.club, b: b.club, why, aMatches: a.matches, bMatches: b.matches, aLast: a.last_season, bLast: b.last_season });
  }
  return out;
}
export const pairKey = key;
