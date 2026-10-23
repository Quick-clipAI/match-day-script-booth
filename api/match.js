// GET /api/match?id=<match id>   or   /api/match?date=YYYY-MM-DD&home=..&away=..
// Public, read-only. Everything the match screen shows: score, events, line-ups, statistics, league table with qualification
// places, knockout bracket. Never calls API-Football: the details were saved by the sync after full time.
import { storeFromEnv } from '../lib/bank-store.js';
import { findMatch, buildView } from '../lib/match-view.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const { store, error } = storeFromEnv();
    if (error) return res.status(200).json({ error: 'bank not configured' });
    const q = req.query || {};
    const m = await findMatch(store, { id: q.id, date: String(q.date || ''), home: String(q.home || ''), away: String(q.away || '') });
    if (!m) return res.status(404).json({ error: 'That match is not in the data bank.' });
    const out = await buildView(store, m);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({ error: 'The match could not be loaded: ' + String(e && e.message || e).slice(0, 160) });
  }
}
