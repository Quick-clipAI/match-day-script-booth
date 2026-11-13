// lib/team-view.js — everything the team screen shows for one club, built only from the data bank:
// overview (next match, form, best XI by rating), matches across competitions, a table per competition, stats and squad.
// Ratings and player numbers only cover matches whose details we hold; the screen says so.
import { LEAGUES, currentSeason, norm } from './bank-core.js';
import { loadSeason } from './player-card.js';
import { playerKey } from './player-season.js';
import { buildTable, publicMatch, formByTeam } from './match-view.js';
import { crestIds, crestKey } from './crests.js';
import { sameApiName } from './bank-profiles.js';
import { pickPlayer } from './player-match.js';
import { ageOn } from './bank-squad.js';
import { coachView } from './coach-history.js';

let ROSTER = { at: 0, rows: null };
async function roster(store) {
  if (ROSTER.rows && Date.now() - ROSTER.at < 10 * 60 * 1000) return ROSTER.rows;
  const rows = await store.listPlayers({}).catch(() => []);
  ROSTER = { at: Date.now(), rows }; return rows;
}
const GROUPS = [['G', 'Goalkeepers'], ['D', 'Defenders'], ['M', 'Midfielders'], ['F', 'Forwards'], ['', 'Other']];
const posLetter = p => { const c = String(p || '').charAt(0).toUpperCase(); return c === 'A' ? 'F' : (c && 'GDMF'.includes(c) ? c : ''); };   // a missing position gives ''
const r2 = x => Math.round(x * 100) / 100;

