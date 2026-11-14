// lib/player-trophies.js — a player's club trophies, worked out from his transfer history and the club trophies we store.
// Honest limits: it counts the seasons he was at the club (by transfer dates), not whether he played; only trophies in bank_club_trophies
// (European + the 7 domestic leagues we store); no international trophies and no personal awards yet.
import { trophiesFor, trophyKey } from './trophies.js';

/** API-Football `transfers?player=` answer -> [{ date, type, in: {id,name}, out: {id,name} }] oldest first */
export function movesFromApi(json) {
  const rows = (json && json.response && json.response[0] && json.response[0].transfers) || [];
  return rows.map(t => ({ date: String(t.date || '').slice(0, 10), type: t.type || null,
    in: t.teams && t.teams.in ? { id: t.teams.in.id || null, name: t.teams.in.name || '' } : { id: null, name: '' },
    out: t.teams && t.teams.out ? { id: t.teams.out.id || null, name: t.teams.out.name || '' } : { id: null, name: '' } }))
    .filter(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date)).sort((a, b) => a.date.localeCompare(b.date));
}

/** moves -> stints [{ club, from, to }]: from null = since before his first listed move, to null = still there */
export function stintsFromMoves(moves) {
  const ms = (moves || []).slice().sort((a, b) => a.date.localeCompare(b.date)); const out = [];
  if (!ms.length) return out;
  if (ms[0].out && ms[0].out.name) out.push({ club: ms[0].out.name, from: null, to: ms[0].date });
  ms.forEach((m, i) => { if (m.in && m.in.name) out.push({ club: m.in.name, from: m.date, to: i + 1 < ms.length ? ms[i + 1].date : null }); });
  return out;
}

// a trophy season's window: "2024-25" = Aug 2024 .. Jun 2025; a single year = that calendar year (Super Cup: August)
function seasonEnd(season, comp) {
  const y = Number(String(season).slice(0, 4)); if (!y) return null;
  if (/^\d{4}-\d{2}$/.test(season)) return `${y + 1}-06-30`;
  return comp === 'USC' ? `${y}-08-31` : `${y}-12-31`;
}
// he is credited when he was at the club at the end of the season (left in January = not credited; joined in January = credited)
function atClub(stint, end, comp) {
  if (!end) return false;
  const from = stint.from || '0000-00-00';
  const lastDay = stint.to ? stint.to : '9999-12-31';
  const mustStay = comp === 'USC' ? end : end.slice(0, 4) + '-05-01';   // left before May: missed the title
  return from <= end && lastDay >= mustStay;
}

/** -> { clubs: [{ club, from, to, trophies: [{key,name,count,seasons}] }], total } ; clubs with no stored trophy are left out */
export function playerTrophies(moves, trophyRows) {
  const clubs = []; let total = 0;
  const stints = stintsFromMoves(moves);
  const merged = new Map();            // one block per club even if he came back (loan, return)
  for (const s of stints) {
    const k = trophyKey(s.club); const g = merged.get(k) || { club: s.club, stints: [] }; g.stints.push(s); merged.set(k, g);
  }
  for (const g of merged.values()) {
    const rows = trophiesFor(trophyRows, g.club); const mine = [];
    for (const t of rows) {
      const seasons = t.seasons.filter(sn => { const end = seasonEnd(sn, t.key); return g.stints.some(st => atClub(st, end, t.key)); });
      if (seasons.length) { mine.push({ key: t.key, name: t.name, count: seasons.length, seasons }); total += seasons.length; }
    }
    if (mine.length) {
      const from = g.stints.map(s => s.from).filter(Boolean).sort()[0] || null; const open = g.stints.some(s => !s.to);
      const to = open ? null : g.stints.map(s => s.to).sort().slice(-1)[0];
      clubs.push({ club: g.club, from: from ? from.slice(0, 4) : null, to: to ? to.slice(0, 4) : null, trophies: mine });
    }
  }
  clubs.sort((a, b) => (b.trophies.reduce((n, t) => n + t.count, 0)) - (a.trophies.reduce((n, t) => n + t.count, 0)));
  return { clubs, total };
}
