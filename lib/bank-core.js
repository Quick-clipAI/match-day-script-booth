// lib/bank-core.js
// Creator Booth "data bank": pure logic, no network and no database in this file.
// Everything here is covered by tests that run against real Premier League 2025/26 and 2026/27 files.
//
// Vocabulary
//   league   one of the keys in LEAGUES below (EPL, LALIGA, ...)
//   season   the YEAR THE SEASON STARTS (2025 means 2025/26). Same convention as API-Football.
//   match    { id, league, comp_name, season, round, date, time, kickoff, home, away, hg, ag, ht_h, ht_a,
//              status, note, source, verified, conflict }
//   status   'scheduled' | 'finished' | 'postponed' | 'cancelled'

export const LEAGUES = {
  EPL: {
    key: 'EPL', name: 'Premier League', short: 'Premier League', type: 'league', teams: 20,
    tiebreak: 'gd', tiebreakSure: true, of: 'en.1',
    api: { name: 'Premier League', country: 'England' },
    words: ['premier league', 'epl', 'english premier league', 'english league', 'english top flight', 'prem']
  },
  LALIGA: {
    key: 'LALIGA', name: 'La Liga', short: 'La Liga', type: 'league', teams: 20,
    tiebreak: 'h2h', tiebreakSure: true, of: 'es.1',
    api: { name: 'La Liga', country: 'Spain' },
    words: ['la liga', 'laliga', 'spanish league', 'primera division', 'spanish top flight']
  },
  SERIEA: {
    key: 'SERIEA', name: 'Serie A', short: 'Serie A', type: 'league', teams: 20,
    tiebreak: 'gd', tiebreakSure: false, of: 'it.1',
    api: { name: 'Serie A', country: 'Italy' },
    words: ['serie a', 'italian league', 'calcio', 'italian top flight']
  },
  BUNDESLIGA: {
    key: 'BUNDESLIGA', name: 'Bundesliga', short: 'Bundesliga', type: 'league', teams: 18,
    tiebreak: 'gd', tiebreakSure: true, of: 'de.1',
    api: { name: 'Bundesliga', country: 'Germany' },
    words: ['bundesliga', 'german league', 'german top flight']
  },
  LIGUE1: {
    key: 'LIGUE1', name: 'Ligue 1', short: 'Ligue 1', type: 'league', teams: 18,
    tiebreak: 'gd', tiebreakSure: true, of: 'fr.1',
    api: { name: 'Ligue 1', country: 'France' },
    words: ['ligue 1', 'ligue1', 'french league', 'french top flight']
  },
  SPL: {
    key: 'SPL', name: 'Saudi Pro League', short: 'Saudi Pro League', type: 'league', teams: 18,
    tiebreak: 'gd', tiebreakSure: false, of: null,
    api: { name: 'Pro League', country: 'Saudi-Arabia' },
    words: ['saudi pro league', 'saudi league', 'roshn saudi league', 'spl', 'saudi']
  },
  UCL: {
    key: 'UCL', name: 'UEFA Champions League', short: 'Champions League', type: 'cup', teams: null,
    of: null, api: { name: 'UEFA Champions League', country: 'World' },
    words: ['champions league', 'ucl', 'uefa champions league']
  },
  UEL: {
    key: 'UEL', name: 'UEFA Europa League', short: 'Europa League', type: 'cup', teams: null,
    of: null, api: { name: 'UEFA Europa League', country: 'World' },
    words: ['europa league', 'uel', 'uefa europa league']
  },
  UECL: {
    key: 'UECL', name: 'UEFA Conference League', short: 'Conference League', type: 'cup', teams: null,
    of: null, api: { name: 'UEFA Europa Conference League', country: 'World' },
    words: ['conference league', 'uecl', 'europa conference league', 'uefa conference league']
  },
  CLUBFRIENDLY: { key: 'CLUBFRIENDLY', name: 'Club Friendlies', short: 'Club Friendlies', type: 'cup', teams: null, of: null, api: null, words: ['club friendly', 'club friendlies', 'pre-season friendly'] },
  NATIONFRIENDLY: { key: 'NATIONFRIENDLY', name: 'International Friendlies', short: 'International Friendlies', type: 'cup', teams: null, of: null, api: null, words: ['international friendly', 'international friendlies', 'national team friendly'] },
  WORLD_CUP: { key: 'WORLD_CUP', name: 'FIFA World Cup', short: 'World Cup', type: 'cup', teams: null, of: null, api: null, words: ['fifa world cup', 'world cup'] },
  EURO: { key: 'EURO', name: 'UEFA European Championship', short: 'Euros', type: 'cup', teams: null, of: null, api: null, words: ['euros', 'european championship', 'uefa euro'] },
  AFCON: { key: 'AFCON', name: 'Africa Cup of Nations', short: 'AFCON', type: 'cup', teams: null, of: null, api: null, words: ['afcon', 'africa cup of nations'] },
  COPA_AMERICA: { key: 'COPA_AMERICA', name: 'Copa América', short: 'Copa América', type: 'cup', teams: null, of: null, api: null, words: ['copa america', 'copa américa'] },
  WC_QUALIFIERS: { key: 'WC_QUALIFIERS', name: 'World Cup Qualifiers', short: 'World Cup Qualifiers', type: 'cup', teams: null, of: null, api: null, words: ['world cup qualifiers', 'fifa world cup qualifiers'] },
  EURO_QUALIFIERS: { key: 'EURO_QUALIFIERS', name: 'Euro Qualifiers', short: 'Euro Qualifiers', type: 'cup', teams: null, of: null, api: null, words: ['euro qualifiers', 'european qualifiers'] },
  AFCON_QUALIFIERS: { key: 'AFCON_QUALIFIERS', name: 'AFCON Qualifiers', short: 'AFCON Qualifiers', type: 'cup', teams: null, of: null, api: null, words: ['afcon qualifiers', 'africa cup qualifiers'] },
  INTERMIAMI: {
    key: 'INTERMIAMI', name: 'Inter Miami (all competitions)', short: 'Inter Miami', type: 'club', teams: null,
    of: null, api: null, clubNorm: 'inter miami', calendarSeason: true,
    words: ['inter miami']
  }
};
export const LEAGUE_KEYS = Object.keys(LEAGUES);
export const DOMESTIC_KEYS = LEAGUE_KEYS.filter(k => LEAGUES[k].type === 'league');

