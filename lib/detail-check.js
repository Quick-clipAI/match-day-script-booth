// lib/detail-check.js — "what could go wrong after I save this?" for one match detail (manual import). Pure logic: no database, no network.
// Returns plain-language lines { level: 'warn' | 'info', text }. Nothing here blocks a save; it tells the person what to look at first.
import { personNorm } from './bank-profiles.js';
import { sameCoach, variantCoach } from './coach-flags.js';
import { lev } from './coach-canon.js';

const list = (a, n = 8) => a.slice(0, n).join(', ') + (a.length > n ? ` and ${a.length - n} more` : '');

/** Best squad entry for a name: exact (accent/case-free), same surname + same first letter, or a close spelling. Returns { kind: 'exact'|'close', name } or null. */
export function findPlayer(name, squad) {
  const x = personNorm(name); if (!x) return null;
  const rows = squad.map(n => ({ n, k: personNorm(n) }));
  const ex = rows.find(r => r.k === x); if (ex) return { kind: 'exact', name: ex.n };
  const tx = x.split(' '), sx = tx[tx.length - 1];
  const bySur = rows.filter(r => { const t = r.k.split(' '); return t[t.length - 1] === sx && (tx.length < 2 || t.length < 2 || t[0][0] === tx[0][0]); });
  if (bySur.length === 1) return { kind: 'close', name: bySur[0].n };
  const near = rows.map(r => ({ ...r, d: lev(r.k, x) })).filter(r => r.d <= 2).sort((a, b) => a.d - b.d);
  if (near.length && (near.length === 1 || near[0].d < near[1].d)) return { kind: 'close', name: near[0].n };
  return null;
}

/**
 * item: the match JSON to import. match: the stored match (or null).
 * ctx: { squads: { home: [names] | null, away: [...] | null }, coaches: { home: name|null, away: name|null }, nameMap }
 */
export function checkDetail(item, match, ctx = {}) {
  const out = [], warn = text => out.push({ level: 'warn', text }), info = text => out.push({ level: 'info', text });
  const lu = item.lineups || {}, events = Array.isArray(item.events) ? item.events : [];

  // 1. the match itself
  if (match) {
    if (match.hg != null && item.score && (match.hg !== Number(item.score.hg) || match.ag !== Number(item.score.ag))) warn(`Score differs from the stored one: stored ${match.hg}-${match.ag}, file ${item.score.hg}-${item.score.ag}. Saving will replace the stored score.`);
    if (item.date && match.date && Math.abs(Date.parse(item.date) - Date.parse(match.date)) > 864e5) warn(`Date differs: stored ${match.date}, file ${item.date}.`);
  }

  // 2. line-ups: structure
  for (const side of ['home', 'away']) {
    const l = lu[side]; if (!l) { info(`No ${side} line-up in the file.`); continue; }
    const club = item[side], all = [...(l.xi || []), ...(l.subs || [])], names = all.map(p => personNorm(p.name));
    if ((l.xi || []).length !== 11) warn(`${club}: ${(l.xi || []).length} starters, not 11.`);
    const dup = names.filter((n, i) => names.indexOf(n) !== i); if (dup.length) warn(`${club}: the same player is listed twice: ${list([...new Set(dup)])}.`);
    const nums = all.map(p => p.n).filter(n => n != null), dn = nums.filter((n, i) => nums.indexOf(n) !== i); if (dn.length) warn(`${club}: shirt number used twice: ${list([...new Set(dn)])}.`);
    const odd = all.filter(p => p.min != null && (p.min < 0 || p.min > 125)); if (odd.length) warn(`${club}: strange minutes for ${list(odd.map(p => p.name))}.`);
    // 3. names against our squad
    const squad = ctx.squads && ctx.squads[side];
    if (!squad || !squad.length) info(`${club}: we have no squad for this club, so its player names cannot be checked against ours. Any new name will stay only inside this match.`);
    else {
      const miss = [], close = [];
      for (const p of all) { const f = findPlayer(p.name, squad); if (!f) miss.push(p.name); else if (f.kind === 'close' && personNorm(f.name) !== personNorm(p.name)) close.push(`${p.name} → ${f.name}`); }
      if (close.length) warn(`${club}: spelled differently from our squad (will not join the player's page until they match): ${list(close)}.`);
      if (miss.length) warn(`${club}: not in our squad list: ${list(miss)}. (New signing, youth player, or a very different spelling.)`);
      if (!close.length && !miss.length) info(`${club}: every player is in our squad list.`);
    }
    // 4. coach
    const ours = ctx.coaches && ctx.coaches[side];
    if (l.coach && ours) { if (!(sameCoach(l.coach, ours, ctx.nameMap) || variantCoach(l.coach, ours, ctx.nameMap))) warn(`${club}: the file's coach is ${l.coach}, our table says ${ours}.`); }
    else if (l.coach && !ours) info(`${club}: no coach in our table to compare with (${l.coach}).`);
  }

  // 5. events against the line-ups
  const known = new Set(['home', 'away'].flatMap(s => [...((lu[s] && lu[s].xi) || []), ...((lu[s] && lu[s].subs) || [])].map(p => personNorm(p.name))));
  if (known.size) {
    const unknown = new Set();
    for (const e of events) for (const n of [e.player, e.assist, e.on, e.off]) { if (n && !known.has(personNorm(n))) unknown.add(n); }
    if (unknown.size) warn(`Named in the events but not in either line-up: ${list([...unknown])}.`);
  }
  const redE = events.filter(e => e.type === 'red' || e.type === 'second yellow').length, red = item.stats && item.stats.red_cards;
  if (red && red[0] + red[1] !== redE) warn(`Red cards: the statistics say ${red[0] + red[1]}, the events list ${redE}.`);
  const yel = item.stats && item.stats.yellow_cards, yE = events.filter(e => e.type === 'yellow' || e.type === 'second yellow').length;
  if (yel && yel[0] + yel[1] !== yE) warn(`Yellow cards: the statistics say ${yel[0] + yel[1]}, the events list ${yE}.`);
  // a player sent off or substituted off must not appear as a scorer or carder later
  const gone = new Map();
  for (const e of events) { const n = e.type === 'sub' ? e.off : (e.type === 'red' || e.type === 'second yellow') ? e.player : null; if (n && !gone.has(personNorm(n))) gone.set(personNorm(n), e.minute); }
  const after = events.filter(e => ['goal', 'penalty', 'own goal', 'yellow'].includes(e.type) && gone.has(personNorm(e.player)) && e.minute > gone.get(personNorm(e.player)));
  if (after.length) warn(`Events after the player left the pitch: ${list(after.map(e => `${e.player} (${e.minute}')`))}.`);
  return out;
}
