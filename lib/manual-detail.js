// lib/manual-detail.js  Turns a hand-written / AI-written JSON for ONE match (scorers, cards, stats, line-ups) into the same
// "detail" shape the match screen already reads from API-Football. Pure logic: no database or network.
import { norm } from './bank-core.js';

const STAT_LABELS = {
  possession: 'Ball Possession', xg: 'expected_goals', shots: 'Total Shots', shots_on_target: 'Shots on Goal', shots_off_target: 'Shots off Goal',
  blocked: 'Blocked Shots', corners: 'Corner Kicks', offsides: 'Offsides', fouls: 'Fouls', yellow_cards: 'Yellow Cards', red_cards: 'Red Cards',
  saves: 'Goalkeeper Saves', passes: 'Total passes', passes_accurate: 'Passes accurate'
};
export const STAT_KEYS = Object.keys(STAT_LABELS);
const POS = { G: 'G', GK: 'G', D: 'D', M: 'M', F: 'F', FW: 'F', ST: 'F' };
const int = v => (v === '' || v == null ? null : Number.isInteger(Number(v)) ? Number(v) : null);

function sideOf(t, match) {
  const s = norm(String(t == null ? '' : t));
  if (s === 'home' || (match && s === norm(match.home))) return 'home';
  if (s === 'away' || (match && s === norm(match.away))) return 'away';
  return null;
}

