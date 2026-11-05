// lib/openliga-import.js — Bundesliga goals (scorer, minute, penalty, own goal) from OpenLigaDB, free and without a key.
// A match is changed only when its goal list adds up to our stored score. Stats already saved on the match are kept;
// details from API-Football are never touched. OpenLigaDB has no assists, cards or line-ups.
import { sameTeam } from './sync-due.js';

const DAY = 864e5;
export const OPENLIGA_URL = (season, group) => `https://api.openligadb.de/getmatchdata/bl1/${season}/${group}`;

/** one OpenLigaDB match -> { home, away, date, hg, ag, events } or null when it is unfinished or its goals do not add up */
export function convertOpenLiga(x) {
  if (!x || !x.matchIsFinished || !x.team1 || !x.team2) return null;
  const fin = (x.matchResults || []).find(r => /end/i.test(r.resultName)) || (x.matchResults || []).slice(-1)[0]; if (!fin) return null;
  const hg = Number(fin.pointsTeam1), ag = Number(fin.pointsTeam2);
  const goals = (x.goals || []).slice().sort((a, b) => (a.goalID || 0) - (b.goalID || 0) || (a.matchMinute || 0) - (b.matchMinute || 0));
  if (goals.length !== hg + ag) return null;
  let h = 0, a = 0; const events = [];
  for (const g of goals) {
    const nh = Number(g.scoreTeam1), na = Number(g.scoreTeam2);
    const side = nh > h ? 'home' : na > a ? 'away' : null; if (!side) return null;
    h = nh; a = na;
    events.push({ m: Number(g.matchMinute) || null, x: null, side, type: 'goal', detail: g.isOwnGoal ? 'Own Goal' : g.isPenalty ? 'Penalty' : 'Normal Goal', player: g.goalGetterName || '', other: '' });
  }
  if (h !== hg || a !== ag) return null;
  return { home: x.team1.teamName, away: x.team2.teamName, date: String(x.matchDateTime || '').slice(0, 10), hg, ag, events };
}

/** matches: array of raw OpenLigaDB matches (all matchdays) */
export async function importOpenLiga(store, raw, { league = 'BUNDESLIGA', season = 2026, now = Date.now() } = {}) {
  const finished = (await store.listMatches({ league, season })).filter(m => m.status === 'finished' && m.hg != null);
  const aliasMap = new Map((await store.listAliases().catch(() => [])).map(a => [a.alias, a.canonical]));
  const out = { read: raw.length, usable: 0, saved: 0, merged: 0, kept: 0, notPlaced: [], skipped: 0 };
  for (const x of raw) {
    const c = convertOpenLiga(x); if (!c) { out.skipped++; continue; } out.usable++;
    const t = Date.parse(c.date + 'T12:00:00Z');
    const m = finished.find(f => f.hg === c.hg && f.ag === c.ag && Math.abs(Date.parse(f.date + 'T12:00:00Z') - t) <= DAY && sameTeam(c.home, f.home, aliasMap) && sameTeam(c.away, f.away, aliasMap));
    if (!m) { out.notPlaced.push(`${c.date} ${c.home} ${c.hg}-${c.ag} ${c.away}`); continue; }
    const old = await store.getDetail(m.id).catch(() => null); const od = old && old.data && !old.data.unavailable ? old.data : null;
    if (od && od.source !== 'openmatchday' && od.source !== 'openliga') { out.kept++; continue; }
    const detail = od ? { ...od, events: c.events, goalMinutes: undefined, eventsSource: 'openliga' } : { v: 1, source: 'openliga', fetchedAt: new Date(now).toISOString(), venue: null, attendance: null, referee: null, events: c.events, lineups: {}, stats: [], best: null };
    if (detail.goalMinutes === undefined) delete detail.goalMinutes;
    await store.saveManualDetail(m.id, detail); od ? out.merged++ : out.saved++;
  }
  out.summary = `OpenLigaDB import: ${out.saved} new, ${out.merged} added to existing stats, ${out.kept} kept as they were, ${out.notPlaced.length} not placed, ${out.skipped} skipped (unfinished or goals do not add up)`;
  await store.addLog({ kind: 'openliga-import', ok: true, summary: out.summary, detail: { saved: out.saved, merged: out.merged, kept: out.kept, notPlaced: out.notPlaced.slice(0, 20) } });
  return out;
}
