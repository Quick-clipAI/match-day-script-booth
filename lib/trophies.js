// lib/trophies.js — a club's European trophies from bank_club_trophies (winners of each final; friendlies are not stored).
// Club names differ between sources ("AC Milan"/"Milan", "Inter Milan"/"Internazionale Milano"), so names are compared through TROPHY_ALIAS.
import { crestKey } from './crests.js';

// order = how the Trophies tab lists them: the club's league first, then Europe
export const COMPETITIONS = [['ENG', 'Premier League'], ['ESP', 'LaLiga'], ['ITA', 'Serie A'], ['GER', 'Bundesliga'], ['FRA', 'Ligue 1'], ['SPL', 'Saudi Pro League'], ['MLSC', 'MLS Cup'], ['SS', "Supporters' Shield"],
  ['UCL', 'Champions League'], ['UEL', 'Europa League'], ['UECL', 'Conference League'], ['USC', 'UEFA Super Cup']];
const TROPHY_ALIAS = { 'ac milan': 'milan', 'internazionale milano': 'inter milan', 'inter': 'inter milan', 'internazionale': 'inter milan', 'olympiakos': 'olympiacos', 'parma calcio 1913': 'parma',
  'bayer leverkusen': 'leverkusen', 'ss lazio': 'lazio', 'ssc napoli': 'napoli', 'as roma': 'roma', 'bayern munchen': 'bayern munich', 'atletico': 'atletico madrid', 'tottenham': 'tottenham hotspur',
  'dynamo kiev': 'dynamo kyiv', 'steaua bucharest': 'steaua bucuresti', 'olympique de marseille': 'marseille', 'sporting': 'sporting cp', 'zenit': 'zenit saint petersburg',
  'leeds': 'leeds united', 'newcastle': 'newcastle united', 'ipswich': 'ipswich town', 'athletic': 'athletic bilbao', 'olympique lyonnais': 'lyon', 'olympique lillois': 'lille', 'lafc': 'los angeles', 'd c united': 'dc united',
  'al hilal saudi': 'al hilal', 'al fat h': 'al fateh', 'al ittifaq': 'al ettifaq', 'al nasr': 'al nassr', 'stade rennais': 'rennes', 'hamburg': 'hamburger', 'wolves': 'wolverhampton wanderers' };
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
