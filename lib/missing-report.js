// lib/missing-report.js — which stored players lack data, one row per player (latest season of each league). No API requests.
import { profileFinder } from './bank-profiles.js';

/** players: bank_players rows. profiles: light rows { id, norm, dob, mv, tr } (see store.profileIndex). */
export function missingReport(players, profiles) {
  const top = new Map();
  for (const p of players) if (!top.has(p.league) || p.season > top.get(p.league)) top.set(p.league, p.season);
  const find = profileFinder(profiles);
  const rows = [];
  for (const p of players) {
    if (p.season !== top.get(p.league)) continue;
    const pr = find(p), tr = pr && Array.isArray(pr.tr) ? pr.tr : [];
    const hasTransfers = !!(pr && tr.length), hasValue = !!(pr && pr.mv != null);
    const miss = [];
    if (!p.nationality) miss.push('nationality');
    if (!p.dob && p.age == null) miss.push('birth date and age'); else if (!p.dob) miss.push('exact birth date');
    if (p.shirt == null) miss.push('shirt number');
    if (!p.position) miss.push('position');
    if (!pr) miss.push('no Transfermarkt profile (transfer history, market value)');
    else { if (!hasTransfers) miss.push('transfer history'); if (!hasValue) miss.push('market value'); }
    if (!miss.length) continue;
    rows.push({ name: p.name, club: p.club, league: p.league, season: p.season, position: p.position || '', shirt: p.shirt == null ? '' : p.shirt, birth_date: p.dob || '', age: p.age == null ? '' : p.age,
      nationality: p.nationality || '', has_transfer_history: hasTransfers ? 'yes' : 'no', has_market_value: hasValue ? 'yes' : 'no', missing: miss.join('; ') });
  }
  rows.sort((a, b) => String(a.league).localeCompare(b.league) || String(a.club).localeCompare(b.club) || String(a.name).localeCompare(b.name));
  return rows;
}
