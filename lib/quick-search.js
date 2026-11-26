// lib/quick-search.js — the search box inside the app. Answers from the data bank only: no AI, no API-Football request, no web search.
// A name finds clubs, players and coaches; a football question ("Arsenal next match", "Premier League table", "Haaland") also gets
// the short answer lines and the match / competition cards the chat would have shown. Anything we cannot answer is left to the chat.
import { LEAGUES, norm } from './bank-core.js';
import { buildClubIndex, planContext } from './bank-context.js';
import { playerKey } from './player-season.js';

const tokens = q => norm(q).split(' ').filter(Boolean);
/** every typed word must be the start of a word in the name ("hal" finds "Erling Haaland") */
const hits = (name, qt) => { const nt = norm(name).split(' ').filter(Boolean); return qt.length > 0 && qt.every(t => nt.some(w => w.startsWith(t))); };
const rank = (name, qt) => { const n = norm(name), nt = n.split(' '); if (n === qt.join(' ')) return 0; if (nt[nt.length - 1].startsWith(qt[qt.length - 1]) && qt.length === 1) return 1; return 2; };
const newest = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r), o = m.get(k); if (!o || Number(r.season) > Number(o.season)) m.set(k, r); } return [...m.values()]; };

export async function quickSearch(question, todayISO, store, opts = {}) {
  const q = String(question || '').trim().slice(0, 200);
  const out = { q, clubs: [], players: [], coaches: [], answer: [], cards: [] };
  const qt = tokens(q);
  if (norm(q).length < 2) return out;
  const cache = opts.cache || {};
  const fresh = (k, ms) => cache[k] && Date.now() - cache[k + 'At'] < ms;

  // clubs
  if (!(cache.index && Date.now() - cache.at < 60000)) { const [rows, al] = await Promise.all([store.clubIndex(), store.listAliases()]); cache.index = buildClubIndex(rows, al); cache.at = Date.now(); }
  const index = cache.index, seen = new Set();
  for (const [phrase, targets] of index.phrases) {
    if (!hits(phrase, qt)) continue;
    for (const d of targets) if (!seen.has(d)) { seen.add(d); const e = index.byDisplay.get(d); if (e) out.clubs.push({ club: d, leagues: [...e.leagues.keys()].filter(l => LEAGUES[l]).map(l => LEAGUES[l].short).slice(0, 3), _r: rank(d, qt) }); }
  }
  out.clubs.sort((a, b) => a._r - b._r || a.club.length - b.club.length); out.clubs = out.clubs.slice(0, 6).map(({ _r, ...c }) => c);

  // players and coaches (two letters is too little to be useful)
  if (norm(q).length >= 3) {
    if (!fresh('roster', 600000)) { cache.roster = await store.listPlayers({}).catch(() => []); cache.rosterAt = Date.now(); }
    const pl = newest(cache.roster.filter(p => p && p.name && p.club_status !== 'retired' && hits(p.name, qt)), p => norm(p.name) + '|' + norm(p.club))
      .map(p => ({ name: p.name, club: p.club, league: LEAGUES[p.league] ? LEAGUES[p.league].short : p.league, position: p.position || null, key: playerKey(p.name, p.club), _r: rank(p.name, qt), season: Number(p.season) }));
    pl.sort((a, b) => a._r - b._r || b.season - a.season || a.name.localeCompare(b.name));
    out.players = pl.slice(0, 8).map(({ _r, season, ...p }) => p);
    if (!fresh('coaches', 600000)) { cache.coachRows = await store.listCoaches().catch(() => []); cache.coachesAt = Date.now(); }
    const co = newest(cache.coachRows.filter(c => c && c.name && hits(c.name, qt)), c => norm(c.name));
    out.coaches = co.sort((a, b) => b.season - a.season).slice(0, 4).map(c => ({ name: c.name, club: c.club, league: LEAGUES[c.league] ? LEAGUES[c.league].short : c.league }));
  }

  // the answer: the same deterministic planner the chat uses, shown as short lines instead of an AI prompt
  const plan = await planContext(q, todayISO, store, { cache, focus: opts.focus }).catch(() => null);
  if (plan) {
    out.answer = plan.quick || [];
    out.cards = (plan.competition ? [plan.competition] : []).concat(plan.cards || []);
  }
  return out;
}
