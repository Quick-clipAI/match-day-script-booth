// lib/highlightly-status.js — what the Highlightly fill-in has done: per league progress, per match review, a log and the gaps.
import { HL_LEAGUES } from './highlightly.js';
import { LEAGUES } from './bank-core.js';

const minuteTxt = e => (e.m != null ? e.m + (e.x ? '+' + e.x : '') + "'" : '');
const evTxt = e => `${minuteTxt(e)} ${e.type === 'goal' ? '⚽' : e.type === 'card' ? (/red/i.test(e.detail) ? '🟥' : '🟨') : '🔁'} ${e.player || ''}${e.type === 'goal' && e.other ? ' (assist ' + e.other + ')' : e.type === 'subst' && e.other ? ' ↔ ' + e.other : ''}`.trim();

export async function hlStatus(store, { now = Date.now(), dailyCap = 48 } = {}) {
  const meta = await store.strikerMeta('hl_match').catch(() => []);
  const today = new Date(now).toISOString().slice(0, 10);
  const byOur = new Map(); meta.forEach(r => { if (r.ourId) byOur.set(r.ourId, r); });
  const fetchedToday = meta.filter(r => String(r.created_at || '').slice(0, 10) === today).length;
  const last = meta.length ? meta[meta.length - 1] : null;
  const withHdr = [...meta].reverse().find(r => r.credits_left != null);
  const lists = await store.strikerRows('hl_list').catch(() => []); const listed = new Map(); lists.forEach(l => { if (l && l.league) listed.set(l.league, l.matches.length); });
  const out = { leagues: [], matches: [], gaps: 0, log: [], requests: { fetchedToday, requestsToday: fetchedToday * 2, dailyCapMatches: dailyCap, dailyCapRequests: dailyCap * 2, highlightlyLimit: 100, highlightlyRemaining: withHdr ? withHdr.credits_left : null, remainingAt: withHdr ? withHdr.created_at : null }, lastFetchAt: last ? last.created_at : null, listsLoaded: [...listed.entries()].map(([l, n]) => ({ league: l, matches: n })) };
  const nameOf = new Map();
  for (const lg of Object.keys(HL_LEAGUES)) {
    const ours = (await store.listMatches({ league: lg, season: 2026 }).catch(() => [])).filter(m => m.status === 'finished' && m.hg != null).sort((a, b) => (a.date < b.date ? 1 : -1));
    const det = new Map((await store.listDetailsLike(lg + '|2026|').catch(() => [])).map(d => [d.match_id, d.data]));
    const c = { league: lg, name: LEAGUES[lg].short, finished: ours.length, done: 0, kept: 0, waiting: 0, failed: 0, goalsDiffer: 0 };
    for (const m of ours) {
      nameOf.set(m.id, `${m.home} ${m.hg}-${m.ag} ${m.away}`);
      const d = det.get(m.id), r = byOur.get(m.id);
      const hl = d && (d.source === 'highlightly' || d.eventsSource === 'highlightly');
      const better = d && !hl && !['openmatchday', 'openliga'].includes(d.source);
      let status = hl ? 'done' : better ? 'kept' : r && r.failed ? 'failed' : r ? 'goals-differ' : 'waiting';
      if (status === 'done') c.done++; else if (status === 'kept') c.kept++; else if (status === 'failed') { c.failed++; out.gaps++; } else if (status === 'goals-differ') { c.goalsDiffer++; out.gaps++; } else { c.waiting++; out.gaps++; }
      const ev = (d && d.events) || [], lu = (d && d.lineups) || {};
      const row = { id: m.id, league: lg, date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, status, fetchedAt: r ? r.created_at : null, source: d ? (d.source || 'api-football') : null };
      if (hl) {
        row.counts = { goals: ev.filter(e => e.type === 'goal').length, assists: ev.filter(e => e.type === 'goal' && e.other).length, cards: ev.filter(e => e.type === 'card').length, subs: ev.filter(e => e.type === 'subst').length,
          homeXI: (lu.home && lu.home.xi || []).length, homeBench: (lu.home && lu.home.subs || []).length, awayXI: (lu.away && lu.away.xi || []).length, awayBench: (lu.away && lu.away.subs || []).length };
        row.events = ev.filter(e => e.type !== 'subst').slice(0, 14).map(evTxt);
      }
      out.matches.push(row);
    }
    out.leagues.push(c);
  }
  out.log = meta.slice(-30).reverse().map(r => ({ at: r.created_at, match: nameOf.get(r.ourId) || ('Highlightly #' + r.game_id), ok: !!r.ok && !r.failed, result: r.failed ? 'not available (404)' : r.ok ? 'saved' : 'error, will retry' }));
  return out;
}
