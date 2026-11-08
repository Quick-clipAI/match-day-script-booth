// lib/player-card.js — a player's card for the current season across every competition (league, European cups, domestic cups we store).
import { LEAGUES, currentSeason } from './bank-core.js';
import { aggregatePlayers, playerCard } from './player-season.js';
import { sameApiName } from './bank-profiles.js';
import { ageOn } from './bank-squad.js';
import { norm } from './bank-core.js';

let CACHE = { at: 0, day: '', players: null };
const TTL = 5 * 60 * 1000;

/** Aggregate of every stored match detail of the season. Cached for a few minutes per server instance. */
export async function loadSeasonPlayers(store, today, now = Date.now()) {
  if (CACHE.players && CACHE.day === today && now - CACHE.at < TTL) return CACHE.players;
  const matches = [], details = [];
  for (const lg of Object.keys(LEAGUES)) {
    const season = currentSeason(LEAGUES[lg], today);
    const ms = await store.listMatches({ league: lg, season }).catch(() => []);
    if (!ms.length) continue;
    matches.push(...ms.map(m => ({ ...m, league: lg, season, _short: LEAGUES[lg].short })));
    details.push(...await store.listDetailsLike(`${lg}|${season}|`).catch(() => []));
  }
  const players = aggregatePlayers(matches, details);
  CACHE = { at: now, day: today, players };
  return players;
}
export function clearPlayerCache() { CACHE = { at: 0, day: '', players: null }; }


/** Age, birth date, nationality and shirt number from the squad we already store (bank_players). Matched inside the player's club by name; only a single clear match is used. */
export function enrichFromRoster(card, roster, today) {
  if (!card || !roster || !roster.length) return card;
  const exact = roster.filter(p => norm(p.name) === norm(card.name));
  const ct = norm(card.name).split(' ').filter(Boolean), tail = ct.slice(1).filter(x => x.length > 1);
  const byTokens = p => { const pt = norm(p.name).split(' ').filter(Boolean); return ct.length > 1 && tail.length && pt[0] && pt[0][0] === ct[0][0] && tail.every(x => pt.includes(x)); };   // "R. Dias" -> "Raphael Dias Belloli"
  let loose = exact.length ? exact : roster.filter(p => sameApiName(card.name, p.name));
  if (!loose.length) loose = roster.filter(byTokens);
  const hit = loose.length === 1 ? loose[0] : null;
  if (!hit) return card;
  const dob = hit.dob ? String(hit.dob).slice(0, 10) : null;
  const age = dob ? ageOn(dob, today) : (Number.isInteger(hit.age) && hit.age_as_of ? hit.age + Math.max(0, Math.floor((Date.parse(today) - Date.parse(String(hit.age_as_of).slice(0, 10))) / 31557600000)) : (Number.isInteger(hit.age) ? hit.age : null));
  return { ...card, fullName: hit.name !== card.name ? hit.name : null, nationality: hit.nationality || null, dob, age, num: card.num || hit.shirt || null, pos: card.pos || (hit.position ? String(hit.position)[0].toUpperCase() : '') };
}

export async function playerCardFor(store, key, today) {
  const players = await loadSeasonPlayers(store, today);
  const o = players.get(String(key || ''));
  const card = playerCard(o);
  if (!card) return null;
  const comps = card.competitions.length;
  const roster = await store.listPlayers({ club: card.club }).catch(() => []);
  return { ...enrichFromRoster(card, roster, today), season: 'This season (2026-27 and calendar-year leagues)', note: 'From the matches we have stored details for, not necessarily every match.', comps };
}
