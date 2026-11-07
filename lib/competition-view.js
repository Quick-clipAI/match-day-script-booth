// lib/competition-view.js  Everything the competition screen needs (a league or a European cup): table, fixtures and results,
// stats (top scorers and assists where full match details were saved, club figures from the results) and the knockout bracket.
// Built from the matches already in the bank. No API credits.
import { LEAGUES, norm, currentSeason, seasonLabel } from './bank-core.js';
import { aggregatePlayers, leaderboard, playerKey } from './player-season.js';
import { placeScorers, fdLatest } from './fd-scorers.js';
import { buildTable, buildBracket, stageOf } from './match-view.js';

/** API-Football league ids, used only to show the competition's own logo (the page falls back to a text badge). */
export const LOGO_IDS = { EPL: 39, LALIGA: 140, SERIEA: 135, BUNDESLIGA: 78, LIGUE1: 61, SPL: 307, MLS: 253, UCL: 2, UEL: 3, UECL: 848 };
const KNOCKOUT = new Set(['UCL', 'UEL', 'UECL']);

/** Competitions that get a card and a screen: the domestic leagues and the three European cups. */
export const hasCompetitionScreen = key => !!LOGO_IDS[key] && !!LEAGUES[key];

/** Which tab fits the question. 'table' | 'fixtures' | 'stats' | 'knockout' */
export function intentTab(ql) {
  const t = ' ' + String(ql || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  if (/\b(knock ?outs?|round of 16|last 16|quarter ?finals?|semi ?finals?|play ?offs?|bracket|the final)\b/.test(t)) return 'knockout';
  if (/\b(top scorers?|golden boot|top assists?|assists?|most goals|stats|statistics|clean sheets?)\b/.test(t)) return 'stats';
  if (/\b(table|standings?|situation|group stage|league phase|position|points|leaders?|who is top|who s top|relegat\w*|title race|ranked|qualif\w*)\b/.test(t)) return 'table';
  if (/\b(matches|match|fixtures?|games?|results?|scores?|today|tonight|tomorrow|schedule|kick ?off|biggest|big games?|play(ing)?)\b/.test(t)) return 'fixtures';
  return 'table';
}
/** True when a short follow-up ("which match is the biggest", "who is top?") can be about the competition just shown. */
export const isCompetitionFollowUp = ql => /\b(match(es)?|games?|fixtures?|results?|table|standings?|situation|biggest|scorers?|assists?|knock ?outs?|group stage|league phase|qualif\w*|tonight|today|tomorrow|who is top|who s top|leaders?)\b/.test(' ' + String(ql || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ') + ' ');

export function competitionCard(key, season, tab) {
  const cfg = LEAGUES[key];
  return { type: 'competition', league: key, season, name: cfg.short, label: seasonLabel(cfg, season), tab: tab || 'table' };
}

const compact = m => ({ id: m.id, date: m.date, time: m.time || '', kickoff: m.kickoff || null, round: String(m.round || '').replace(/^League Stage - (\d+)$/i, 'Matchday $1'), home: m.home, away: m.away,
  hg: m.status === 'finished' ? m.hg : null, ag: m.status === 'finished' ? m.ag : null, status: m.status, note: m.note || null });

function roundsOf(list) {
  const first = new Map();
  list.forEach(m => { const r = m.round || 'Matches'; if (!first.has(r) || first.get(r) > m.date) first.set(r, m.date); });
  return [...first].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].localeCompare(b[0], undefined, { numeric: true }))).map(x => x[0]);
}

