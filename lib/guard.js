// lib/guard.js  Abuse protection: (1) guests get a few free AI messages per phone/network, then must log in;
// (2) wrong admin keys are slowed down with growing time-outs, and the admin gets a push alert.
// State lives in the `security_state` table (key -> json). If that table cannot be reached the guard falls back to
// memory inside the running instance, so a database problem never takes the chat down.
import crypto from 'node:crypto';
import { sbHeaders, userFromToken } from './script-job.js';
import { notifyUser } from './push.js';

export const GUEST_FREE_MESSAGES = 3;   // per phone/network per day (the day resets at 00:00 UTC = 01:00 Lagos)
const CALLS_PER_MESSAGE = 8;            // one chat message can make several calls (search, retry, backup AI)
const USER_CALLS_PER_HOUR = 150;        // signed-in accounts: a ceiling against a stolen/looping client
const GLOBAL_FAILS_PER_HOUR = 50;       // wrong admin keys from anywhere before every admin login pauses
const GLOBAL_PAUSE_S = 600;

export const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export function clientIp(req) {
  const h = (req && req.headers) || {};
  const xf = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(h['x-real-ip'] || '').trim() || (req && req.socket && req.socket.remoteAddress) || 'unknown';
}
export const hashIp = (ip, env) => crypto.createHmac('sha256', String((env && env.SUPABASE_SERVICE_KEY) || 'creator-booth')).update(String(ip)).digest('hex').slice(0, 24);

/** Seconds to wait after the n-th wrong admin key in a row: 5th -> 30s, 8th -> 1 min, 9th-13th -> 5 min each, 14th -> 1 h, 15th and later -> 2 h. */
export function lockSeconds(n) {
  if (n >= 15) return 7200;
  if (n === 14) return 3600;
  if (n >= 9) return 300;
  if (n === 8) return 60;
  if (n === 5) return 30;
  return 0;
}
export function human(s) {
  if (s >= 3600) { const h = Math.round(s / 360) / 10; return h + (h === 1 ? ' hour' : ' hours'); }
  if (s >= 60) { const m = Math.ceil(s / 60); return m + (m === 1 ? ' minute' : ' minutes'); }
  return s + ' seconds';
}

export function memoryStore() {
  const m = new Map();
  return { async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async set(k, v) { m.set(k, JSON.stringify(v)); } };
}
const shared = memoryStore();
/** Supabase-backed store with the memory store as fallback. */
export function guardStore(env, fetchImpl = fetch) {
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return shared;
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/security_state';
  return {
    async get(k) {
      try {
        const r = await fetchImpl(base + '?key=eq.' + encodeURIComponent(k) + '&select=data', { headers: sbHeaders(env.SUPABASE_SERVICE_KEY) });
        if (!r.ok) return shared.get(k);
        const rows = await r.json(); return rows && rows[0] ? rows[0].data : null;
      } catch (e) { return shared.get(k); }
    },
    async set(k, v) {
      try {
        const r = await fetchImpl(base + '?on_conflict=key', { method: 'POST', headers: sbHeaders(env.SUPABASE_SERVICE_KEY, { Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ key: k, data: v, updated_at: new Date().toISOString() }) });
        if (!r.ok) await shared.set(k, v);
      } catch (e) { await shared.set(k, v); }
    },
  };
}

const bearerOf = (req) => { const a = String((req.headers && req.headers.authorization) || ''); return /^Bearer\s+/i.test(a) ? a.replace(/^Bearer\s+/i, '').trim() : ''; };
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Decides whether an AI request may go ahead. Returns { ok:true } or { ok:false, status, code, message }.
 * enforce=false (env AI_GUARD not 'enforce') still counts but never blocks: used while old app versions, which do not
 * send the login token yet, are still installed.
 */
