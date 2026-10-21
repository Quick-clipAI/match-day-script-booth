// /api/device-token (POST) { token: <supabase access token>, deviceToken, action: 'save' | 'remove' }
// Links this phone's push address to the signed-in person (the app calls it after sign-in and on sign-out).
import { userFromToken } from '../lib/script-job.js';
import { saveDeviceToken, removeDeviceToken } from '../lib/push.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { message: 'POST only' } }); }
  const env = process.env, b = req.body || {};
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: { message: 'Server is not set up (Supabase keys missing).' } });
  const userId = await userFromToken(env, b.token).catch(() => null);
  if (!userId) return res.status(401).json({ error: { message: 'Please sign in again.' } });
  const out = b.action === 'remove' ? await removeDeviceToken(env, userId, String(b.deviceToken || '')) : await saveDeviceToken(env, userId, b.deviceToken);
  return res.status(out.status).json(out.ok ? { ok: true } : { error: { message: out.error || 'Failed' } });
}
