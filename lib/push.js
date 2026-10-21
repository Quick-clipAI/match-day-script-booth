// lib/push.js  Firebase Cloud Messaging (HTTP v1) sender with no dependencies.
// Env: FIREBASE_SERVICE_ACCOUNT = the whole service-account JSON. `fetchImpl` is injectable for tests.
import crypto from 'node:crypto';

export function parseServiceAccount(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  for (let i = 0; i < 2 && typeof s === 'string'; i++) {
    try { const v = JSON.parse(s); if (v && typeof v === 'object') { s = v; break; } s = v; } catch (e) { break; }
  }
  if (!s || typeof s !== 'object') return null;
  if (!s.client_email || !s.private_key || !s.project_id) return null;
  return { client_email: s.client_email, private_key: String(s.private_key).replace(/\\n/g, '\n'), project_id: s.project_id };
}

const b64u = (b) => Buffer.from(b).toString('base64url');
let cached = null; // { token, exp, email }

export async function getAccessToken(sa, fetchImpl = fetch, nowMs = Date.now()) {
  if (cached && cached.email === sa.client_email && cached.exp - 60000 > nowMs) return cached.token;
  const iat = Math.floor(nowMs / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key, 'base64url');
  const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Google sign-in for push failed: ' + String(d.error_description || d.error || r.status).slice(0, 120));
  cached = { token: d.access_token, exp: nowMs + (Number(d.expires_in) || 3600) * 1000, email: sa.client_email };
  return cached.token;
}

/** Sends one notification. Returns { ok, gone } where gone=true means the device token is dead and should be deleted. */
export async function sendPush(sa, deviceToken, { title, body, data }, fetchImpl = fetch) {
  const at = await getAccessToken(sa, fetchImpl);
  const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: deviceToken, notification: { title, body }, data: data || {}, android: { priority: 'HIGH' } } }),
  });
  if (r.ok) return { ok: true, gone: false };
  const d = await r.json().catch(() => ({}));
  const status = d && d.error && d.error.status;
  return { ok: false, gone: status === 'NOT_FOUND' || status === 'UNREGISTERED' || r.status === 404, error: (d && d.error && d.error.message) || ('HTTP ' + r.status) };
}

const rest = (env, path, init = {}, fetchImpl = fetch) =>
  fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1' + path, { ...init, headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });

/** Notifies every device this person registered. Never throws: a push problem must not undo a finished script. */
export async function notifyUser(env, userId, payload, fetchImpl = fetch) {
  try {
    const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if (!sa || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return { sent: 0, skipped: 'not configured' };
    const r = await rest(env, `/device_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token`, {}, fetchImpl);
    const rows = r.ok ? await r.json().catch(() => []) : [];
    let sent = 0;
    for (const row of rows.slice(0, 10)) {
      const res = await sendPush(sa, row.token, payload, fetchImpl).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
      if (res.ok) sent++;
      else if (res.gone) await rest(env, `/device_tokens?token=eq.${encodeURIComponent(row.token)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, fetchImpl).catch(() => {});
    }
    return { sent };
  } catch (e) { return { sent: 0, error: String(e && e.message || e) }; }
}

/** Saves (or moves) a device token to the signed-in person. */
export async function saveDeviceToken(env, userId, token, fetchImpl = fetch) {
  if (!/^[\w:.\-]{20,4096}$/.test(String(token || ''))) return { ok: false, status: 400, error: 'Bad device token.' };
  const r = await rest(env, '/device_tokens?on_conflict=token', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ token, user_id: userId, platform: 'android', updated_at: new Date().toISOString() }) }, fetchImpl);
  if (!r.ok) return { ok: false, status: 500, error: 'Could not save the device: ' + (await r.text().catch(() => '')).slice(0, 140) };
  return { ok: true, status: 200 };
}
export async function removeDeviceToken(env, userId, token, fetchImpl = fetch) {
  const r = await rest(env, `/device_tokens?token=eq.${encodeURIComponent(token)}&user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, fetchImpl);
  return { ok: r.ok, status: r.ok ? 200 : 500 };
}
