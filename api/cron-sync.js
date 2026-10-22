// Runs daily from Vercel Cron (vercel.json) and on demand from the admin page ("Run sync now").
// Auth: Vercel sends  Authorization: Bearer <CRON_SECRET>  when that env var exists.
import { storeFromEnv } from '../lib/bank-store.js';
import { runSync, safeEq } from '../lib/sync-run.js';
import { syncDue } from '../lib/sync-due.js';
import { fixturesGetter } from '../lib/apisports.js';


export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // ?mode=due : check matches that should be over by now. Safe to leave open: it only ever reads the matches we already
  // store, makes at most 2 API requests per run, and will not ask for the same date again within 25 minutes.
  if (req.query && req.query.mode === 'due') {
    const { store, error } = storeFromEnv();
    if (error) return res.status(500).json({ error });
    try {
      const r = await syncDue(store, { getFixtures: fixturesGetter((process.env.API_SPORTS_KEY || '').trim()) });
      return res.status(200).json({ ok: true, ran: r.ran, filled: r.filled, pending: r.pending, summary: r.summary });
    } catch (e) { return res.status(500).json({ error: String(e && e.message || e).slice(0, 200) }); }
  }
  const secret = (process.env.CRON_SECRET || '').trim(), admin = (process.env.ADMIN_KEY || '').trim();
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const adminKey = String(req.headers['x-admin-key'] || '');
  const ok = (secret && bearer && safeEq(bearer, secret)) || (admin && adminKey && safeEq(adminKey, admin));
  if (!ok) return res.status(401).json({ error: 'Not allowed' });
  const { store, error } = storeFromEnv();
  if (error) return res.status(500).json({ error });
  try {
    const out = await runSync(store);
    return res.status(200).json({ ok: !!(out.api.ok || (out.openfootball && out.openfootball.ok)), api: out.api.summary, openfootball: out.openfootball.summary });
  } catch (e) {
    try { await store.addLog({ kind: 'sync', ok: false, summary: 'Daily sync crashed: ' + String(e && e.message || e).slice(0, 300) }); } catch (_) { /* nothing more to do */ }
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
