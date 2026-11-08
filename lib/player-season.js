// lib/player-season.js — one season of player numbers, built ONLY from the match details we have stored.
// "Creator Booth rating" = the average of the per-match ratings stored for that player. Those ratings come from the match data
// source, so this average is ours and will differ a little from other sites. It covers only matches we have details for.
// Players are matched across sources by club + surname + first initial ("B. Mbeumo" = "Bryan Mbeumo"), because each source has its own ids.
import { norm } from './bank-core.js';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
const r2 = x => Math.round(x * 100) / 100;

/** stable key: club | surname | first initial (empty for one-word names such as "Casemiro") */
export function playerKey(name, club) {
  const parts = norm(name).split(' ').filter(Boolean);
  if (!parts.length) return norm(club) + '||';
  const sur = parts[parts.length - 1], ini = parts.length > 1 ? parts[0][0] : '';
  return norm(club) + '|' + sur + '|' + ini;
}

/** matches: [{id,league,season,date,home,away,hg,ag,status,_short?}], details: [{match_id,data}] -> Map(key -> player) */
export function aggregatePlayers(matches, details) {
  const byId = new Map(matches.map(m => [m.id, m])); const out = new Map();
  const get = (name, club, pos) => {
    const k = playerKey(name, club); let o = out.get(k);
    if (!o) { o = { key: k, name, club, pos: pos || '', log: new Map() }; out.set(k, o); }
    if (name.length > o.name.length) o.name = name;                       // keep the fullest spelling
    if (pos && !o.pos) o.pos = pos;
    return o;
  };
  const entry = (o, m, side) => {
    let e = o.log.get(m.id);
    if (!e) { e = { id: m.id, date: m.date, league: m.league, comp: m._short || m.league, opp: side === 'home' ? m.away : m.home, home: side === 'home', score: `${m.hg}-${m.ag}`, rating: null, min: 0, g: 0, a: 0, yc: 0, rc: 0, played: false }; o.log.set(m.id, e); }
    return e;
  };
  const seen = new Set();                                                   // one detail row per match, so goals can never be counted twice
  for (const d of details) {
    if (seen.has(d.match_id)) continue; seen.add(d.match_id);
    const m = byId.get(d.match_id); const D = d.data; if (!m || !D || D.unavailable || m.status !== 'finished') continue;
    const lu = D.lineups || {}, ev = Array.isArray(D.events) ? D.events : [];
    const goalEvents = ev.filter(e => e.type === 'goal' && !/missed/i.test(e.detail || ''));
    for (const side of ['home', 'away']) {
      const club = side === 'home' ? m.home : m.away;
      for (const p of [...((lu[side] && lu[side].xi) || []), ...((lu[side] && lu[side].subs) || [])]) {
        if (!p || !p.name) continue;
        const min = Number(p.min) || 0, r = num(p.rating);
        const used = min > 0 || r != null || (lu[side].xi || []).includes(p);
        if (!used && !p.g && !p.a) continue;                                // unused substitute
        const e = entry(get(p.name, club, p.pos), m, side);
        e.played = true; e.min = min || e.min; e.rating = r != null ? r : e.rating; e.yc += Number(p.yc) || 0; e.rc += Number(p.rc) || 0;
        if (!goalEvents.length) { e.g += Number(p.g) || 0; e.a += Number(p.a) || 0; }   // goals from player lines only when there is no goal list
      }
    }
    for (const g of goalEvents) {                                           // goal list: scorer and assist per event
      const side = g.side === 'home' ? 'home' : 'away', club = side === 'home' ? m.home : m.away;
      if (/own goal/i.test(g.detail || '')) continue;
      if (g.player) entry(get(g.player, club), m, side).g++;
      if (g.other) entry(get(g.other, club), m, side).a++;
    }
  }
  for (const o of out.values()) {
    o.log = [...o.log.values()].sort((x, y) => (x.date < y.date ? 1 : -1));
    const rs = o.log.map(l => l.rating).filter(r => r != null);
    o.apps = o.log.filter(l => l.played).length; o.minutes = o.log.reduce((s, l) => s + l.min, 0);
    o.goals = o.log.reduce((s, l) => s + l.g, 0); o.assists = o.log.reduce((s, l) => s + l.a, 0);
    o.yellow = o.log.reduce((s, l) => s + l.yc, 0); o.red = o.log.reduce((s, l) => s + l.rc, 0);
    o.rated = rs.length; o.rating = rs.length ? r2(rs.reduce((s, r) => s + r, 0) / rs.length) : null;
  }
  return out;
}

