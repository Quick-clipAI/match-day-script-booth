// GET /api/competition?league=UCL&season=2026&today=YYYY-MM-DD
// Public, read-only. Everything the competition screen shows (table, fixtures and results, stats, knockout) from the data bank.
import { storeFromEnv } from '../lib/bank-store.js';
import { buildCompetition } from '../lib/competition-view.js';
import { LEAGUES, isIsoDate } from '../lib/bank-core.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const q = req.query || {};
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