/** input: one match object. match (optional): the stored match, so team names can be used for "team". Returns { data, problems, warnings, score }. */
export function normalizeDetail(input, match = null) {
  const problems = [], warnings = [];
  const inp = input && typeof input === 'object' ? input : {};
  const data = { v: 1, source: 'manual', fetchedAt: new Date().toISOString() };
  if (inp.venue) data.venue = typeof inp.venue === 'string' ? { name: inp.venue.split(',')[0].trim(), city: inp.venue.split(',').slice(1).join(',').trim() || null } : { name: String(inp.venue.name || ''), city: inp.venue.city || null };
  if (inp.referee) data.referee = String(inp.referee).slice(0, 80);

  // events
  data.events = [];
  (Array.isArray(inp.events) ? inp.events : []).forEach((e, i) => {
    const at = `events[${i}]`;
    const side = sideOf(e && e.team, match); const m = int(e && (e.minute ?? e.m)), x = int(e && (e.extra ?? e.x));
    if (!side) return problems.push(`${at}: "team" must be "home", "away" or the club name`);
    if (m == null || m < 0 || m > 130) return problems.push(`${at}: "minute" must be a whole number 0-130`);
    const t = String(e.type || '').toLowerCase().replace(/[_-]/g, ' ').trim();
    const player = String(e.player || '').trim().slice(0, 60);
    if (['goal', 'own goal', 'penalty', 'missed penalty'].includes(t)) {
      if (!player) return problems.push(`${at}: a goal needs "player"`);
      data.events.push({ m, x, side, type: 'goal', detail: t === 'goal' ? 'Normal Goal' : t === 'own goal' ? 'Own Goal' : t === 'penalty' ? 'Penalty' : 'Missed Penalty', player, other: String(e.assist || '').trim().slice(0, 60) });
    } else if (['yellow', 'yellow card', 'red', 'red card', 'second yellow'].includes(t)) {
      if (!player) return problems.push(`${at}: a card needs "player"`);
      data.events.push({ m, x, side, type: 'card', detail: t.startsWith('red') ? 'Red Card' : t === 'second yellow' ? 'Second Yellow card' : 'Yellow Card', player, other: '' });
    } else if (['sub', 'substitution', 'subst'].includes(t)) {
      const on = String(e.on || '').trim().slice(0, 60), off = String(e.off || e.player || '').trim().slice(0, 60);
      if (!on || !off) return problems.push(`${at}: a substitution needs "on" and "off"`);
      data.events.push({ m, x, side, type: 'subst', detail: 'Substitution', player: off, other: on });
    } else problems.push(`${at}: "type" must be goal, own goal, penalty, yellow, red or sub (got "${e && e.type}")`);
  });
  data.events.sort((a, b) => (a.m + (a.x || 0) / 100) - (b.m + (b.x || 0) / 100));

  // statistics: { possession: [47, 53], shots: [22, 18], ... }
  data.stats = [];
  const st = inp.stats && typeof inp.stats === 'object' ? inp.stats : {};
  for (const k of Object.keys(st)) {
    const label = STAT_LABELS[k];
    if (!label) { warnings.push(`stats: "${k}" is not a known statistic and was skipped (known: ${STAT_KEYS.join(', ')})`); continue; }
    const v = st[k];
    if (!Array.isArray(v) || v.length !== 2) { problems.push(`stats.${k}: give [home, away]`); continue; }
    const n = v.map(z => (z === null || z === '' ? null : Number(String(z).replace('%', ''))));
    if (n.some(z => z == null || !Number.isFinite(z) || z < 0)) { problems.push(`stats.${k}: both values must be numbers 0 or more`); continue; }
    if (k === 'possession') { if (n[0] > 100 || n[1] > 100) { problems.push('stats.possession: each value is a percentage up to 100'); continue; } if (Math.abs(n[0] + n[1] - 100) > 2) warnings.push(`stats.possession adds up to ${n[0] + n[1]}, not 100`); }
    data.stats.push({ label, home: k === 'possession' ? n[0] + '%' : n[0], away: k === 'possession' ? n[1] + '%' : n[1] });
  }

  // line-ups
  data.lineups = {};
  const lu = inp.lineups && typeof inp.lineups === 'object' ? inp.lineups : {};
  for (const side of ['home', 'away']) {
    const l = lu[side]; if (!l) continue;
    const person = (p, at) => {
      const name = String(p && p.name || '').trim().slice(0, 60); if (!name) { problems.push(`${at}: a player needs "name"`); return null; }
      const pos = POS[String(p.pos || '').toUpperCase()] || '';
      const grid = p.grid == null || p.grid === '' ? null : String(p.grid);
      if (grid && !/^\d:\d$/.test(grid)) { problems.push(`${at}: "grid" must look like "2:3" (row from the goalkeeper : place from the left)`); return null; }
      const rating = p.rating == null || p.rating === '' ? null : Number(p.rating);
      if (rating != null && !(rating >= 1 && rating <= 10)) { problems.push(`${at}: "rating" must be 1-10`); return null; }
      return { id: null, n: int(p.n ?? p.number), name, pos, grid, rating, min: int(p.min), g: int(p.goals) || 0, a: int(p.assists) || 0, yc: int(p.yellow) || 0, rc: int(p.red) || 0, sv: 0 };
    };
    const xi = (Array.isArray(l.xi) ? l.xi : []).map((p, i) => person(p, `lineups.${side}.xi[${i}]`)).filter(Boolean);
    const subs = (Array.isArray(l.subs) ? l.subs : []).map((p, i) => person(p, `lineups.${side}.subs[${i}]`)).filter(Boolean);
    if (xi.length && xi.length !== 11) warnings.push(`lineups.${side}: ${xi.length} starters (expected 11)`);
    const gridCount = xi.filter(p => p.grid).length;
    if (gridCount && gridCount !== xi.length) warnings.push(`lineups.${side}: only ${gridCount} of ${xi.length} starters have a "grid", so the pitch will group them by position instead`);
    if (!gridCount && xi.length && xi.some(p => !p.pos)) warnings.push(`lineups.${side}: without "grid", give every starter a "pos" (G, D, M or F) so the pitch can place them`);
    data.lineups[side] = { formation: l.formation ? String(l.formation).slice(0, 12) : null, coach: l.coach ? String(l.coach).slice(0, 60) : null, xi, subs };
  }

  // man of the match = highest rating, only when ratings were given
  let best = null;
  for (const side of ['home', 'away']) { const l = data.lineups[side]; if (l) [...l.xi, ...l.subs].forEach(p => { if (p.rating != null && (!best || p.rating > best.rating)) best = { name: p.name, rating: p.rating, side }; }); }
  data.best = best;

  // score, if given
  let score = null;
  if (inp.score) {
    const hg = int(inp.score.hg), ag = int(inp.score.ag);
    if (hg == null || ag == null || hg < 0 || ag < 0 || hg > 40 || ag > 40) problems.push('score: "hg" and "ag" must be whole numbers');
    else { score = { hg, ag, ht_h: int(inp.score.ht_h), ht_a: int(inp.score.ht_a) }; }
  }
  // goals listed vs score
  const sc = score || (match && match.hg != null ? { hg: match.hg, ag: match.ag } : null);
  if (sc) {
    const h = data.events.filter(e => e.type === 'goal' && e.detail !== 'Missed Penalty' && e.side === 'home').length, a = data.events.filter(e => e.type === 'goal' && e.detail !== 'Missed Penalty' && e.side === 'away').length;
    if (data.events.some(e => e.type === 'goal') && (h !== sc.hg || a !== sc.ag)) warnings.push(`The goals listed give ${h}-${a} but the score is ${sc.hg}-${sc.ag}. "team" for a goal is the side it counts for.`);
  }
  if (!data.events.length && !data.stats.length && !Object.keys(data.lineups).length && !data.venue && !data.referee && !score) problems.push('Nothing to save: add events, stats, lineups, venue, referee or score.');
  return { data, problems, warnings, score };
}

