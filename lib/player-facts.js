// lib/player-facts.js — when a chat question names a player, hand the AI the facts we store about him (club, age, position,
// shirt, nationality, loan, and this season's numbers from our stored matches). Deterministic: no AI decides what to look up.
// A name only counts when it points to exactly ONE stored player; otherwise nothing is added (never a guess).
import { norm } from './bank-core.js';
import { ageOn } from './bank-squad.js';
import { loadSeasonPlayers } from './player-card.js';
import { sameApiName } from './bank-profiles.js';

const COMMON = new Set(['messi', 'real', 'city', 'united', 'town', 'with', 'what', 'give', 'about', 'player', 'analysis', 'tell', 'stats', 'form', 'goals', 'season', 'sporting', 'league', 'match', 'today']);

/** roster rows -> { full: Map(normName -> [rows]), last: Map(surname -> [rows]) }; the newest season of each player only. */
export function buildPlayerIndex(roster) {
  const newest = new Map();
  for (const p of roster || []) {
    if (!p || !p.name || p.club_status === 'retired') continue;
    const k = norm(p.name) + '|' + norm(p.club);
    const o = newest.get(k); if (!o || Number(p.season) > Number(o.season)) newest.set(k, p);
  }
  const full = new Map(), last = new Map();
  const add = (m, k, p) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
  for (const p of newest.values()) {
    const t = norm(p.name).split(' ').filter(Boolean); if (!t.length) continue;
    add(full, t.join(' '), p);
    if (t.length > 1 && t[t.length - 1].length >= 5) add(last, t[t.length - 1], p);
  }
  return { full, last };
}

/** Players named in the question (max 2), each matching exactly one stored player. */
export function findPlayers(qn, idx) {
  const w = String(qn || '').split(' ').filter(Boolean), out = [], seen = new Set();
  const take = p => { const k = norm(p.name) + '|' + norm(p.club); if (!seen.has(k)) { seen.add(k); out.push(p); } };
  for (let len = Math.min(4, w.length); len >= 1; len--) {
    for (let i = 0; i + len <= w.length; i++) {
      const g = w.slice(i, i + len).join(' ');
      if (len === 1 && (g.length < 4 || COMMON.has(g))) continue;
      let hits = idx.full.get(g); if (!hits && len === 1) hits = idx.last.get(g);
      if (hits && hits.length === 1) take(hits[0]);
      if (out.length >= 2) return out;
    }
  }
  return out;
}

/** The text block for one stored player. */
export function playerBlock(p, todayISO, seasonObj) {
  const age = p.dob ? ageOn(String(p.dob).slice(0, 10), todayISO) : null;
  const bits = [`${p.name} — ${p.club} (${p.league}, squad season ${p.season}/${String(Number(p.season) + 1).slice(-2)})`];
  if (p.position) bits.push('position: ' + p.position);
  if (p.shirt) bits.push('shirt ' + p.shirt);
  if (p.nationality) bits.push('nationality: ' + p.nationality);
  if (p.dob) bits.push(`born ${String(p.dob).slice(0, 10)}${age != null ? ' (age ' + age + ' today)' : ''}`);
  if (p.on_loan && p.loan_from) bits.push('on loan from ' + p.loan_from);
  let line = 'PLAYER (data bank): ' + bits.join('; ') + '.';
  if (seasonObj && seasonObj.apps) {
    const rated = seasonObj.rating != null ? `, average match rating ${seasonObj.rating}` : '';
    line += ` Stored matches this season (only those we hold details for): ${seasonObj.apps} appearance(s), ${seasonObj.minutes || 0} minutes, ${seasonObj.goals || 0} goal(s), ${seasonObj.assists || 0} assist(s)${rated}.`;
  }
  return line;
}

/** Looks up the stored season numbers for one roster row. */
export async function seasonStatsFor(store, p, todayISO) {
  try {
    const players = await Promise.race([loadSeasonPlayers(store, todayISO), new Promise(r => setTimeout(() => r(null), 3500))]);
    if (!players) return null;
    for (const o of players.values()) if (norm(o.club) === norm(p.club) && sameApiName(o.name, p.name)) return o;
  } catch (e) { /* numbers are optional */ }
  return null;
}
