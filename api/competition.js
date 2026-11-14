// GET /api/competition?league=UCL&season=2026&today=YYYY-MM-DD
// Public, read-only. Everything the competition screen shows (table, fixtures and results, stats, knockout) from the data bank.
import { storeFromEnv } from '../lib/bank-store.js';
import { buildCompetition } from '../lib/competition-view.js';
import { LEAGUES, isIsoDate } from '../lib/bank-core.js';
import { playerCardFor } from '../lib/player-card.js';
import { buildTeam } from '../lib/team-view.js';
import { playerTrophyStatus } from '../lib/player-career.js';
import { playerTransfersGetter } from '../lib/apisports.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const q = req.query || {};
    if (q.trophiesof) {                                       // /api/competition?trophiesof=<api player id>&name=: his club trophies, fetched only when somebody opens him
      const { store: cs, error: ce } = storeFromEnv();
      if (ce) return res.status(200).json({ status: 'off' });
      const apiKey = (process.env.API_SPORTS_KEY || '').trim();
      const out = await playerTrophyStatus(cs, q.trophiesof, { getTransfers: apiKey ? playerTransfersGetter(apiKey) : null, name: String(q.name || '').slice(0, 80), dailyCap: Number(process.env.PLAYER_CAREER_DAILY_CAP) || 25, reserve: 15 });
      res.setHeader('Cache-Control', out.status === 'ready' || out.status === 'none' ? 'public, s-maxage=300, stale-while-revalidate=600' : 'no-store');
      return res.status(200).json({ status: out.status, data: out.data || null });
    }
    if (q.player) {                                           // /api/competition?player=<key>&today=: one player's card for the season
      const { store: ps, error: pe } = storeFromEnv();
      if (pe) return res.status(200).json({ error: 'bank not configured' });
      const pt = String(q.today || ''); const card = await playerCardFor(ps, String(q.player).slice(0, 120), isIsoDate(pt) ? pt : new Date().toISOString().slice(0, 10));
      if (!card) return res.status(404).json({ error: 'No stored matches for this player yet.' });
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      return res.status(200).json(card);
    }
    if (q.team) {                                             // /api/competition?team=<club>&today=: the team screen
      const { store: ts, error: te } = storeFromEnv();
      if (te) return res.status(200).json({ error: 'bank not configured' });
      const tt = String(q.today || ''); const view = await buildTeam(ts, String(q.team).slice(0, 80), isIsoDate(tt) ? tt : new Date().toISOString().slice(0, 10));
      if (!view) return res.status(404).json({ error: 'No stored matches or squad for this club yet.' });
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json(view);
    }
    const key = String(q.league || '').toUpperCase();
    if (!LEAGUES[key]) return res.status(404).json({ error: 'Unknown competition.' });
    const { store, error } = storeFromEnv();
    if (error) return res.status(200).json({ error: 'bank not configured' });
    const t = String(q.today || ''); const today = isIsoDate(t) ? t : new Date().toISOString().slice(0, 10);
    const season = /^\d{4}$/.test(String(q.season || '')) ? Number(q.season) : null;
    const out = await buildCompetition(store, key, season, today);
    if (!out) return res.status(404).json({ error: 'This competition has no screen.' });
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({ error: 'The competition could not be loaded: ' + String(e && e.message || e).slice(0, 160) });
  }
}