export const DETAIL_PROMPT = `I will give you a football match report. Reply with ONLY valid JSON (no commentary, no code fence) in exactly this shape. Leave out any part you are not sure of; never guess.

{
  "league": "EPL",              // EPL, LALIGA, SERIEA, BUNDESLIGA, LIGUE1, SPL, UCL, UEL, UECL, INTERMIAMI
  "season": 2026,               // the year the season STARTS
  "date": "2026-10-24", "home": "Arsenal", "away": "Chelsea",
  "score": { "hg": 2, "ag": 1, "ht_h": 1, "ht_a": 0 },
  "venue": "Emirates Stadium, London", "referee": "A. Taylor",
  "events": [
    { "minute": 17, "team": "home", "type": "goal", "player": "B. Saka", "assist": "M. Odegaard" },
    { "minute": 45, "extra": 2, "team": "away", "type": "yellow", "player": "E. Fernandez" },
    { "minute": 60, "team": "away", "type": "sub", "on": "C. Palmer", "off": "N. Jackson" }
  ],
  "stats": { "possession": [47, 53], "shots": [14, 9], "shots_on_target": [6, 3], "corners": [5, 2], "fouls": [10, 12], "yellow_cards": [1, 2], "red_cards": [0, 0] },
  "lineups": {
    "home": { "formation": "4-3-3", "coach": "M. Arteta", "xi": [ { "n": 22, "name": "D. Raya", "pos": "G", "grid": "1:1" } ], "subs": [ { "n": 19, "name": "L. Trossard", "pos": "F" } ] },
    "away": { "formation": "4-2-3-1", "coach": "E. Maresca", "xi": [], "subs": [] }
  }
}

Rules:
- "team" is "home" or "away" (or the club name). For a goal it is the side the goal COUNTS FOR (so an own goal is listed under the side that gets the goal).
- event "type": goal, own goal, penalty, yellow, red, sub. Minutes are whole numbers; "extra" is stoppage-time minutes.
- Statistics are [home, away]. Allowed keys: possession, xg, shots, shots_on_target, shots_off_target, blocked, corners, offsides, fouls, yellow_cards, red_cards, saves, passes, passes_accurate.
- Line-ups: 11 starters. "pos" is G, D, M or F. "grid" is "row:place": row 1 is the goalkeeper, rows go up the pitch, place counts from the left (e.g. a 4-3-3 has rows 1, 2 (4 players), 3 (3 players), 4 (3 players)). Leave "grid" out if you are not sure.
- Do not invent players, minutes or numbers.
- Several matches: wrap them as { "matches": [ { ...match one... }, { ...match two... } ] }.`;
