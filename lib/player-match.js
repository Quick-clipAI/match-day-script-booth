// lib/player-match.js  Finds ONE player inside a club's list by name. Never guesses: two candidates at a tier means no match.
import { sameApiName } from './bank-profiles.js';
import { norm } from './bank-core.js';

const toks = s => norm(s).split(' ').filter(Boolean);

export function pickPlayer(name, roster) {
  const n = norm(name), ct = toks(name), tail = ct.slice(1).filter(x => x.length > 1);
  const exact = roster.filter(p => norm(p.name) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const tiers = [
    p => sameApiName(name, p.name),
    p => { const pt = toks(p.name); return ct.length > 1 && tail.length > 0 && pt[0] && pt[0][0] === ct[0][0] && tail.every(x => pt.includes(x)); },   // "R. Dias" -> "Raphael Dias Belloli"
    p => { const pt = toks(p.name); return pt.length === 1 && ct.length > 1 && (pt[0] === ct[0] || pt[0] === ct[ct.length - 1]); },                       // "Fermín" -> "Fermín López"
    p => { const pt = toks(p.name); return pt.length > 1 && ct.length > pt.length && pt.every(x => ct.includes(x)); }                                       // "Pau Cubarsí" -> "Pau Cubarsí Paredes"
  ];
  for (const f of tiers) { const h = roster.filter(f); if (h.length === 1) return h[0]; if (h.length > 1) return null; }
  return null;
}