/** Best recent performers of one club: at least minRated rated matches inside the last `last` matches. */
export function clubLeaders(players, club, { last = 5, minRated = 2, top = 3 } = {}) {
  const rows = [];
  for (const o of players.values()) {
    if (norm(o.club) !== norm(club)) continue;
    const w = o.log.filter(l => l.played).slice(0, last), rs = w.map(l => l.rating).filter(r => r != null);
    if (rs.length < minRated) continue;
    rows.push({ name: o.name, pos: o.pos, n: w.length, avg: r2(rs.reduce((s, r) => s + r, 0) / rs.length), g: w.reduce((s, l) => s + l.g, 0), a: w.reduce((s, l) => s + l.a, 0) });
  }
  return rows.sort((x, y) => y.avg - x.avg || (y.g + y.a) - (x.g + x.a)).slice(0, top);
}

/** Season leaderboards. metric: 'goals' | 'assists' | 'rating' (rating needs minRated rated matches) */
export function leaderboard(players, metric, { top = 10, minRated = 3, league = null } = {}) {
  const rows = [];
  for (const o of players.values()) {
    const log = league ? o.log.filter(l => l.league === league) : o.log; if (!log.length) continue;
    const rs = log.map(l => l.rating).filter(r => r != null);
    rows.push({ key: o.key, name: o.name, club: o.club, apps: log.filter(l => l.played).length, goals: log.reduce((s, l) => s + l.g, 0), assists: log.reduce((s, l) => s + l.a, 0), rated: rs.length, rating: rs.length ? r2(rs.reduce((s, r) => s + r, 0) / rs.length) : null });
  }
  const f = metric === 'rating' ? rows.filter(r => r.rated >= minRated && r.rating != null).sort((x, y) => y.rating - x.rating || y.rated - x.rated) : rows.filter(r => r[metric] > 0).sort((x, y) => y[metric] - x[metric] || x.apps - y.apps);
  return f.slice(0, top);
}

/** One player's card across every competition of the season. */
export function playerCard(o) {
  if (!o) return null;
  const byComp = new Map();
  for (const l of o.log) { const c = byComp.get(l.league) || { league: l.league, comp: l.comp, apps: 0, goals: 0, assists: 0, rs: [] }; if (l.played) c.apps++; c.goals += l.g; c.assists += l.a; if (l.rating != null) c.rs.push(l.rating); byComp.set(l.league, c); }
  return {
    key: o.key, name: o.name, club: o.club, pos: o.pos, apps: o.apps, minutes: o.minutes, goals: o.goals, assists: o.assists, yellow: o.yellow, red: o.red, rating: o.rating, rated: o.rated,
    competitions: [...byComp.values()].map(c => ({ league: c.league, comp: c.comp, apps: c.apps, goals: c.goals, assists: c.assists, rating: c.rs.length ? r2(c.rs.reduce((s, r) => s + r, 0) / c.rs.length) : null, rated: c.rs.length })),
    matches: o.log.map(l => ({ date: l.date, comp: l.comp, opp: l.opp, home: l.home, score: l.score, min: l.min || null, rating: l.rating, g: l.g, a: l.a, yc: l.yc, rc: l.rc, played: l.played }))
  };
}
