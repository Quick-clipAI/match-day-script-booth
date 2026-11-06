// lib/player-card.js — a player's card for the current season across every competition (league, European cups, domestic cups we store).
import { LEAGUES, currentSeason } from './bank-core.js';
import { aggregatePlayers, playerCard } from './player-season.js';

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

export async function playerCardFor(store, key, today) {
  const players = await loadSeasonPlayers(store, today);
  const o = players.get(String(key || ''));
  const card = playerCard(o);
  if (!card) return null;
  const comps = card.competitions.length;
  return { ...card, season: 'This season (2026-27 and calendar-year leagues)', note: 'From the matches we have stored details for, not necessarily every match.', comps };
}
