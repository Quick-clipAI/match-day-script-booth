// lib/probes.js — small read-only test calls to find out what two free sources really return. Nothing is saved.
const get = async (url, headers = {}, ms = 9000) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ac.signal }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } return { status: r.status, json, text: json ? '' : text.slice(0, 200) }; }
  finally { clearTimeout(t); }
};
const cut = (v, n = 6) => (Array.isArray(v) ? v.slice(0, n) : v);

/** Highlightly: matches of one date (1 request), then events and lineups of the first finished match (2 requests). Key from env, never returned. */
export async function highlightlyProbe({ key, date, league = 'Premier League', country = '' }) {
  if (!key) return { ok: false, error: 'HIGHLIGHTLY_API_KEY is not set on the server (redeploy after adding it)' };
  const H = { 'x-rapidapi-key': key }, base = 'https://soccer.highlightly.net';
  const out = { ok: true, requests: 0 };
  const m = await get(`${base}/matches?date=${encodeURIComponent(date)}&leagueName=${encodeURIComponent(league)}${country ? '&countryName=' + encodeURIComponent(country) : ''}&limit=20`, H); out.requests++;
  out.matches = { status: m.status, plan: m.json && m.json.plan, total: m.json && m.json.pagination && m.json.pagination.totalCount, error: m.json ? (m.json.message || m.json.error || null) : m.text };
  const list = (m.json && m.json.data) || [];
  out.matches.sample = list.slice(0, 5).map(x => ({ id: x.id, home: x.homeTeam && x.homeTeam.name, away: x.awayTeam && x.awayTeam.name, state: x.state && x.state.description, score: x.state && x.state.score && x.state.score.current, season: x.league && x.league.season, league: x.league && x.league.name, country: x.country && x.country.name }));
  const first = list.find(x => x.state && /finish|ended|full/i.test(String(x.state.description))) || list[0];
  if (!first) { out.note = 'No match came back for that date, so lineups and events were not tested.'; return out; }
  const ev = await get(`${base}/events/${first.id}`, H); out.requests++;
  out.events = { status: ev.status, count: Array.isArray(ev.json) ? ev.json.length : (ev.json && ev.json.data ? ev.json.data.length : null), sample: cut(Array.isArray(ev.json) ? ev.json : (ev.json && ev.json.data) || ev.json, 8), error: ev.json ? null : ev.text };
  const lu = await get(`${base}/lineups/${first.id}`, H); out.requests++;
  const L = lu.json || {};
  const side = s => L[s] ? { formation: L[s].formation, starters: (L[s].initialLineup || []).flat().length, subs: (L[s].substitutes || []).length, sample: cut((L[s].initialLineup || []).flat(), 3) } : null;
  out.lineups = { status: lu.status, home: side('homeTeam'), away: side('awayTeam'), keys: Object.keys(L).slice(0, 8), error: lu.json ? null : lu.text };
  out.testedMatch = { id: first.id, name: `${first.homeTeam && first.homeTeam.name} v ${first.awayTeam && first.awayTeam.name}` };
  return out;
}

/** OpenLigaDB (free, no key): one Bundesliga matchday. Do the matches carry goals with scorer names and minutes? */
export async function openLigaProbe({ season = 2026, group = 1, league = 'bl1' }) {
  const r = await get(`https://api.openligadb.de/getmatchdata/${encodeURIComponent(league)}/${Number(season)}/${Number(group)}`);
  const list = Array.isArray(r.json) ? r.json : [];
  const out = { ok: r.status === 200, status: r.status, matches: list.length, error: list.length ? null : (r.text || 'no matches') };
  const withGoals = list.filter(x => Array.isArray(x.goals) && x.goals.length);
  out.withGoalList = withGoals.length;
  out.sample = list.slice(0, 3).map(x => ({ home: x.team1 && x.team1.teamName, away: x.team2 && x.team2.teamName, finished: x.matchIsFinished, result: (x.matchResults || []).map(y => `${y.resultName}: ${y.pointsTeam1}-${y.pointsTeam2}`), goals: (x.goals || []).slice(0, 6).map(g => ({ scorer: g.goalGetterName, minute: g.matchMinute, score: `${g.scoreTeam1}-${g.scoreTeam2}`, penalty: g.isPenalty, ownGoal: g.isOwnGoal })), location: x.location && x.location.locationCity, viewers: x.numberOfViewers }));
  return out;
}

/** football-data.org (free key from env, never returned): season top scorers of one league. Does the free plan include goals AND assists, and how many matches do they cover? */
export async function footballDataProbe({ key, code = 'PD' }) {
  if (!key) return { ok: false, error: 'FOOTBALL_DATA_API_KEY is not set on the server' };
  const H = { 'X-Auth-Token': key }, base = 'https://api.football-data.org/v4', c = encodeURIComponent(code);
  const out = { ok: true, requests: 3, code };
  const comp = await get(`${base}/competitions/${c}`, H);
  out.competition = { status: comp.status, name: comp.json && comp.json.name, season: comp.json && comp.json.currentSeason && { start: comp.json.currentSeason.startDate, end: comp.json.currentSeason.endDate, matchday: comp.json.currentSeason.currentMatchday }, error: comp.status === 200 ? null : (comp.json ? (comp.json.message || comp.json.error) : comp.text) };
  const sc = await get(`${base}/competitions/${c}/scorers?limit=10`, H);
  const list = (sc.json && sc.json.scorers) || [];
  out.scorers = { status: sc.status, count: list.length, season: sc.json && sc.json.season && sc.json.season.startDate, error: sc.status === 200 ? null : (sc.json ? (sc.json.message || sc.json.error) : sc.text),
    hasAssists: list.some(x => x.assists != null), sample: list.slice(0, 8).map(x => ({ player: x.player && x.player.name, team: x.team && x.team.name, played: x.playedMatches, goals: x.goals, assists: x.assists, penalties: x.penalties })) };
  // does the free plan include the squads (birth date, nationality, position, shirt number) inside the teams list?
  const tm = await get(`${base}/competitions/${c}/teams`, H);
  const teams = (tm.json && tm.json.teams) || [];
  const squads = teams.map(x => x.squad || []);
  const all = squads.flat();
  out.squads = { status: tm.status, error: tm.status === 200 ? null : (tm.json ? (tm.json.message || tm.json.error || '').toString().slice(0, 200) : 'no answer'),
    teams: teams.length, teamsWithSquad: squads.filter(a => a.length).length, players: all.length,
    have: { dateOfBirth: all.filter(p => p.dateOfBirth).length, nationality: all.filter(p => p.nationality).length, position: all.filter(p => p.position).length, shirtNumber: all.filter(p => p.shirtNumber != null).length },
    sample: teams.slice(0, 2).map(x => ({ team: x.name, squadSize: (x.squad || []).length, first: (x.squad || []).slice(0, 3).map(p => ({ name: p.name, born: p.dateOfBirth, nationality: p.nationality, position: p.position, shirt: p.shirtNumber })) })) };
  return out;
}
