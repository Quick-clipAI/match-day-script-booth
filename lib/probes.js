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
