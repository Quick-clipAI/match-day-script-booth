// lib/coach-canon.js — one spelling per club and per coach.
// Club: a club name that has an alias (bank_aliases) is always written in its canonical form, so "Leipzig" and "RB Leipzig" can never become two coach rows.
// Coach: a spelling that was merged by hand (bank_coach_names) is always written in its canonical form, whatever source brings it ("M. Mićović", "Marko Mitrović").
import { norm } from './bank-core.js';
import { personNorm } from './bank-profiles.js';

export const lev = (a, b) => {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 4;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
};

/** aliasMap: Map(alias -> canonical club) as built everywhere from bank_aliases rows. Returns the canonical club name (or the name itself). */
export function canonClub(club, aliasMap) {
  if (!club || !aliasMap) return club;
  const hit = aliasMap.get(norm(club)) || aliasMap.get(club);
  return hit && hit !== club ? hit : club;
}

/** nameMap: Map(personNorm(spelling) -> canonical coach name). */
export function canonName(name, nameMap) {
  if (!name || !nameMap || !nameMap.size) return name;
  return nameMap.get(personNorm(name)) || name;
}

export const coachRowId = (league, season, club) => `${league}|${season}|${String(club).toLowerCase()}`;

/** A coach row written under the canonical club and coach spelling (the id follows the club). Rows with a non-standard id keep it. */
export function canonCoachRow(row, aliasMap, nameMap) {
  const o = { ...row };
  const club = canonClub(o.club, aliasMap);
  if (club !== o.club) { if (o.id === coachRowId(o.league, o.season, o.club)) o.id = coachRowId(o.league, o.season, club); o.club = club; }
  if (o.name) o.name = canonName(o.name, nameMap);
  return o;
}

export const nameMapOf = rows => new Map((rows || []).map(r => [personNorm(r.alias), r.canonical]));
export const aliasMapOf = rows => new Map((rows || []).map(a => [a.alias, a.canonical]));

/** The fullest spelling of one person: a real first name beats an initial, then the longer one. */
export function fullestName(names) {
  const score = n => { const t = personNorm(n).split(' ').filter(Boolean); return (t.length > 1 && t[0].length > 1 ? 1000 : 0) + personNorm(n).length; };
  return [...names].sort((a, b) => score(b) - score(a))[0];
}
