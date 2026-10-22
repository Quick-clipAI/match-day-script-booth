// GET /api/bank?q=<question>&today=YYYY-MM-DD
// Public, read-only. Returns the verified-data block the chat adds to the AI's prompt.
// Nothing here can write; the database key never leaves the server.
import { storeFromEnv } from '../lib/bank-store.js';
import { planContext } from '../lib/bank-context.js';
import { isIsoDate } from '../lib/bank-core.js';
import { syncDue } from '../lib/sync-due.js';
import { fixturesGetter } from '../lib/apisports.js';

const cache = {};          // warm-instance cache of the club index (60 s)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const empty = { text: '', labels: [], clubs: [], used: [], cards: [] };
  try {
    const { store, error } = storeFromEnv();
    if (error) return res.status(200).json({ ...empty, note: 'bank not configured' });
    const q = String((req.query && req.query.q) || '').slice(0, 600);
    const t = String((req.query && req.query.today) || '');
    const today = isIsoDate(t) ? t : new Date().toISOString().slice(0, 10);
    // a chat question is also a trigger: if a match should be over and has no result yet, look it up first (throttled, max 4 s)
    if (process.env.API_SPORTS_KEY) { try { await Promise.race([syncDue(store, { getFixtures: fixturesGetter(process.env.API_SPORTS_KEY.trim()) }), new Promise(r => setTimeout(r, 4000))]); } catch (e) { /* the answer must not depend on it */ } }
    const out = await planContext(q, today, store, { cache });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (e) {
    // the chat must keep working when the bank is down
    return res.status(200).json({ ...empty, note: 'bank unavailable: ' + String(e && e.message || e).slice(0, 160) });
  }
}
