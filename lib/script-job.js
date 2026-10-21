// lib/script-job.js
// Background "write the script" job: the app sends the finished prompt (system text + conversation) once; the server
// runs Gemini (with Google Search), saves the reply into the chat, and records the job's state so the app can show it
// when it is next opened. Everything talks to Supabase through its REST API with the server-side key.
// `fetchImpl` is injectable so the whole flow can be tested without a network.

import { notifyUser } from './push.js';

const MAX_PROMPT_CHARS = 60000;

export function sbHeaders(key, extra = {}) {
  return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...extra };
}

/** Who owns this access token? Returns the user id or null. */
export async function userFromToken(env, token, fetchImpl = fetch) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const r = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? String(u.id) : null;
}

const rest = (env, path, init = {}, fetchImpl = fetch) =>
  fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1' + path, { ...init, headers: sbHeaders(env.SUPABASE_SERVICE_KEY, init.headers) });

/** Validates the request and records the job. Returns { ok, status, error, job } */
export async function createJob(env, body, fetchImpl = fetch) {
  const { token, chatId, jobId, system, contents } = body || {};
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return { ok: false, status: 500, error: 'Server is not set up for background jobs (Supabase keys missing).' };
  if (!env.GEMINI_API_KEY) return { ok: false, status: 500, error: 'Server is missing GEMINI_API_KEY.' };
  if (!/^[\w-]{1,64}$/.test(String(chatId || '')) || !/^[0-9a-f-]{36}$/i.test(String(jobId || ''))) return { ok: false, status: 400, error: 'Bad chat or job id.' };
  if (!Array.isArray(contents) || !contents.length) return { ok: false, status: 400, error: 'Missing conversation.' };
  if (JSON.stringify(contents).length + JSON.stringify(system || '').length > MAX_PROMPT_CHARS) return { ok: false, status: 413, error: 'The conversation is too long to send as a background job. Start a new chat for the script.' };
  const userId = await userFromToken(env, token, fetchImpl);
  if (!userId) return { ok: false, status: 401, error: 'Please sign in again.' };
  const own = await rest(env, `/chats?id=eq.${encodeURIComponent(chatId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`, {}, fetchImpl);
  const rows = own.ok ? await own.json().catch(() => []) : [];
  if (!rows.length) return { ok: false, status: 403, error: 'That chat is not yours.' };
  // one script at a time per person: a stuck job stops counting after 8 minutes
  const since = new Date(Date.now() - 8 * 60000).toISOString();
  const busy = await rest(env, `/script_jobs?user_id=eq.${encodeURIComponent(userId)}&status=in.(queued,running)&created_at=gte.${encodeURIComponent(since)}&select=id`, {}, fetchImpl);
  const busyRows = busy.ok ? await busy.json().catch(() => []) : [];
  if (busyRows.length) return { ok: false, status: 429, error: 'A script is already being written. It will land in its chat when it is done.' };
  const ins = await rest(env, '/script_jobs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: jobId, user_id: userId, chat_id: chatId, status: 'queued' }) }, fetchImpl);
  if (!ins.ok) { const t = await ins.text().catch(() => ''); return { ok: false, status: 500, error: 'Could not record the job: ' + t.slice(0, 160) }; }
  return { ok: true, status: 202, job: { id: jobId, userId, chatId, system, contents } };
}

function textOf(data) {
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  return (parts || []).filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
}

async function geminiOnce(env, model, payload, fetchImpl) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

/** Gemini with search first; if search is refused or a model is busy, the next model / no search. */
export async function writeScript(env, job, fetchImpl = fetch) {
  const chain = String(env.GEMINI_MODEL || 'gemini-2.5-flash,gemini-2.5-flash-lite').split(',').map(x => x.trim()).filter(Boolean).slice(0, 3);
  const base = { contents: job.contents, system_instruction: { parts: [{ text: job.system || '' }] } };
  let lastErr = 'No answer came back.';
  let searched = true;
  for (const withSearch of [true, false]) {
    for (const model of chain) {
      const r = await geminiOnce(env, model, withSearch ? { ...base, tools: [{ google_search: {} }] } : base, fetchImpl);
      if (r.status === 200) { const t = textOf(r.data); if (t) return { text: t, searched: withSearch, model }; lastErr = 'The AI returned an empty answer.'; continue; }
      lastErr = (r.data && r.data.error && r.data.error.message) || ('HTTP ' + r.status);
    }
    searched = false;
  }
  const e = new Error(String(lastErr).slice(0, 300)); e.searched = searched; throw e;
}

/** Runs the job to the end and always leaves a visible result (the script, or a short failure note) in the chat. */
export async function runJob(env, job, fetchImpl = fetch, now = () => new Date().toISOString()) {
  const setJob = (patch) => rest(env, `/script_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }, fetchImpl).catch(() => {});
  await setJob({ status: 'running', started_at: now() });
  let content, ok = true, error = null;
  try {
    const r = await writeScript(env, job, fetchImpl);
    content = r.text + (r.searched ? '' : '\n\n_(Live web search was not available for this one, so double-check any recent facts.)_');
  } catch (e) {
    ok = false; error = String((e && e.message) || e).slice(0, 300);
    content = "I couldn't finish the script this time (" + error + "). Tap Regenerate to try again.";
  }
  let messageId = null;
  try {
    const ins = await rest(env, '/messages?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ chat_id: job.chatId, role: 'assistant', content, media: [], created_at: now() }) }, fetchImpl);
    const rows = ins.ok ? await ins.json().catch(() => []) : [];
    messageId = rows[0] && rows[0].id || null;
    if (!ins.ok) { ok = false; error = error || 'Could not save the script into the chat.'; }
  } catch (e) { ok = false; error = error || 'Could not save the script into the chat.'; }
  // bring the chat to the top of the list (ignored if the column does not exist yet)
  await rest(env, `/chats?id=eq.${encodeURIComponent(job.chatId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ updated_at: now() }) }, fetchImpl).catch(() => {});
  await setJob({ status: ok ? 'done' : 'error', error, message_id: messageId, finished_at: now() });
  // phone notification (works with the app closed); a push problem never changes the result
  await notifyUser(env, job.userId, { title: 'Creator Booth', body: ok ? 'Your script is ready.' : "Your script couldn't be finished. Open the chat and tap Regenerate.", data: { chatId: String(job.chatId), kind: 'script' } }, fetchImpl);
  return { ok, error, messageId };
}

/** Hands work to Vercel so it can finish after the HTTP answer is sent; null when this runtime cannot do that. */
export function backgroundRunner() {
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')];
    const c = ctx && typeof ctx.get === 'function' ? ctx.get() : null;
    if (c && typeof c.waitUntil === 'function') return (p) => c.waitUntil(p);
  } catch (e) { /* not on Vercel */ }
  return null;
}
