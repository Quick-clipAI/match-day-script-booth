// lib/player-season.js — one season of player numbers, built ONLY from the match details we have stored.
// "Creator Booth rating" = the average of the per-match ratings stored for that player (those ratings come from the match
// data source, so this average is ours and will differ a little from other sites). It covers only matches we have details for.
import { norm } from './bank-core.js';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** matches: [{id,league,season,date,home,away,hg,ag,_short?}], details: [{match_id,data}] -> Map(playerKey -> player) */
export function aggregatePlayers(matches, details) {
  const byId = new Map(matches.map(m => [m.id, m])); const out = new Map();
  for (const d of details) {
    const m = byId.get(d.match_id); const lu = d.data && d.data.lineups; if (!m || !lu || m.status !== 'finished') continue;
    for (const side of ['home', 'away']) {
      const club = side === 'home' ? m.home : m.away, opp = side === 'home' ? m.away : m.home;
      for (const p of [...((lu[side] && lu[side].xi) || []), ...((lu[side] && lu[side].subs) || [])]) {
        if (!p || !p.name) continue;
        const min = Number(p.min) || 0, g = Number(p.g) || 0, a = Number(p.a) || 0, r = num(p.rating);
        if (!min && !g && !a && r == null) continue;               // unused substitute
        const key = (p.id != null ? 'id' + p.id : norm(p.name)) + '|' + norm(club);
        const o = out.get(key) || { key, id: p.id != null ? p.id : null, name: p.name, club, pos: p.pos || '', apps: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, log: [] };
        o.apps++; o.minutes += min; o.goals += g; o.assists += a; o.yellow += Number(p.yc) || 0; o.red += Number(p.rc) || 0;
        o.log.push({ date: m.date, league: m.league, comp: m._short || m.league, opp, home: side === 'home', score: `${m.hg}-${m.ag}`, rating: r, min, g, a });
        out.set(key, o);
      }
    }
  }
  for (const o of out.values()) {
    o.log.sort((x, y) => (x.date < y.date ? 1 : -1));
    const rs = o.log.map(l => l.rating).filter(r => r != null);
    o.rated = rs.length; o.rating = rs.length ? Math.round(rs.reduce((s, r) => s + r, 0) / rs.length * 100) / 100 : null;
  }
  return out;
}

/** Best performers of one club: needs at least minRated rated matches. Newest matches count most via the `last` window. */
export function clubLeaders(players, club, { last = 5, minRated = 2, top = 3 } = {}) {
  const rows = [];
  for (const o of players.values()) {
    if (norm(o.club) !== norm(club)) continue;
    const w = o.log.slice(0, last), rs = w.map(l => l.rating).filter(r => r != null);
    if (rs.length < minRated) continue;
    rows.push({ name: o.name, pos: o.pos, n: w.length, avg: Math.round(rs.reduce((s, r) => s + r, 0) / rs.length * 100) / 100, g: w.reduce((s, l) => s + l.g, 0), a: w.reduce((s, l) => s + l.a, 0) });
  }
  return rows.sort((x, y) => y.avg - x.avg || (y.g + y.a) - (x.g + x.a)).slice(0, top);
}

/** Season leaderboards over a set of players. metric: 'goals' | 'assists' | 'rating' (rating needs minRated matches) */
export function leaderboard(players, metric, { top = 10, minRated = 3, league = null } = {}) {
  const rows = [];
  for (const o of players.values()) {
    const log = league ? o.log.filter(l => l.league === league) : o.log; if (!log.length) continue;
    const g = log.reduce((s, l) => s + l.g, 0), a = log.reduce((s, l) => s + l.a, 0), rs = log.map(l => l.rating).filter(r => r != null);
    rows.push({ name: o.name, club: o.club, apps: log.length, goals: g, assists: a, rated: rs.length, rating: rs.length ? Math.round(rs.reduce((s, r) => s + r, 0) / rs.length * 100) / 100 : null });
  }
  const f = metric === 'rating' ? rows.filter(r => r.rated >= minRated && r.rating != null).sort((x, y) => y.rating - x.rating) : rows.filter(r => r[metric] > 0).sort((x, y) => y[metric] - x[metric] || y.apps - x.apps);
  return f.slice(0, top);
}
