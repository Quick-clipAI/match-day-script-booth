// lib/player-card.js — a player's card for the current season across every competition (league, European cups, domestic cups we store).
import { LEAGUES, currentSeason } from './bank-core.js';
import { aggregatePlayers, playerCard } from './player-season.js';
import { pickPlayer } from './player-match.js';
import { ageOn } from './bank-squad.js';

let CACHE = { at: 0, day: '', players: null, matches: null };
const TTL = 5 * 60 * 1000;

/** Aggregate of every stored match detail of the season. Cached for a few minutes per server instance. */
export async function loadSeasonPlayers(store, today, now = Date.now()) { return (await loadSeason(store, today, now)).players; }
/** { players, matches }: the players aggregate plus every stored match of the season (each with league, season, _short). */
export async function loadSeason(store, today, now = Date.now()) {
  if (CACHE.players && CACHE.day === today && now - CACHE.at < TTL) return { players: CACHE.players, matches: CACHE.matches };
  const matches = [], details = [];
  for (const lg of Object.keys(LEAGUES)) {
    const season = currentSeason(LEAGUES[lg], today);
    const ms = await store.listMatches({ league: lg, season }).catch(() => []);
    if (!ms.length) continue;
    matches.push(...ms.map(m => ({ ...m, league: lg, season, _short: LEAGUES[lg].short })));
    details.push(...await store.listDetailsLike(`${lg}|${season}|`).catch(() => []));
  }
  const players = aggregatePlayers(matches, details);
  CACHE = { at: now, day: today, players, matches };
  return { players, matches };
}
export function clearPlayerCache() { CACHE = { at: 0, day: '', players: null, matches: null }; }


/** Age, birth date, nationality and shirt number from the squad we already store (bank_players). Matched inside the player's club by name; only a single clear match is used. */
export function enrichFromRoster(card, roster, today) {
  if (!card || !roster || !roster.length) return card;
  const hit = pickPlayer(card.name, roster);
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