// ---------------------------------------------------------------- names

const NOISE = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'us', 'rc', 'rcd', 'cd', 'ud', 'sd', 'sv', 'vfl', 'vfb', 'fsv', 'tsg', 'fk', 'ca']);

/** Lower-case, no accents, no punctuation, no club-type noise words (FC, AFC, CF...) or bare numbers (04, 1899). */
export function norm(s) {
  const base = String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const toks = base.split(' ').filter(Boolean);
  const kept = toks.filter(t => !NOISE.has(t) && !/^\d{1,4}$/.test(t));
  return (kept.length ? kept : toks).join(' ');
}
const tokens = n => (n ? n.split(' ') : []);

/** Name shown to people: the source's own spelling minus a leading/trailing FC / AFC / CF. */
// Names where the FC is part of the club's identity (without it the name is another club, or just a city).
const KEEP_FC = new Set(['paris fc']);
export function cleanDisplay(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (KEEP_FC.has(s.toLowerCase().replace(/^fc\s+/, '').replace(/\s+fc$/, '') + ' fc')) return s.replace(/^FC\s+/i, '').replace(/\s+FC$/i, '') + ' FC';
  s = s.replace(/^(?:FC|AFC|CF)\s+(?=\S)/i, '').replace(/\s+(?:FC|AFC|CF)$/i, '').trim();
  return s || String(raw || '').trim();
}

