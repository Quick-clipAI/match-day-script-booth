// node tests/push.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseServiceAccount, notifyUser, saveDeviceToken } from '../lib/push.js';
import { runJob } from '../lib/script-job.js';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = { client_email: 'fb@p.iam.gserviceaccount.com', private_key: pem, project_id: 'proj-1', type: 'service_account' };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc', GEMINI_API_KEY: 'g', FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) };
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const J = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
function world(tokens, fcm = () => J(200, { name: 'm' })) {
  const log = { fcm: [], deleted: [], oauth: 0, upserts: [] };
  const f = async (url, init = {}) => {
    url = String(url); const m = init.method || 'GET';
    if (url.includes('oauth2.googleapis.com')) { log.oauth++; const a = String(init.body).split('assertion=')[1]; const [h, c, s] = a.split('.'); assert.ok(crypto.createVerify('RSA-SHA256').update(h + '.' + c).verify(publicKey, s, 'base64url'), 'JWT signature valid'); assert.equal(JSON.parse(Buffer.from(c, 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging'); return J(200, { access_token: 'AT', expires_in: 3600 }); }
    if (url.includes('fcm.googleapis.com')) { const b = JSON.parse(init.body); log.fcm.push({ url, auth: init.headers.Authorization, b }); return fcm(b); }
    if (url.includes('/rest/v1/device_tokens?user_id') ) return J(200, tokens.map(token => ({ token })));
    if (url.includes('/rest/v1/device_tokens?token') && m === 'DELETE') { log.deleted.push(decodeURIComponent(url.split('token=eq.')[1].split('&')[0])); return J(204, {}); }
    if (url.includes('/rest/v1/device_tokens') && m === 'POST') { log.upserts.push({ url, b: JSON.parse(init.body) }); return J(201, {}); }
    if (url.includes('script_jobs') || url.includes('/chats') || url.includes('/messages') || url.includes('generativelanguage')) {
      if (url.includes('generativelanguage')) return J(200, { candidates: [{ content: { parts: [{ text: 'S' }] } }] });
      return m === 'POST' && url.includes('/messages') ? J(201, [{ id: 'm1' }]) : J(204, {});
    }
    return J(404, {});
  };
  return { f, log };
}
await t('service account parses (raw JSON, double-encoded, bad)', () => {
  assert.equal(parseServiceAccount(JSON.stringify(SA)).project_id, 'proj-1');
  assert.equal(parseServiceAccount(JSON.stringify(JSON.stringify(SA))).project_id, 'proj-1');
  assert.equal(parseServiceAccount('nope'), null); assert.equal(parseServiceAccount(''), null);
  assert.equal(parseServiceAccount(JSON.stringify({ client_email: 'a' })), null);
});
await t('sends to each device with a signed token and chat id', async () => {
  const w = world(['tokA'.padEnd(30, 'a'), 'tokB'.padEnd(30, 'b')]);
  const r = await notifyUser(env, 'u1', { title: 'T', body: 'B', data: { chatId: 'c1' } }, w.f);
  assert.equal(r.sent, 2); assert.equal(w.log.oauth, 1); assert.equal(w.log.fcm.length, 2);
  assert.ok(w.log.fcm[0].url.includes('/projects/proj-1/messages:send')); assert.equal(w.log.fcm[0].auth, 'Bearer AT');
  assert.equal(w.log.fcm[0].b.message.data.chatId, 'c1'); assert.equal(w.log.fcm[0].b.message.notification.body, 'B');
});
await t('a dead device token is deleted', async () => {
  const w = world(['dead'.padEnd(30, 'd')], () => J(404, { error: { status: 'NOT_FOUND', message: 'x' } }));
  const r = await notifyUser(env, 'u1', { title: 'T', body: 'B' }, w.f); assert.equal(r.sent, 0); assert.equal(w.log.deleted.length, 1);
});
await t('not configured: skipped, no throw', async () => { const r = await notifyUser({ ...env, FIREBASE_SERVICE_ACCOUNT: '' }, 'u1', {}, world([]).f); assert.equal(r.sent, 0); });
await t('FCM failure never throws', async () => { const w = world(['z'.padEnd(30, 'z')], () => { throw new Error('net'); }); const r = await notifyUser(env, 'u1', { title: 'T', body: 'B' }, w.f); assert.equal(r.sent, 0); });
await t('save token: validated, upsert on token', async () => {
  const w = world([]); assert.equal((await saveDeviceToken(env, 'u1', 'short', w.f)).status, 400);
  const r = await saveDeviceToken(env, 'u1', 'x'.repeat(40), w.f); assert.equal(r.ok, true); assert.ok(w.log.upserts[0].url.includes('on_conflict=token')); assert.equal(w.log.upserts[0].b.user_id, 'u1');
});
await t('finished job notifies the owner', async () => {
  const w = world(['tokA'.padEnd(30, 'a')]);
  const r = await runJob(env, { id: 'j', userId: 'u1', chatId: 'c1', system: 's', contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, w.f);
  assert.equal(r.ok, true); assert.equal(w.log.fcm.length, 1); assert.equal(w.log.fcm[0].b.message.data.chatId, 'c1'); assert.match(w.log.fcm[0].b.message.notification.body, /ready/);
});
console.log(n + ' push tests passed');
