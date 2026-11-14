// lib/highlightly.js — older matches (before our own collection started) from Highlightly's free plan (100 requests a day, own quota).
// Gives per match: goals with assist and minute, cards, substitutions and both line-ups with formation. NO ratings.
// Raw answers are saved (striker_results, tool 'hl_list' and 'hl_match') so nothing is asked twice and the conversion can be redone.
// A match is changed only when the goals add up to our stored score; details from API-Football or StrikerAPI are never touched.
import { sameTeam } from './sync-due.js';
import { GOAL_PATCHES } from './data/goal-patches.js';

const BASE = 'https://soccer.highlightly.net';
const DAY = 864e5;
export const HL_LEAGUES = {
  EPL: { names: ['Premier League'], country: 'England' },
  LALIGA: { names: ['La Liga', 'LaLiga', 'Primera Division'], country: 'Spain' },
  SERIEA: { names: ['Serie A'], country: 'Italy' },
  LIGUE1: { names: ['Ligue 1'], country: 'France' }
};

async function hlGet(path, key, ms = 9000) {
  const r = await fetch(BASE + path, { headers: { 'x-rapidapi-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  let json = null; try { json = await r.json(); } catch (e) { /* not JSON */ }
  const hd = n => (r.headers && r.headers.get ? r.headers.get(n) : null);
  const rem = hd('x-ratelimit-requests-remaining') ?? hd('x-ratelimit-remaining'); const lim = hd('x-ratelimit-requests-limit') ?? hd('x-ratelimit-limit');
  return { status: r.status, json, remaining: rem != null && Number.isFinite(Number(rem)) ? Number(rem) : null, limit: lim != null && Number.isFinite(Number(lim)) ? Number(lim) : null };
}
const scoreOf = m => { const s = m && m.state && m.state.score && m.state.score.current; const t = String(s || '').match(/(\d+)\s*-\s*(\d+)/); return t ? [Number(t[1]), Number(t[2])] : [null, null]; };
const slim = m => { const [hg, ag] = scoreOf(m); return { id: m.id, date: String(m.date || '').slice(0, 10), home: { id: m.homeTeam && m.homeTeam.id, name: m.homeTeam && m.homeTeam.name }, away: { id: m.awayTeam && m.awayTeam.id, name: m.awayTeam && m.awayTeam.name }, hg, ag, state: m.state && m.state.description }; };

/** Step 1: every match of the league season (few requests: 100 per page). Saves the list. */
export async function hlList(store, { key, league, season = 2026, probeDate = '2026-10-10' }) {
  const cfg = HL_LEAGUES[league]; if (!cfg) return { ok: false, error: 'league not set up: ' + league };
  if (!key) return { ok: false, error: 'HIGHLIGHTLY_API_KEY is not set on the server' };
  let requests = 0, leagueId = null, used = '';
  for (const name of cfg.names) {
    const r = await hlGet(`/matches?date=${probeDate}&leagueName=${encodeURIComponent(name)}&countryName=${encodeURIComponent(cfg.country)}&limit=5`, key); requests++;
    const hit = r.json && Array.isArray(r.json.data) && r.json.data.find(x => x.league && x.league.id && x.country && x.country.name === cfg.country);
    if (hit) { leagueId = hit.league.id; used = name; break; }
  }
  if (!leagueId) return { ok: false, requests, error: `Highlightly returned no ${cfg.names.join(' / ')} (${cfg.country}) match on ${probeDate}` };
  const matches = []; let offset = 0, total = null;
  for (let page = 0; page < 8; page++) {
    const r = await hlGet(`/matches?leagueId=${leagueId}&season=${season}&limit=100&offset=${offset}`, key); requests++;
    const data = (r.json && r.json.data) || []; total = r.json && r.json.pagination ? r.json.pagination.totalCount : total;
    matches.push(...data.map(slim)); offset += data.length;
    if (!data.length || (total != null && offset >= total)) break;
  }
  await store.saveStriker({ tool: 'hl_list', args: { league, season }, ok: true, data: { league, leagueId, name: used, matches } });
  return { ok: true, requests, league, leagueId, matches: matches.length, finished: matches.filter(m => /finish/i.test(m.state || '')).length };
}

/** Highlightly events + line-ups of ONE match -> our detail object. home/away team ids tell the sides. */
export function convertHl(raw, nowISO = new Date().toISOString()) {
  const { events = [], lineups = {}, home, away } = raw || {};
  const sideOfTeam = id => (String(id) === String(home && home.id) ? 'home' : String(id) === String(away && away.id) ? 'away' : null);
  const pos = p => ({ Goalkeeper: 'G', Defender: 'D', Midfielder: 'M', Forward: 'F' }[p] || '');
  const people = { home: { xi: [], subs: [] }, away: { xi: [], subs: [] } };
  for (const [side, key] of [['home', 'homeTeam'], ['away', 'awayTeam']]) {
    const L = lineups[key] || {};
    (L.initialLineup || []).flat().forEach(p => people[side].xi.push({ id: p.id != null ? p.id : null, n: p.number != null ? p.number : null, name: p.name || '', pos: pos(p.position), min: 90, g: 0, a: 0, yc: 0, rc: 0, rating: null, grid: null }));
    (L.substitutes || []).forEach(p => people[side].subs.push({ id: p.id != null ? p.id : null, n: p.number != null ? p.number : null, name: p.name || '', pos: pos(p.position), min: 0, g: 0, a: 0, yc: 0, rc: 0, rating: null, grid: null }));
  }
  const find = (side, id, name) => [...people[side].xi, ...people[side].subs].find(p => (id != null && p.id === id) || (p.name && name && p.name === name));
  const out = [];
  // Highlightly lists a goal that VAR cancelled as "VAR ... Cancelled" PLUS a nameless "Goal" for the same team: that goal never stood, so it is not counted
  const cancelled = new Map(); for (const e of events) if (/cancel/i.test(String(e.type || '')) && e.team) cancelled.set(e.team.id, (cancelled.get(e.team.id) || 0) + 1);
  for (const e of events) {
    const side = sideOfTeam(e.team && e.team.id); if (!side) continue;
    if (String(e.type || '').toLowerCase() === 'goal' && !e.player && cancelled.get(e.team.id) > 0) { cancelled.set(e.team.id, cancelled.get(e.team.id) - 1); continue; }
    const type = String(e.type || '').toLowerCase(); const m = String(e.time || '').match(/^(\d+)(?:\+(\d+))?$/); const minute = m ? Number(m[1]) : null, extra = m && m[2] ? Number(m[2]) : null;
    if (type === 'goal' || type === 'penalty' || type === 'own goal') {
      out.push({ m: minute, x: extra, side, type: 'goal', detail: type === 'own goal' ? 'Own Goal' : type === 'penalty' ? 'Penalty' : 'Normal Goal', player: e.player || '', other: e.assist || '' });
      const sc = find(side, e.playerId, e.player), as = find(side, e.assistingPlayerId, e.assist);
      if (sc && type !== 'own goal') sc.g++; if (as && type !== 'own goal') as.a++;
    } else if (/card/.test(type)) {
      out.push({ m: minute, x: extra, side, type: 'card', detail: /red/.test(type) ? 'Red Card' : 'Yellow Card', player: e.player || '', other: '' });
      const p = find(side, e.playerId, e.player); if (p) { if (/red/.test(type)) p.rc++; else p.yc++; }
    } else if (/subst/.test(type)) {
      // which name is the one coming on is not documented: the one who is among the starters is the one going off
      const a = find(side, e.playerId, e.player), b = find(side, e.assistingPlayerId, e.substituted) || find(side, null, e.substituted);
      const aStarter = a && people[side].xi.includes(a);
      const off = aStarter ? a : b, on = aStarter ? b : a;
      if (off && on && people[side].xi.includes(off)) { off.min = minute || 90; on.min = Math.max(0, 90 - (minute || 90)); }
      out.push({ m: minute, x: extra, side, type: 'subst', detail: 'Substitution', player: off ? off.name : e.player || '', other: on ? on.name : e.substituted || '' });
    }
  }
  const lu = {};
  for (const [side, key] of [['home', 'homeTeam'], ['away', 'awayTeam']]) { const L = lineups[key] || {}; if (people[side].xi.length || people[side].subs.length) lu[side] = { formation: L.formation && L.formation !== 'Unknown' ? L.formation : null, coach: null, xi: people[side].xi, subs: people[side].subs }; }
  if (!out.length && !Object.keys(lu).length) return null;
  return { v: 1, source: 'highlightly', fetchedAt: nowISO, venue: null, attendance: null, referee: null, events: out, lineups: lu, stats: [], best: null };
}

const goalsOf = d => (d.events || []).filter(e => e.type === 'goal').length;

/** Saves the converted detail on our match when the goals add up. Merges into the recovered team stats; never overwrites other sources. */
export async function applyHl(store, ourMatch, detail) {
  if (!detail || goalsOf(detail) !== (ourMatch.hg + ourMatch.ag)) return 'goals-differ';
  const old = await store.getDetail(ourMatch.id).catch(() => null); const od = old && old.data && !old.data.unavailable ? old.data : null;
  if (od && !['openmatchday', 'openliga', 'highlightly'].includes(od.source)) return 'kept';
  const merged = od && od.stats && od.stats.length ? { ...detail, stats: od.stats, halftime: od.halftime || null, source: od.source === 'highlightly' ? 'highlightly' : od.source, eventsSource: 'highlightly' } : detail;
  await store.saveManualDetail(ourMatch.id, merged); return 'saved';
}

/** No requests: matches whose raw Highlightly answer is already saved but were skipped (goals differ) are converted again with the current rules. */
export async function hlReapply(store) {
  const rows = (await store.strikerRows('hl_match').catch(() => [])).filter(r => r && r.ourId && Array.isArray(r.events));
  let saved = 0; const seen = new Set();
  for (const r of rows.reverse()) {
    if (seen.has(r.ourId)) continue; seen.add(r.ourId);
    const old = await store.getDetail(r.ourId).catch(() => null); const od = old && old.data && !old.data.unavailable ? old.data : null;
    if (od && (od.source === 'highlightly' || od.eventsSource === 'highlightly' || !['openmatchday', 'openliga'].includes(od.source))) continue;
    const lg = String(r.ourId).split('|')[0]; const m = (await store.listMatches({ league: lg, season: 2026 }).catch(() => [])).find(x => x.id === r.ourId); if (!m || m.hg == null) continue;
    let det = convertHl({ home: r.home, away: r.away, events: r.events, lineups: r.lineups || {} });
    const patch = GOAL_PATCHES[r.ourId];
    if (patch && goalsOf(det) + patch.goals.length === m.hg + m.ag) {       // the source left a goal out: add it from the named report
      const evs = det.events.slice(); for (const g of patch.goals) { evs.push({ m: g.m, x: g.x, side: g.side, type: 'goal', detail: 'Normal Goal', player: g.player, other: '', approx: !!g.approx }); const sn = g.player.split(' ').pop().toLowerCase(); const lp = [...((det.lineups[g.side] || {}).xi || []), ...((det.lineups[g.side] || {}).subs || [])].find(p => String(p.name).toLowerCase().includes(sn)); if (lp) lp.g++; }
      evs.sort((a, b) => (a.m == null ? 999 : a.m) - (b.m == null ? 999 : b.m) || (a.x || 0) - (b.x || 0)); det = { ...det, events: evs, patched: patch.report };
    }
    if (await applyHl(store, m, det) === 'saved') saved++;
  }
  return saved;
}

/** Step 2: fetch events + line-ups of not-yet-saved matches (2 requests each), newest first, and apply them. */
export async function hlFetch(store, { key, max = 15, dailyCap = 48, budgetMs = 40000, now = Date.now(), league: only = '', reapply = false } = {}) {
  if (!key) return { ok: false, error: 'HIGHLIGHTLY_API_KEY is not set on the server' };
  const reapplied = reapply ? await hlReapply(store).catch(() => 0) : 0;
  const today = new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z';
  let usedToday = await store.strikerCountSince('hl_match', today).catch(() => 0);
  const done = new Set((await store.strikerDoneIds('hl_match')).map(String));
  const lists = await store.strikerRows('hl_list');
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const out = { reapplied, fetched: 0, saved: 0, kept: 0, goalsDiffer: 0, notPlaced: 0, remaining: 0, requests: 0, usedToday, dailyCap };
  const latest = new Map(); lists.forEach(l => { if (l && l.league) latest.set(l.league, l); });
  const todo = [];
  for (const [league, l] of latest) {
    if (only && league !== only) continue;
    const ours = (await store.listMatches({ league, season: 2026 }).catch(() => [])).filter(m => m.status === 'finished' && m.hg != null);
    const have = new Map((await store.listDetailsLike(league + '|2026|').catch(() => [])).map(d => [d.match_id, d.data && d.data.source]));
    for (const h of l.matches) {
      if (!/finish/i.test(h.state || '') || done.has(String(h.id)) || h.hg == null) continue;
      const t = Date.parse(h.date + 'T12:00:00Z');
      const m = ours.find(f => f.hg === h.hg && f.ag === h.ag && Math.abs(Date.parse(f.date + 'T12:00:00Z') - t) <= DAY && sameTeam(h.home.name, f.home, aliasMap) && sameTeam(h.away.name, f.away, aliasMap));
      if (!m) { out.notPlaced++; continue; }
      const src = have.get(m.id); if (src && !['openmatchday', 'openliga'].includes(src)) continue;      // already has better data
      todo.push({ h, m, league });
    }
  }
  todo.sort((a, b) => (a.h.date < b.h.date ? 1 : -1));
  out.remaining = todo.length;
  const t0 = Date.now();
  for (const { h, m, league } of todo.slice(0, Math.min(max, 25))) {
    if (usedToday >= dailyCap || Date.now() - t0 > budgetMs) { out.stopped = usedToday >= dailyCap ? 'daily limit reached' : 'time'; break; }
    let ev, lu; try { ev = await hlGet(`/events/${h.id}`, key); lu = await hlGet(`/lineups/${h.id}`, key); } catch (e) { out.stopped = 'network'; break; }
    out.requests += 2; out.fetched++; usedToday++;
    const ok = ev.status === 200 && lu.status === 200;
    const permanent = !ok && [400, 404, 422].includes(ev.status === 200 ? lu.status : ev.status);        // such a match is not asked again; other errors are retried later
    await store.saveStriker({ tool: 'hl_match', args: { league }, game_id: String(h.id), ok: ok || permanent, credits_left: lu.remaining ?? ev.remaining ?? null, credits_used: lu.limit ?? ev.limit ?? null, http_status: ev.status === 200 ? lu.status : ev.status, data: permanent ? { failed: true } : ok ? { league, ourId: m.id, home: h.home, away: h.away, events: Array.isArray(ev.json) ? ev.json : (ev.json && ev.json.data) || [], lineups: lu.json || {} } : null });
    if (!ok) { out.failed = (out.failed || 0) + 1; if (ev.status === 429 || lu.status === 429) { out.stopped = 'Highlightly says too many requests'; break; } continue; }
    const detail = convertHl({ home: h.home, away: h.away, events: Array.isArray(ev.json) ? ev.json : (ev.json && ev.json.data) || [], lineups: lu.json || {} });
    const r = await applyHl(store, m, detail);
    if (r === 'saved') out.saved++; else if (r === 'kept') out.kept++; else out.goalsDiffer++;
  }
  out.usedToday = usedToday; out.remaining = Math.max(0, out.remaining - out.fetched);
  out.summary = `Highlightly: ${reapplied ? reapplied + ' re-checked from saved data (no requests), ' : ''}${out.fetched} match(es) fetched (${out.requests} requests), ${out.saved} saved, ${out.goalsDiffer} skipped (goals differ from our score), ${out.kept} kept, ${out.remaining} still to fetch, ${usedToday}/${dailyCap} used today` + (out.stopped ? `. Stopped: ${out.stopped}` : '');
  return { ok: true, ...out };
}