/** Short names people type (alias -> a phrase the real club name contains or equals). */
export const SEED_ALIASES = {
  'man city': 'manchester city', 'man utd': 'manchester united', 'man united': 'manchester united', 'man u': 'manchester united',
  'spurs': 'tottenham hotspur', 'wolves': 'wolverhampton wanderers', 'nottm forest': 'nottingham forest', 'nott m forest': 'nottingham forest',
  'brighton': 'brighton and hove albion', 'newcastle': 'newcastle united', 'west ham': 'west ham united', 'leeds': 'leeds united',
  'barca': 'barcelona', 'atleti': 'atletico madrid', 'atletico': 'atletico madrid', 'athletic bilbao': 'athletic club', 'bilbao': 'athletic club',
  'betis': 'real betis', 'inter': 'internazionale', 'inter milan': 'internazionale', 'juve': 'juventus', 'ac milan': 'milan',
  'psg': 'paris saint germain', 'paris sg': 'paris saint germain', 'bayern': 'bayern munchen', 'bayern munich': 'bayern munchen',
  'dortmund': 'borussia dortmund', 'gladbach': 'monchengladbach', 'cologne': 'koln', 'lyon': 'olympique lyonnais', 'marseille': 'olympique marseille',
  'real': null,
  // same club, different spelling between sources (UEFA competitions)
  'olympique lyonnais': 'lyon', 'olympique marseille': 'marseille', 'internazionale': 'inter',
  'dinamo zagreb': 'gnk dinamo', 'gnk dinamo': 'dinamo zagreb',
  'union sg': ['union st gilloise', 'union saint gilloise'], 'union st gilloise': 'union sg', 'union saint gilloise': 'union sg',
  'sparta prague': 'sparta praha', 'sparta praha': 'sparta prague', 'slavia prague': 'slavia praha', 'slavia praha': 'slavia prague',
  'lillestrom': 'lillestr m', 'lillestr m': 'lillestrom', 'bodo glimt': 'bod glimt', 'bod glimt': 'bodo glimt',
  'nec nijmegen': 'n e c nijmegen', 'n e c nijmegen': 'nec nijmegen', 'n e c': 'n e c nijmegen', 'nec': 'n e c nijmegen',
  'olympiakos': 'olympiacos', 'olympiacos': 'olympiakos',
  'hapoel be er sheva': 'hapoel beer sheva', 'hapoel beer sheva': 'hapoel be er sheva'
};

/** Pairs of different clubs/countries whose names look alike. They are never merged by the loose matcher
 *  (one name inside the other). A real spelling variant is taught through Clubs > Merge instead. */
const NEVER_MERGE = [
  ['paris', 'paris saint germain'],            // Paris FC v Paris Saint-Germain (Ligue 1)
  ['guinea', 'equatorial guinea'], ['guinea', 'papua new guinea'], ['guinea', 'guinea bissau'],
  ['ireland', 'northern ireland'], ['congo', 'dr congo'], ['congo', 'congo dr'],
  ['korea', 'north korea'], ['sudan', 'south sudan'], ['niger', 'nigeria'], ['inter', 'inter miami']
];
const neverMerge = (a, b) => NEVER_MERGE.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/** Find which already-known club a spelling refers to. Returns the known display name or null.
 *  batch (optional): normalised names that appear in the same incoming file. Two different names in one
 *  file are two different clubs, so the loose matcher never merges them. */
export function matchKnownClub(raw, known /* Map normKey -> display */, aliases /* Map normAlias -> display */, batch /* Set of normKeys */) {
  const n = norm(raw);
  if (!n) return null;
  if (aliases && aliases.has(n)) return aliases.get(n);
  if (known.has(n)) return known.get(n);
  const apart = k => k !== n && (neverMerge(n, k) || (batch && batch.has(n) && batch.has(k)));
  // explicit seeds are deliberate, so a name that shares the file with its seed target may still be merged
  for (const seed of [].concat(SEED_ALIASES[n] || []).filter(Boolean)) {
    const hit = [...known.entries()].filter(([k]) => k !== n && !neverMerge(n, k) && (tokensSubset(tokens(seed), tokens(k)) || tokensSubset(tokens(k), tokens(seed))));
    if (hit.length === 1) return hit[0][1];
  }
  const nt = tokens(n);
  const cands = [...known.entries()].filter(([k]) => !apart(k) && (tokensSubset(nt, tokens(k)) || tokensSubset(tokens(k), nt)));
  if (cands.length === 1) return cands[0][1];
  return null;
}
function tokensSubset(small, big) {
  if (!small.length || small.length > big.length) return false;
  const set = new Set(big);
  return small.every(t => set.has(t));
}