export async function buildTeam(store, club, today) {
  const name = String(club || '').trim(); if (!name) return null;
  const { players, matches, details = [] } = await loadSeason(store, today);
  const key = crestKey(name);
  const same = n => norm(n) === norm(name) || (key && crestKey(n) === key);
  const mine = matches.filter(m => same(m.home) || same(m.away)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')));
  const all = await roster(store);
  const squadRows = (() => { const rs = all.filter(p => same(p.club) && p.club_status !== 'retired'); const top = rs.reduce((m, p) => Math.max(m, Number(p.season) || 0), 0); return rs.filter(p => (Number(p.season) || 0) === top); })();
  if (!mine.length && !squadRows.length) return null;
  const nameSeen = (mine[0] && (same(mine[0].home) ? mine[0].home : mine[0].away)) || (squadRows[0] && squadRows[0].club) || name;
  const mineName = m => (same(m.home) ? m.home : m.away);

  // matches, by competition (the domestic league first)
  const byLg = new Map(); for (const m of mine) { if (!byLg.has(m.league)) byLg.set(m.league, []); byLg.get(m.league).push(m); }
  const lgOrder = [...byLg.keys()].sort((a, b) => (LEAGUES[b].type === 'league') - (LEAGUES[a].type === 'league') || byLg.get(b).length - byLg.get(a).length);
  const fin = m => m.status === 'finished' && Number.isInteger(m.hg) && Number.isInteger(m.ag);
  const result = m => { const home = same(m.home); const gf = home ? m.hg : m.ag, ga = home ? m.ag : m.hg; return { gf, ga, r: gf > ga ? 'W' : gf < ga ? 'L' : 'D' }; };
  const competitions = lgOrder.map(lg => {
    const ms = byLg.get(lg), done = ms.filter(fin), rs = done.map(result);
    const gf = rs.reduce((s, x) => s + x.gf, 0), ga = rs.reduce((s, x) => s + x.ga, 0);
    return { key: lg, name: LEAGUES[lg].short, season: ms[0].season, played: done.length, W: rs.filter(x => x.r === 'W').length, D: rs.filter(x => x.r === 'D').length, L: rs.filter(x => x.r === 'L').length, GF: gf, GA: ga, cleanSheets: rs.filter(x => x.ga === 0).length, perGame: done.length ? { scored: r2(gf / done.length), conceded: r2(ga / done.length) } : null };
  });
  const tables = [];
  for (const lg of lgOrder) {
    const pool = matches.filter(m => m.league === lg); if (!pool.length) continue;
    let t = null; try { t = buildTable(pool, { league: lg, season: pool[0].season }); } catch (e) { t = null; }
    if (t) tables.push({ key: lg, name: LEAGUES[lg].short, table: { ...t, rows: t.rows.map(r => ({ ...r, me: same(r.team) })) } });
  }
  const fixtures = mine.map(m => ({ ...publicMatch(m), competition: LEAGUES[m.league].short, mine: mineName(m) }));
  const next = mine.find(m => m.status === 'scheduled' && m.date >= today) || null;
  const lastFive = mine.filter(fin).slice(-5).reverse();
  const form = (formByTeam(mine.filter(fin)).get(nameSeen) || mine.filter(fin).slice(-5).map(m => result(m).r));

  // players of this club (only matches with stored details)
  const mineP = [...players.values()].filter(o => same(o.club));
  const rated = mineP.filter(o => o.rated >= 2 && o.rating != null);
  // position: from the line-up, else from the stored squad list (players known only from goal events have none in the line-up)
  const posOf = o => posLetter(o.pos) || posLetter((pickPlayer(o.name, squadRows) || {}).position);
  const card = o => ({ key: o.key, name: o.name, pos: posOf(o), pid: o.pid || null, num: o.num || null, apps: o.apps, minutes: o.minutes, goals: o.goals, assists: o.assists, yellow: o.yellow, red: o.red, rating: o.rating, rated: o.rated });
  const pick = (letter, n) => rated.filter(o => posOf(o) === letter).sort((a, b) => b.rating - a.rating || b.minutes - a.minutes).slice(0, n).map(card);
  // the XI of the club's LAST match whose line-up we hold: its formation and starters, but with the season numbers (average rating, goals, assists)
  const lastXi = (() => {
    const dBy = new Map(); for (const d of details) if (d && d.match_id && !dBy.has(d.match_id)) dBy.set(d.match_id, d);
    for (const m of mine.filter(fin).reverse()) {
      const d = dBy.get(m.id), side = same(m.home) ? 'home' : 'away';
      const L = d && d.data && !d.data.unavailable && d.data.lineups && d.data.lineups[side];
      if (!L || !Array.isArray(L.xi) || L.xi.length < 9) continue;
      const club = side === 'home' ? m.home : m.away;
      const grid = L.xi.every(p => /^\d+:\d+$/.test(p.grid || ''));
      const mk = p => { const o = players.get(playerKey(p.name, club)); const c = o ? card(o) : { name: p.name, goals: 0, assists: 0, rating: null, rated: 0, pid: null, num: null };
        return { ...c, name: p.name, pid: p.id || c.pid || null, num: p.n || c.num || null, pos: posLetter(p.pos) || c.pos || '' }; };
      let rows;
      if (grid) { const g = new Map(); L.xi.forEach(p => { const [r, c] = p.grid.split(':').map(Number); if (!g.has(r)) g.set(r, []); g.get(r).push({ p, c }); });
        rows = [...g.keys()].sort((a, b) => b - a).map(k => g.get(k).sort((a, b) => a.c - b.c).map(x => mk(x.p))); }   // attack first, goalkeeper last
      else rows = ['F', 'M', 'D', 'G'].map(l => L.xi.filter(p => posLetter(p.pos) === l).map(mk)).filter(r => r.length);
      return { formation: L.formation || (rows.length > 2 ? rows.slice(0, -1).reverse().map(r => r.length).join('-') : null), lines: rows, date: m.date, vs: side === 'home' ? m.away : m.home, score: `${m.hg}-${m.ag}`, last: true };
    }
    return null;
  })();
  const xi = lastXi || { formation: '4-3-3', lines: [pick('F', 3), pick('M', 3), pick('D', 4), pick('G', 1)] };   // attack first, goalkeeper last; fallback: best rated by position
  const top = (metric, n = 5) => mineP.filter(o => o[metric] > 0).sort((a, b) => b[metric] - a[metric] || a.apps - b.apps).slice(0, n).map(card);
  const stats = {
    competitions,
    leaders: { rating: rated.sort((a, b) => b.rating - a.rating).slice(0, 5).map(card), goals: top('goals'), assists: top('assists'), yellow: top('yellow') },
    players: mineP.map(card).sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.apps - a.apps),
    detailsHeld: new Set(mineP.flatMap(o => [...o.log].map(l => l.id))).size, matchesPlayed: mine.filter(fin).length
  };

  // squad from the stored squad lists, with photo ids taken from the line-ups where the names agree
  // photo ids: the API-Football squad we already saved for this club (id, name, shirt), joined by shirt number + name
  let apiPlayers = [];
  try { const sq = await store.listApiSquads(true); const e = sq.find(x => same(x.club)); apiPlayers = (e && e.players) || []; } catch (err) { apiPlayers = []; }
  const apiHit = p => apiPlayers.find(a => a.id && ((p.shirt && a.num === p.shirt && (sameApiName(a.name, p.name) || norm(a.name) === norm(p.name)))))
    || (() => { const c = apiPlayers.filter(a => a.id && (sameApiName(a.name, p.name) || norm(a.name) === norm(p.name))); return c.length === 1 ? c[0] : null; })();
  // the same player can be stored twice (abbreviated API name without birth date + full name with it): keep the complete one
  const dupOf = p => !p.dob && squadRows.some(o => o !== p && o.dob && ((p.shirt && o.shirt === p.shirt && sameApiName(p.name, o.name)) || norm(o.name) === norm(p.name)));
  const squadUniq = squadRows.filter(p => !dupOf(p));
  const squad = GROUPS.map(([g, label]) => ({ group: label, players: squadUniq.filter(p => posLetter(p.position) === g).map(p => {
    const hit = pickPlayer(p.name, mineP) || mineP.find(o => sameApiName(o.name, p.name)) || null;
    const dob = p.dob ? String(p.dob).slice(0, 10) : null;
    return { name: p.name, shirt: p.shirt || null, nationality: p.nationality || null, age: dob ? ageOn(dob, today) : (Number.isInteger(p.age) ? p.age : null), pid: (apiHit(p) || {}).id || (hit ? hit.pid || null : null), key: hit ? hit.key : null, loan: !!p.on_loan };
  }).sort((a, b) => (a.shirt || 99) - (b.shirt || 99) || a.name.localeCompare(b.name)) })).filter(g => g.players.length);
  const lgOfSquad = squadRows[0] && squadRows[0].league;
  let coach = null; try { if (lgOfSquad) { const cs = await store.listCoaches({ league: lgOfSquad, season: squadRows[0].season }); const c = cs.find(x => same(x.club)); if (c) coach = { name: c.name, nationality: c.nationality || null, pid: c.api_id || null }; } } catch (e) { coach = null; }
  let coachHist = { left: null, previous: [] }; try { if (store.listCoachSpells) coachHist = coachView(await store.listCoachSpells({ club: nameSeen }), coach); } catch (e) { /* no history yet */ }
  if (coach && coachHist.left) coach = { ...coach, left: coachHist.left };

  const names = [...new Set([nameSeen, ...mine.flatMap(m => [m.home, m.away]), ...tables.flatMap(t => t.table.rows.map(r => r.team))])];
  const crests = await crestIds(store, names).catch(() => ({}));
  return { club: nameSeen, crest: crests[nameSeen] || null, crests, today, competitions: competitions.map(c => ({ key: c.key, name: c.name })),
    overview: { next: next ? { ...publicMatch(next), competition: LEAGUES[next.league].short, mine: mineName(next) } : null, lastFive: lastFive.map(m => ({ ...publicMatch(m), competition: LEAGUES[m.league].short, mine: mineName(m) })), form, xi, coach, coachHistory: coachHist.previous,
      coverage: { matchesPlayed: stats.matchesPlayed, detailsHeld: stats.detailsHeld } },
    fixtures, tables, stats, squad, tabs: [['overview', 'Overview'], ['matches', 'Matches'], ['table', 'Table'], ['stats', 'Stats'], ['squad', 'Squad']].map(([k, l]) => ({ key: k, label: l })) };
}
