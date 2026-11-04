// lib/striker-import.js — turns StrikerAPI get_game answers (saved in striker_results) into the match details our match screen reads.
// get_game holds: team stats, one line per player (minutes on/off, goals, assists, shots, cards, saves) and venue.
// It does NOT hold goal minutes, substitution events, formations or coaches, so those stay empty (get_events would add minutes, 10 credits a match).
import { norm } from './bank-core.js';
import { sameTeam } from './sync-due.js';

const n0 = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nn = v => { const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };

/** { cls: G|D|M|F, r: row (back to front), c: column left to right as the team sees it } from StrikerAPI's position text. */
export function posOf(position) {
  const t = String(position || '').toLowerCase();
  let cls = 'M', r = 4;
  if (/goalkeeper/.test(t)) { cls = 'G'; r = 1; }
  else if (/defender|back\b/.test(t)) { cls = 'D'; r = 2; }
  else if (/attacking midfielder/.test(t)) { cls = 'M'; r = 5; }
  else if (/defensive midfielder/.test(t)) { cls = 'M'; r = 3; }
  else if (/midfielder/.test(t)) { cls = 'M'; r = 4; }
  else if (/forward|striker|wing/.test(t)) { cls = 'F'; r = 6; }
  const c = /center left/.test(t) ? 1 : /center right/.test(t) ? 3 : /left/.test(t) ? 0 : /right/.test(t) ? 4 : 2;
  return { cls, r, c };
}

const statRows = (h, a) => {
  const pc = x => (x == null ? 0 : x);
  const rows = [];
  const add = (label, hv, av) => { if (hv != null || av != null) rows.push({ label, home: pc(hv), away: pc(av) }); };
  add('Ball Possession', h.possession_pct != null ? h.possession_pct + '%' : null, a.possession_pct != null ? a.possession_pct + '%' : null);
  add('expected_goals', h.xg, a.xg);
  add('Total Shots', h.shots, a.shots); add('Shots on Goal', h.shots_on_target, a.shots_on_target); add('Blocked Shots', h.blocked_shots, a.blocked_shots);
  add('Corner Kicks', h.corners, a.corners); add('Offsides', h.offsides, a.offsides); add('Fouls', h.fouls, a.fouls);
  add('Yellow Cards', h.yellow_cards, a.yellow_cards); add('Red Cards', h.red_cards, a.red_cards); add('Goalkeeper Saves', h.saves, a.saves);
  add('Total passes', h.passes, a.passes); add('Passes accurate', h.accurate_passes, a.accurate_passes);
  const pp = x => (x.passes ? Math.round(x.accurate_passes / x.passes * 100) + '%' : null);
  add('Passes %', pp(h), pp(a));
  add('Tackles', h.tackles, a.tackles); add('Interceptions', h.interceptions, a.interceptions); add('Clearances', h.clearances, a.clearances);
  return rows;
};

/** @param json one saved get_game answer ({data:{game, team_stats, players}}) -> our detail object, or null when unusable */
export function convertGame(json, nowISO = new Date().toISOString()) {
  const d = json && (json.data && json.data.game ? json.data : json);
  const game = d && d.game; if (!game || !game.home || !game.away) return null;
  const hid = String(game.home.team_id), aid = String(game.away.team_id);
  const ts = Array.isArray(d.team_stats) ? d.team_stats : [];
  const th = ts.find(t => String(t.team_id) === hid) || {}, ta = ts.find(t => String(t.team_id) === aid) || {};
  const lineups = {};
  for (const [side, id] of [['home', hid], ['away', aid]]) {
    const pl = (d.players || []).filter(p => String(p.team_id) === id);
    const person = p => {
      const off = nn(p.minute_off), on = nn(p.minute_on) || 0;
      const min = p.starter ? (off != null ? off : 90) : (nn(p.minute_on) == null ? null : (off != null ? off : 90) - on);
      return { id: p.player_id || null, n: nn(p.jersey), name: p.name || '', pos: p.starter ? posOf(p.position).cls : '', role: p.position || '', _r: posOf(p.position).r, _c: posOf(p.position).c,
        min, g: n0(p.goals), a: n0(p.assists), og: n0(p.own_goals), yc: n0(p.yellow_cards), rc: n0(p.red_cards), sv: n0(p.saves), sh: n0(p.shots), sot: n0(p.shots_on_target), rating: null, grid: null };
    };
    const xi = pl.filter(p => p.starter).map(person).sort((x, y) => x._r - y._r || x._c - y._c);
    xi.forEach(p => { p.grid = p._r + ':' + p._c; });
    const strip = p => { const { _r, _c, ...rest } = p; return rest; };
    const subs = pl.filter(p => !p.starter).map(person).map(strip);
    if (xi.length || subs.length) lineups[side] = { formation: null, coach: null, xi: xi.map(strip), subs };
  }
  const stats = statRows(th, ta);
  if (!Object.keys(lineups).length && !stats.length) return null;
  return { v: 1, source: 'strikerapi', fetchedAt: nowISO, venue: game.venue ? { name: game.venue, city: game.city || null } : null, attendance: nn(game.attendance), referee: null, events: [], lineups, stats, best: null };
}

/** Finds our match for a StrikerAPI game: same date and score, then team names to settle ties. -> bank match or null */
export function findMatch(game, finished, aliasMap = new Map()) {
  const d = String(game.date || '').slice(0, 10), hs = nn(game.home && game.home.score), as = nn(game.away && game.away.score);
  let c = finished.filter(m => m.date === d && m.hg === hs && m.ag === as);
  if (c.length <= 1) return c[0] || null;
  const hn = game.home.name, an = game.away.name;
  c = c.filter(m => sameTeam(hn, m.home, aliasMap) || sameTeam(an, m.away, aliasMap));
  return c.length === 1 ? c[0] : null;
}

/** Saves converted details for every saved StrikerAPI match we can place. Never overwrites details from another source. */
export async function importStriker(store, { league = 'UCL', season = 2026, now = Date.now() } = {}) {
  const games = await store.strikerGames();
  const finished = (await store.listMatches({ league, season })).filter(m => m.status === 'finished' && m.hg != null);
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const out = { games: games.length, saved: 0, kept: 0, unmatched: [], unusable: 0 };
  const seen = new Set();
  for (const g of games) {
    const inner = g && (g.data && g.data.game ? g.data : g); const detail = convertGame(g, new Date(now).toISOString()); const game = inner && inner.game;
    if (!detail || !game) { out.unusable++; continue; }
    const m = findMatch(game, finished, aliasMap);
    if (!m) { out.unmatched.push(`${game.date} ${game.home.name} ${game.home.score}-${game.away.score} ${game.away.name}`); continue; }
    if (seen.has(m.id)) continue; seen.add(m.id);
    const old = await store.getDetail(m.id).catch(() => null);
    if (old && old.data && !old.data.unavailable && old.data.source !== 'strikerapi') { out.kept++; continue; }
    await store.saveManualDetail(m.id, detail); out.saved++;
  }
  out.summary = `StrikerAPI import: ${out.saved} match(es) saved, ${out.kept} kept as they were, ${out.unmatched.length} not placed, ${out.unusable} unusable`;
  await store.addLog({ kind: 'striker-import', ok: true, summary: out.summary, detail: { saved: out.saved, kept: out.kept, unmatched: out.unmatched.slice(0, 20) } });
  return out;
}