export async function checkAi(req, env, { store = guardStore(env), fetchImpl = fetch, now = Date.now() } = {}) {
  const enforce = String(env.AI_GUARD || '').toLowerCase() === 'enforce';
  const block = (status, code, message) => (enforce ? { ok: false, status, code, message } : { ok: true, watched: code });
  const token = bearerOf(req);
  if (token && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    const uid = await userFromToken(env, token, fetchImpl).catch(() => null);
    if (uid) {
      const k = 'u:' + uid, rec = (await store.get(k)) || { t: [] };
      rec.t = (rec.t || []).filter(x => now - x < 3600e3);
      if (rec.t.length >= USER_CALLS_PER_HOUR) return block(429, 'slow_down', 'You are sending requests very fast. Please wait a little and try again.');
      rec.t.push(now); await store.set(k, rec);
      return { ok: true, user: uid };
    }
  }
  const k = 'g:' + hashIp(clientIp(req), env), day = dayOf(now);
  let rec = await store.get(k); if (!rec || rec.day !== day) rec = { day, ids: {} };
  let id = String((req.headers && req.headers['x-msg-id']) || '').replace(/[^\w-]/g, '').slice(0, 64);
  if (!id) id = 'n' + crypto.randomBytes(6).toString('hex');      // an old app: every call counts as a message
  const used = Object.keys(rec.ids).length;
  if (rec.ids[id] != null) {
    if (rec.ids[id] >= CALLS_PER_MESSAGE) return block(429, 'slow_down', 'Too many requests for one message. Please wait a little and try again.');
    rec.ids[id]++;
  } else {
    if (used >= GUEST_FREE_MESSAGES) return block(403, 'login_required', 'You have used your ' + GUEST_FREE_MESSAGES + ' free messages. Create an account or log in to keep chatting.');
    rec.ids[id] = 1;
  }
  await store.set(k, rec);
  return { ok: true, guest: true, left: Math.max(0, GUEST_FREE_MESSAGES - Object.keys(rec.ids).length) };
}

/**
 * Checks the x-admin-key header with time-outs for wrong keys. Returns { ok:true } or { ok:false, status, error, retryAfter? }.
 * The right key is refused too while a time-out runs. Counting is per phone/network, plus a pause for everyone if wrong
 * keys pour in from many places.
 */
export async function checkAdminKey(req, env, { store = guardStore(env), fetchImpl = fetch, now = Date.now(), notify = notifyUser } = {}) {
  const admin = String(env.ADMIN_KEY || '').trim();
  if (!admin) return { ok: false, status: 500, error: 'ADMIN_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.' };
  const given = String((req.headers && req.headers['x-admin-key']) || '');
  const k = 'adm:' + hashIp(clientIp(req), env), gk = 'adm:all';
  const rec = (await store.get(k)) || { n: 0, until: 0, last: 0 };
  const g = (await store.get(gk)) || { t: [], until: 0 };
  const wait = (until) => { const s = Math.max(1, Math.ceil((until - now) / 1000)); return { ok: false, status: 429, retryAfter: s, error: 'Too many wrong keys. Try again in ' + human(s) + '.' }; };
  if (rec.until > now) return wait(rec.until);
  if (g.until > now) return wait(g.until);
  if (given && safeEqual(given, admin)) { if (rec.n) await store.set(k, { n: 0, until: 0, last: now }); return { ok: true }; }
  // wrong (or missing) key
  const n = (now - (rec.last || 0) > 24 * 3600e3 ? 0 : rec.n || 0) + 1;
  const lock = lockSeconds(n);
  await store.set(k, { n, until: lock ? now + lock * 1000 : 0, last: now });
  g.t = (g.t || []).filter(x => now - x < 3600e3); g.t.push(now);
  const globalLock = g.t.length >= GLOBAL_FAILS_PER_HOUR;
  if (globalLock) { g.until = now + GLOBAL_PAUSE_S * 1000; g.t = []; }
  await store.set(gk, g);
  if (lock || globalLock) {
    const body = globalLock ? 'Many wrong admin keys from different places in the last hour. Admin login is paused for ' + human(GLOBAL_PAUSE_S) + '.' : n + ' wrong admin keys in a row from one phone/network. It is locked for ' + human(lock) + '.';
    if (env.ADMIN_USER_ID) await notify(env, env.ADMIN_USER_ID, { title: 'Admin login blocked', body }, fetchImpl).catch(() => {});
  }
  const shown = Math.max(lock, globalLock ? GLOBAL_PAUSE_S : 0);
  return shown ? { ok: false, status: 401, retryAfter: shown, error: 'Wrong admin key. Locked for ' + human(shown) + '.' } : { ok: false, status: 401, error: 'Wrong admin key.' };
}

/** Simple per-phone/network limit: at most `max` calls per `windowMs` for the named bucket. Returns { ok } or { ok:false, retryAfter }. */
export async function rateLimit(req, env, name, max, windowMs, { store = guardStore(env), now = Date.now() } = {}) {
  const k = 'rl:' + name + ':' + hashIp(clientIp(req), env);
  const rec = (await store.get(k)) || { t: [] };
  rec.t = (rec.t || []).filter(x => now - x < windowMs);
  if (rec.t.length >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((rec.t[0] + windowMs - now) / 1000)) };
  rec.t.push(now); await store.set(k, rec);
  return { ok: true };
}