export const MIN_RATED = 2;        // matches with a stored rating before a player enters the rating list
export function buildStats(all, details, fd = null, aliasMap = new Map()) {
  const finished = all.filter(m => m.status === 'finished' && m.hg != null && m.ag != null);
  const byId = new Map(all.map(m => [m.id, m]));
  let withDetail = 0;
  for (const d of details) { const D = d.data; if (byId.has(d.match_id) && D && !D.unavailable && ((Array.isArray(D.events) && D.events.length) || (D.lineups && (D.lineups.home || D.lineups.away)))) withDetail++; }
  const agg = aggregatePlayers(all, details);
  const pick = (metric, extra) => leaderboard(agg, metric, { top: 20, minRated: MIN_RATED }).map(r => ({ key: r.key, name: r.name, club: r.club, ...extra(r) }));
  const clubs = new Map();
  const row = t => { if (!clubs.has(t)) clubs.set(t, { team: t, P: 0, GF: 0, GA: 0, CS: 0, W: 0, D: 0, L: 0 }); return clubs.get(t); };
  finished.forEach(m => {
    const h = row(m.home), a = row(m.away);
    h.P++; a.P++; h.GF += m.hg; h.GA += m.ag; a.GF += m.ag; a.GA += m.hg;
    if (m.ag === 0) h.CS++; if (m.hg === 0) a.CS++;
    if (m.hg > m.ag) { h.W++; a.L++; } else if (m.hg < m.ag) { a.W++; h.L++; } else { h.D++; a.D++; }
  });
  // season scorers from football-data.org cover every match; ours cover only matches with saved details
  let scorers = pick('goals', r => ({ goals: r.goals })), scorersSource = 'ours';
  if (fd && Array.isArray(fd.scorers) && fd.scorers.length) {
    const clubs = [...new Set(all.flatMap(m => [m.home, m.away]))];
    scorers = placeScorers(fd.scorers, clubs, aliasMap).filter(x => x.club).slice(0, 20).map(x => {
      const key = playerKey(x.name, x.club);
      return { key: agg.has(key) ? key : '', name: x.name, club: x.club, goals: x.goals, played: x.played == null ? null : x.played, penalties: x.penalties };
    });
    scorersSource = 'football-data.org';
  }
  return {
    players: { scorers, scorersSource, scorersAt: fd && fd.fetchedAt || null, assists: pick('assists', r => ({ assists: r.assists })), ratings: pick('rating', r => ({ rating: r.rating, rated: r.rated, apps: r.apps })), minRated: MIN_RATED, matchesWithDetails: withDetail, finishedMatches: finished.length },
    clubs: [...clubs.values()]
  };
}

export async function buildCompetition(store, key, season, today) {
  const cfg = LEAGUES[key];
  if (!hasCompetitionScreen(key)) return null;
  let s = Number.isInteger(season) ? season : currentSeason(cfg, today);
  let all = await store.listMatches({ league: key, season: s });
  if (!all.length && !Number.isInteger(season)) { s -= 1; all = await store.listMatches({ league: key, season: s }); }
  const details = store.listDetailsLike ? await store.listDetailsLike(`${key}|${s}|`).catch(() => []) : [];
  const fd = await fdLatest(store, key, s).catch(() => null);
  const aliasMap = new Map((store.listAliases ? await store.listAliases().catch(() => []) : []).map(a => [a.alias, a.canonical]));
  const pseudo = { league: key, season: s, round: '' };
  const table = buildTable(all, pseudo);
  const bracket = KNOCKOUT.has(key) ? buildBracket(all, pseudo) : null;
  const fx = all.filter(m => !KNOCKOUT.has(key) || true).map(compact).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kickoff || a.time || '') < (b.kickoff || b.time || '') ? -1 : 1));
  const rounds = roundsOf(fx);
  const todayRound = (fx.find(m => m.date === today) || {}).round;
  const next = fx.find(m => m.status === 'scheduled' && m.date >= today);
  const lastDone = [...fx].reverse().find(m => m.status === 'finished');
  const focusRound = todayRound || (next && next.round) || (lastDone && lastDone.round) || rounds[0] || null;
  const tabs = [['table', KNOCKOUT.has(key) ? 'League phase' : 'Table'], ['fixtures', 'Fixtures'], ['stats', 'Stats']];
  if (bracket && bracket.stages.length) tabs.push(['knockout', 'Knockout']);
  // club crests: API-Football team ids by club name (the picture itself is loaded by the app from API-Sports' free image host)
  const crests = {};
  try {
    const clubs = new Set(); all.forEach(m => { clubs.add(m.home); clubs.add(m.away); });
    const rows = store.listTeamIds ? await store.listTeamIds().catch(() => []) : [];
    rows.forEach(r => { if (r && r.club && r.api_team_id && clubs.has(r.club)) crests[r.club] = r.api_team_id; });
  } catch (e) { /* crests are decoration only */ }
  return {
    competition: { key, name: cfg.name, short: cfg.short, type: cfg.type, season: s, label: seasonLabel(cfg, s), logo: LOGO_IDS[key] || null, cup: KNOCKOUT.has(key) },
    today, tabs: tabs.map(([k, l]) => ({ key: k, label: l })), table, fixtures: fx, rounds, focusRound, bracket,
    stats: buildStats(all, details, fd, aliasMap), found: all.length, crests
  };
}
