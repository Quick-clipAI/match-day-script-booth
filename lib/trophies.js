// lib/trophies.js — a club's European trophies from bank_club_trophies (winners of each final; friendlies are not stored).
// Club names differ between sources ("AC Milan"/"Milan", "Inter Milan"/"Internazionale Milano"), so names are compared through TROPHY_ALIAS.
import { crestKey } from './crests.js';

export const COMPETITIONS = [['UCL', 'Champions League'], ['UEL', 'Europa League'], ['UECL', 'Conference League'], ['USC', 'UEFA Super Cup']];
const TROPHY_ALIAS = { 'ac milan': 'milan', 'internazionale milano': 'inter milan', 'inter': 'inter milan', 'internazionale': 'inter milan', 'olympiakos': 'olympiacos', 'parma calcio 1913': 'parma',
  'bayer leverkusen': 'leverkusen', 'ss lazio': 'lazio', 'ssc napoli': 'napoli', 'as roma': 'roma', 'bayern munchen': 'bayern munich', 'atletico': 'atletico madrid', 'tottenham': 'tottenham hotspur',
  'dynamo kiev': 'dynamo kyiv', 'steaua bucharest': 'steaua bucuresti', 'olympique de marseille': 'marseille', 'sporting': 'sporting cp', 'zenit': 'zenit saint petersburg' };
export const trophyKey = n => { const k = crestKey(n); return TROPHY_ALIAS[k] || k; };

/** rows: bank_club_trophies; club: the name as our data bank writes it. -> [{ key, name, count, seasons: newest first }] */
export function trophiesFor(rows, club) {
  const me = trophyKey(club); if (!me) return [];
  const out = [];
  for (const [key, name] of COMPETITIONS) {
    const won = (rows || []).filter(r => r.competition === key && trophyKey(r.club) === me).map(r => r.season).sort().reverse();
    if (won.length) out.push({ key, name, count: won.length, seasons: won });
  }
  return out;
}
