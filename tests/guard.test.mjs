// node tests/guard.test.mjs
import assert from 'node:assert/strict';
import { checkAi, checkAdminKey, lockSeconds, memoryStore, GUEST_FREE_MESSAGES, rateLimit } from '../lib/guard.js';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.stack); process.exitCode = 1; } };
const req = (headers = {}) => ({ headers: { 'x-forwarded-for': '1.2.3.4', ...headers } });
const J = (status, body) => ({ ok: status < 300, status, json: async () => body });
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc', AI_GUARD: 'enforce', ADMIN_KEY: 'rightkey', ADMIN_USER_ID: 'admin-uid' };
const authFetch = async (url, init) => (String(url).includes('/auth/v1/user') ? (init.headers.Authorization === 'Bearer ' + 'a'.repeat(30) ? J(200, { id: 'u1' }) : J(401, {})) : J(404, {}));

await t('guest: 3 different messages pass, the 4th asks to log in; same message id keeps working', async () => {
  const store = memoryStore(), T = 1e12;
  for (const id of ['m1', 'm2', 'm3']) assert.equal((await checkAi(req({ 'x-msg-id': id }), env, { store, now: T })).ok, true);
  assert.equal((await checkAi(req({ 'x-msg-id': 'm2' }), env, { store, now: T })).ok, true, 'a retry or backup call of message 2');
  const r = await checkAi(req({ 'x-msg-id': 'm4' }), env, { store, now: T });
  assert.equal(r.ok, false); assert.equal(r.status, 403); assert.equal(r.code, 'login_required');
});
await t('guest: one message id cannot be reused forever', async () => {
  const store = memoryStore(); let last;
  for (let i = 0; i < 12; i++) last = await checkAi(req({ 'x-msg-id': 'same' }), env, { store, now: 5e11 });
  assert.equal(last.ok, false); assert.equal(last.status, 429);
});
await t('old app (no message id, no token): told to update; another phone and a new day are separate', async () => {
  const store = memoryStore(), T = 1e12;
  const r = await checkAi(req(), env, { store, now: T }); assert.equal(r.ok, false); assert.equal(r.code, 'update_required'); assert.match(r.message, /out of date/);
  assert.equal((await checkAi(req({ 'x-msg-id': 'a' }), env, { store, now: T })).ok, true);
  for (const id of ['b', 'c']) await checkAi(req({ 'x-msg-id': id }), env, { store, now: T });
  assert.equal((await checkAi(req({ 'x-msg-id': 'd' }), env, { store, now: T })).ok, false);
  assert.equal((await checkAi(req({ 'x-forwarded-for': '9.9.9.9', 'x-msg-id': 'a' }), env, { store, now: T })).ok, true);
  assert.equal((await checkAi(req({ 'x-msg-id': 'd' }), env, { store, now: T + 86400e3 })).ok, true);
});
await t('signed-in user passes with a valid token; a bad token is treated as a guest', async () => {
  const store = memoryStore(), T = 1e12;
  for (let i = 0; i < 20; i++) assert.equal((await checkAi(req({ 'x-msg-id': 'q', authorization: 'Bearer ' + 'a'.repeat(30) }), env, { store, now: T, fetchImpl: authFetch })).user, 'u1');
  for (let i = 0; i < 3; i++) await checkAi(req({ 'x-msg-id': 'z' + i, authorization: 'Bearer ' + 'b'.repeat(30) }), env, { store, now: T, fetchImpl: authFetch });
  assert.equal((await checkAi(req({ 'x-msg-id': 'z9', authorization: 'Bearer ' + 'b'.repeat(30) }), env, { store, now: T, fetchImpl: authFetch })).ok, false);
});
await t('watch mode (AI_GUARD not enforce) never blocks', async () => {
  const store = memoryStore(); let r;
  for (let i = 0; i < 6; i++) r = await checkAi(req({ 'x-msg-id': 'w' + i }), { ...env, AI_GUARD: '' }, { store, now: 1e12 });
  assert.equal(r.ok, true);
});
await t('lock ladder', () => {
  const l = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(lockSeconds);
  assert.deepEqual(l, [0, 0, 0, 0, 30, 0, 0, 60, 300, 300, 300, 300, 300, 3600, 7200, 7200]);
});
await t('admin: 5 wrong keys lock for 30 s (even the right key is refused), then it opens; success resets', async () => {
  const store = memoryStore(), pushes = [], notify = async (e, uid, p) => { pushes.push([uid, p]); };
  let T = 2e12; const wrong = () => checkAdminKey(req({ 'x-admin-key': 'nope' }), env, { store, now: T, notify });
  for (let i = 0; i < 4; i++) assert.equal((await wrong()).status, 401);
  const fifth = await wrong(); assert.equal(fifth.status, 401); assert.equal(fifth.retryAfter, 30); assert.match(fifth.error, /30 seconds/);
  assert.equal(pushes.length, 1); assert.equal(pushes[0][0], 'admin-uid'); assert.match(pushes[0][1].body, /30 seconds/);
  assert.equal((await checkAdminKey(req({ 'x-admin-key': 'rightkey' }), env, { store, now: T + 10e3, notify })).status, 429);
  T += 31e3;
  assert.equal((await checkAdminKey(req({ 'x-admin-key': 'rightkey' }), env, { store, now: T, notify })).ok, true);
  for (let i = 0; i < 4; i++) assert.equal((await wrong()).status, 401, 'counter restarted after a good login');
});
await t('admin: 6th and 7th are free, 8th locks 1 min, then 5 min each, 14th 1 h, 15th 2 h', async () => {
  const store = memoryStore(), notify = async () => {}; let T = 3e12; const out = [];
  for (let i = 1; i <= 16; i++) { const r = await checkAdminKey(req({ 'x-admin-key': 'x' }), env, { store, now: T, notify }); out.push(r.retryAfter || 0); T += (r.retryAfter || 0) * 1000 + 1000; }
  assert.deepEqual(out, [0, 0, 0, 0, 30, 0, 0, 60, 300, 300, 300, 300, 300, 3600, 7200, 7200]);
});
await t('admin: another phone is not locked by the first; many places together pause everyone', async () => {
  const store = memoryStore(), notify = async () => {}, T = 4e12;
  for (let i = 0; i < 5; i++) await checkAdminKey(req({ 'x-admin-key': 'x' }), env, { store, now: T, notify });
  assert.equal((await checkAdminKey(req({ 'x-forwarded-for': '8.8.8.8', 'x-admin-key': 'rightkey' }), env, { store, now: T, notify })).ok, true);
  const s2 = memoryStore(); let r;
  for (let i = 0; i < 50; i++) r = await checkAdminKey(req({ 'x-forwarded-for': '10.0.0.' + i, 'x-admin-key': 'x' }), env, { store: s2, now: T, notify });
  assert.match(r.error, /Locked for 10 minutes/);
  assert.equal((await checkAdminKey(req({ 'x-forwarded-for': '7.7.7.7', 'x-admin-key': 'rightkey' }), env, { store: s2, now: T + 1000, notify })).status, 429);
});
await t('admin: missing server key and missing header', async () => {
  assert.equal((await checkAdminKey(req(), { ...env, ADMIN_KEY: '' }, { store: memoryStore() })).status, 500);
  assert.equal((await checkAdminKey(req(), env, { store: memoryStore(), notify: async () => {} })).status, 401);
});
await t('rateLimit: allows max per window then waits', async () => {
  const store = memoryStore(); let r;
  for (let i = 0; i < 3; i++) r = await rateLimit(req(), env, 'x', 3, 1000, { store, now: 100 + i });
  assert.equal(r.ok, true);
  r = await rateLimit(req(), env, 'x', 3, 1000, { store, now: 500 }); assert.equal(r.ok, false); assert.ok(r.retryAfter >= 1);
  assert.equal((await rateLimit(req(), env, 'x', 3, 1000, { store, now: 1200 })).ok, true);
});
console.log('guard tests:', n, 'passed');