// ---------------------------------------------------------------- dates, seasons

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
export function currentSeason(cfg, todayISO) {
  const y = Number(todayISO.slice(0, 4)), m = Number(todayISO.slice(5, 7));
  if (cfg && cfg.calendarSeason) return y;
  return m >= 7 ? y : y - 1;
}
export function seasonLabel(cfg, season) {
  return cfg && cfg.calendarSeason ? String(season) : `${season}/${String(season + 1).slice(-2)}`;
}
export function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`;
}
/** Does this date fit inside the season? (July of the start year to July of the next; the whole year for calendar seasons) */
export function dateFitsSeason(cfg, season, date) {
  if (cfg && cfg.calendarSeason) return date.slice(0, 4) === String(season);
  return date >= `${season}-07-01` && date <= `${season + 1}-07-31`;
}

// ---------------------------------------------------------------- rows

export function matchId(cfg, season, date, home, away) {
  const h = norm(home), a = norm(away);
  return cfg.type === 'league' ? `${cfg.key}|${season}|${h}|${a}` : `${cfg.key}|${season}|${date}|${h}|${a}`;
}
const okGoals = n => Number.isInteger(n) && n >= 0 && n <= 40;

/** Build a clean row from loose fields. Returns { row } or { error }. Team names are NOT resolved here. */
export function makeRow(cfg, f) {
  const season = Number(f.season);
  if (!Number.isInteger(season) || season < 1990 || season > 2100) return { error: 'season missing or not a year' };
  if (!isIsoDate(f.date)) return { error: 'date must look like 2026-10-10' };
  const home = String(f.home || '').trim(), away = String(f.away || '').trim();
  if (!home || !away) return { error: 'home or away team missing' };
  if (norm(home) === norm(away)) return { error: 'home and away are the same club' };
  let status = f.status || 'scheduled';
  let hg = f.hg == null ? null : Number(f.hg), ag = f.ag == null ? null : Number(f.ag);
  if (status === 'finished') {
    if (!okGoals(hg) || !okGoals(ag)) return { error: 'a finished match needs two whole-number scores' };
  } else {
    hg = null; ag = null;
  }
  if (!['scheduled', 'finished', 'postponed', 'cancelled'].includes(status)) return { error: 'unknown status ' + status };
  const row = {
    league: cfg.key, comp_name: f.comp_name || cfg.name, season, round: f.round ? String(f.round).slice(0, 60) : null,
    date: f.date, time: f.time ? String(f.time).slice(0, 8) : null, kickoff: f.kickoff || null,
    home, away, hg, ag,
    ht_h: okGoals(f.ht_h) ? f.ht_h : null, ht_a: okGoals(f.ht_a) ? f.ht_a : null,
    status, note: f.note ? String(f.note).slice(0, 120) : null,
    source: f.source || 'paste', verified: !!f.verified
  };
  return { row };
}

// ---------------------------------------------------------------- parsers

/** Which league does an openfootball file name belong to ("English Premier League 2025/26")? */
export function leagueFromTitle(title) {
  const t = String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b2\.? ?bundesliga\b|\bbundesliga 2\b|\b3\.? ?liga\b/.test(t)) return null;
  if (/premier league/.test(t)) return 'EPL';
  if (/primera division|la liga|laliga/.test(t)) return 'LALIGA';
  if (/serie a/.test(t)) return 'SERIEA';
  if (/bundesliga/.test(t)) return 'BUNDESLIGA';
  if (/ligue 1/.test(t)) return 'LIGUE1';
  return null;
}
export function seasonFromTitle(title) {
  const m = String(title || '').match(/(\d{4})\s*[\/\-–]\s*(\d{2,4})/);
  if (m) return Number(m[1]);
  const y = String(title || '').match(/\b(20\d{2})\b/);
  return y ? Number(y[1]) : null;
}

/** openfootball "football.json": { name, matches:[{round,date,time,team1,team2,score}] }.
 *  A normal result is score:{ft:[a,b],ht:[a,b]}. A goalless draw is stored as a bare score:[0,0]. */
export function parseOpenfootball(obj, ctx) {
  const cfg = LEAGUES[ctx.league];
  const rows = [], problems = [];
  (obj.matches || []).forEach((m, i) => {
    let ft = null, ht = null, note = null;
    const s = m.score;
    if (Array.isArray(s) && s.length === 2) ft = s;
    else if (s && typeof s === 'object') {
      if (Array.isArray(s.et) && s.et.length === 2) { ft = s.et; note = 'after extra time'; }
      else if (Array.isArray(s.ft) && s.ft.length === 2) ft = s.ft;
      if (Array.isArray(s.ht) && s.ht.length === 2) ht = s.ht;
      if (Array.isArray(s.p) && s.p.length === 2) note = `${note ? note + ', ' : ''}penalties ${s.p[0]}-${s.p[1]}`;
    }
    const r = makeRow(cfg, {
      season: ctx.season, date: m.date, time: m.time, round: m.round, home: m.team1, away: m.team2,
      hg: ft ? ft[0] : null, ag: ft ? ft[1] : null, ht_h: ht ? ht[0] : null, ht_a: ht ? ht[1] : null,
      status: ft ? 'finished' : 'scheduled', note, source: ctx.source || 'openfootball'
    });
    if (r.error) problems.push(`match ${i + 1} (${m.team1} v ${m.team2}): ${r.error}`); else rows.push(r.row);
  });
  return { rows, problems };
}

export function leagueForApiFixture(fx) {
  const lg = fx && fx.league, teams = fx && fx.teams;
  if (!lg) return null;
  // Inter Miami in ANY competition
  const im = LEAGUES.INTERMIAMI.clubNorm;
  if (teams && ((teams.home && norm(teams.home.name) === im) || (teams.away && norm(teams.away.name) === im))) return 'INTERMIAMI';
  for (const k of LEAGUE_KEYS) {
    const a = LEAGUES[k].api;
    if (a && String(lg.name).toLowerCase() === a.name.toLowerCase() && String(lg.country).toLowerCase() === a.country.toLowerCase()) return k;
  }
  return null;
}
export function mapApiStatus(short) {
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['PST'].includes(short)) return 'postponed';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  return 'scheduled';   // not started, live, break: a final score is only trusted once the match is over
}
/** API-Football "fixtures" answer: { response:[{fixture,league,teams,goals,score}] } */
export function parseApiFootball(obj, ctx) {
  const rows = [], problems = [], skipped = {};
  (obj.response || []).forEach((fx, i) => {
    const key = leagueForApiFixture(fx);
    if (!key) { const n = fx && fx.league ? `${fx.league.name} (${fx.league.country})` : 'unknown'; skipped[n] = (skipped[n] || 0) + 1; return; }
    const cfg = LEAGUES[key];
    const iso = fx.fixture && fx.fixture.date ? String(fx.fixture.date) : '';
    const status = mapApiStatus(fx.fixture && fx.fixture.status && fx.fixture.status.short);
    const pen = fx.score && fx.score.penalty && fx.score.penalty.home != null ? fx.score.penalty : null;
    const et = fx.fixture && fx.fixture.status && fx.fixture.status.short === 'AET';
    const note = pen ? `penalties ${pen.home}-${pen.away}` : (et ? 'after extra time' : null);
    const r = makeRow(cfg, {
      season: fx.league.season, date: iso.slice(0, 10), kickoff: iso || null, round: fx.league.round,
      home: fx.teams.home.name, away: fx.teams.away.name, hg: fx.goals && fx.goals.home, ag: fx.goals && fx.goals.away,
      ht_h: fx.score && fx.score.halftime ? fx.score.halftime.home : null, ht_a: fx.score && fx.score.halftime ? fx.score.halftime.away : null,
      status, note, comp_name: key === 'INTERMIAMI' ? fx.league.name : cfg.name, source: ctx.source || 'api-football'
    });
    if (r.error) problems.push(`fixture ${i + 1} (${fx.teams && fx.teams.home && fx.teams.home.name} v ${fx.teams && fx.teams.away && fx.teams.away.name}): ${r.error}`); else rows.push(r.row);
  });
  return { rows, problems, skipped };
}

/** Our own simple format (what the admin page's "Copy format" gives you):
 *  { "league":"EPL", "season":2026, "matches":[ {"date":"2026-10-10","home":"Arsenal","away":"Leeds United","hg":2,"ag":1,"round":"Matchday 6"} ] }
 *  or a bare array of such matches, each with its own league/season. Scores may be hg/ag, score:"2-1" or ft:[2,1]. */
export function parseUniversal(input, ctx) {
  const rows = [], problems = [];
  const list = Array.isArray(input) ? input : (input.matches || []);
  const base = Array.isArray(input) ? {} : input;
  list.forEach((m, i) => {
    const key = String(m.league || base.league || ctx.league || '').toUpperCase();
    const cfg = LEAGUES[key];
    if (!cfg) { problems.push(`match ${i + 1}: league "${m.league || base.league || ''}" is not one of ${LEAGUE_KEYS.join(', ')}`); return; }
    let hg = m.hg, ag = m.ag;
    if (hg == null && typeof m.score === 'string') { const x = m.score.match(/^\s*(\d+)\s*[-:–]\s*(\d+)\s*$/); if (x) { hg = Number(x[1]); ag = Number(x[2]); } }
    if (hg == null && Array.isArray(m.ft)) { hg = m.ft[0]; ag = m.ft[1]; }
    if (hg == null && Array.isArray(m.score) && m.score.length === 2) { hg = m.score[0]; ag = m.score[1]; }
    const hasScore = hg != null && ag != null && hg !== '' && ag !== '';
    const status = m.status ? String(m.status).toLowerCase() : (hasScore ? 'finished' : 'scheduled');
    const r = makeRow(cfg, {
      season: m.season || base.season || ctx.season, date: m.date, time: m.time, round: m.round,
      home: m.home || m.team1, away: m.away || m.team2, hg: hasScore ? Number(hg) : null, ag: hasScore ? Number(ag) : null,
      ht_h: m.ht_h, ht_a: m.ht_a, status, note: m.note, comp_name: m.comp_name || m.competition, source: ctx.source || 'paste'
    });
    if (r.error) problems.push(`match ${i + 1} (${m.home || m.team1} v ${m.away || m.team2}): ${r.error}`); else rows.push(r.row);
  });
  return { rows, problems };
}

/** Look at pasted JSON and say what it is. */
export function detectFormat(obj) {
  if (obj && Array.isArray(obj.response) && (!obj.response.length || (obj.response[0] && obj.response[0].fixture))) return 'api-football';
  if (obj && Array.isArray(obj.matches) && obj.matches.length && ('team1' in obj.matches[0] || 'team2' in obj.matches[0])) return 'openfootball';
  if (obj && Array.isArray(obj.matches) && !obj.matches.length && obj.name) return 'openfootball';
  if (Array.isArray(obj) || (obj && Array.isArray(obj.matches))) return 'universal';
  return null;
}

// ---------------------------------------------------------------- standings

/** Table from saved results. Level teams are ordered by cfg.tiebreak: 'gd' = points, goal difference, goals scored;
 *  'h2h' = points, then results between the level teams, then goal difference, then goals scored. */
export function computeTable(matches, cfg) {
  const t = new Map();
  const get = n => { if (!t.has(n)) t.set(n, { team: n, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 }); return t.get(n); };
  matches.forEach(m => { get(m.home); get(m.away); });
  const fin = matches.filter(m => m.status === 'finished' && Number.isInteger(m.hg) && Number.isInteger(m.ag));
  for (const m of fin) {
    const a = get(m.home), b = get(m.away);
    a.P++; b.P++; a.GF += m.hg; a.GA += m.ag; b.GF += m.ag; b.GA += m.hg;
    if (m.hg > m.ag) { a.W++; b.L++; a.Pts += 3; }
    else if (m.hg < m.ag) { b.W++; a.L++; b.Pts += 3; }
    else { a.D++; b.D++; a.Pts++; b.Pts++; }
  }
  const rows = [...t.values()].map(r => ({ ...r, GD: r.GF - r.GA }));
  rows.sort((x, y) => y.Pts - x.Pts || x.team.localeCompare(y.team));
  const h2h = (cfg && cfg.tiebreak === 'h2h');
  const out = [];
  let i = 0, undecided = false;
  while (i < rows.length) {
    let j = i; while (j < rows.length && rows[j].Pts === rows[i].Pts) j++;
    let grp = rows.slice(i, j);
    if (grp.length > 1) {
      const names = new Set(grp.map(r => r.team));
      const mini = {};
      grp.forEach(r => { mini[r.team] = { pts: 0, gd: 0, gf: 0 }; });
      if (h2h) {
        for (const m of fin) {
          if (!names.has(m.home) || !names.has(m.away)) continue;
          const A = mini[m.home], B = mini[m.away];
          A.gf += m.hg; B.gf += m.ag; A.gd += m.hg - m.ag; B.gd += m.ag - m.hg;
          if (m.hg > m.ag) A.pts += 3; else if (m.hg < m.ag) B.pts += 3; else { A.pts++; B.pts++; }
        }
      }
      grp.sort((x, y) => (h2h ? (mini[y.team].pts - mini[x.team].pts || mini[y.team].gd - mini[x.team].gd || mini[y.team].gf - mini[x.team].gf) : 0)
        || y.GD - x.GD || y.GF - x.GF || x.team.localeCompare(y.team));
      for (let k = 0; k < grp.length - 1; k++) {
        const x = grp[k], y = grp[k + 1];
        const same = x.GD === y.GD && x.GF === y.GF && (!h2h || (mini[x.team].pts === mini[y.team].pts && mini[x.team].gd === mini[y.team].gd && mini[x.team].gf === mini[y.team].gf));
        if (same) undecided = true;
      }
    }
    grp.forEach(r => out.push(r));
    i = j;
  }
  out.forEach((r, k) => { r.rank = k + 1; });
  const playedMatches = fin.length;
  const expected = cfg && cfg.teams ? cfg.teams * (cfg.teams - 1) : null;
  return {
    rows: out, playedMatches, totalMatches: matches.length, expected,
    complete: !!expected && matches.length === expected && playedMatches === expected,
    teamCount: out.length, tieUndecided: undecided,
    lastResult: fin.reduce((mx, m) => (m.date > mx ? m.date : mx), '')
  };
}

export function findGaps(matches, todayISO) {
  return matches.filter(m => m.status === 'scheduled' && m.date < todayISO)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Compare saved rows with incoming rows. Never overwrites a different final score: that becomes a conflict. */
export function diffRows(existingById, incoming) {
  const out = { fresh: [], filled: [], rescheduled: [], same: [], conflicts: [] };
  for (const row of incoming) {
    const ex = existingById.get(row.id);
    if (!ex) { out.fresh.push(row); continue; }
    if (ex.status === 'finished') {
      if (row.status === 'finished') {
        if (ex.hg === row.hg && ex.ag === row.ag) out.same.push(row);
        else out.conflicts.push({ existing: ex, incoming: row });
      } else out.same.push(row);
      continue;
    }
    if (row.status === 'finished') { out.filled.push({ existing: ex, incoming: row }); continue; }
    if (row.status !== ex.status || row.date !== ex.date || (row.time && row.time !== ex.time)) {
      if (ex.verified) out.same.push(row); else out.rescheduled.push({ existing: ex, incoming: row });
    } else out.same.push(row);
  }
  return out;
}

/** What to say about a data set that is not up to date. Used by the planner AND the admin page. */
export function coverageOf(matches, cfg, todayISO) {
  const fin = matches.filter(m => m.status === 'finished').length;
  const gaps = findGaps(matches, todayISO);
  const last = matches.reduce((mx, m) => (m.status === 'finished' && m.date > mx ? m.date : mx), '');
  const expected = cfg && cfg.teams ? cfg.teams * (cfg.teams - 1) : null;
  return { total: matches.length, finished: fin, gaps: gaps.length, gapList: gaps, lastResult: last, expected, complete: !!expected && matches.length === expected && fin === expected };
}
