// node tests/scriptjob.test.mjs
import assert from 'node:assert/strict';
import { createJob, runJob, writeScript } from '../lib/script-job.js';
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc', GEMINI_API_KEY: 'g', GEMINI_MODEL: 'm1,m2' };
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', CHAT = '11111111-2222-3333-4444-555555555555';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const J = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function world({ user = 'u1', chatOwner = 'u1', busy = false, gemini = () => J(200, { candidates: [{ content: { parts: [{ text: 'SCRIPT TEXT' }] } }] }) } = {}) {
  const log = { messages: [], jobPatches: [], jobs: [], chatPatches: [], gemini: [] };
  const f = async (url, init = {}) => {
    url = String(url); const method = init.method || 'GET';
    if (url.includes('/auth/v1/user')) return user ? J(200, { id: user }) : J(401, {});
    if (url.includes('generativelanguage')) { const b = JSON.parse(init.body); log.gemini.push({ url, tools: !!b.tools }); return gemini(url, b, log.gemini.length); }
    if (url.includes('/rest/v1/chats?id=eq.') && method === 'GET') return J(200, chatOwner === user ? [{ id: CHAT }] : []);
    if (url.includes('/rest/v1/chats?id=eq.') && method === 'PATCH') { log.chatPatches.push(JSON.parse(init.body)); return J(204, {}); }
    if (url.includes('/rest/v1/script_jobs?user_id')) return J(200, busy ? [{ id: 'old' }] : []);
    if (url.includes('/rest/v1/script_jobs?id=eq.') && method === 'PATCH') { log.jobPatches.push(JSON.parse(init.body)); return J(204, {}); }
    if (url.includes('/rest/v1/script_jobs') && method === 'POST') { log.jobs.push(JSON.parse(init.body)); return J(201, {}); }
    if (url.includes('/rest/v1/messages') && method === 'POST') { const b = JSON.parse(init.body); log.messages.push(b); return J(201, [{ id: 'm1' }]); }
    return J(404, {});
  };
  return { f, log };
}
const body = (o = {}) => ({ token: 'x'.repeat(30), chatId: CHAT, jobId: UUID, system: 'sys', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], ...o });

await t('valid request creates a queued job', async () => { const w = world(); const r = await createJob(env, body(), w.f); assert.equal(r.ok, true); assert.equal(r.status, 202); assert.equal(w.log.jobs[0].status, 'queued'); assert.equal(w.log.jobs[0].user_id, 'u1'); });
await t('bad token is refused', async () => { const w = world({ user: null }); const r = await createJob(env, body(), w.f); assert.equal(r.status, 401); });
await t("someone else's chat is refused", async () => { const w = world({ chatOwner: 'other' }); const r = await createJob(env, body(), w.f); assert.equal(r.status, 403); assert.equal(w.log.jobs.length, 0); });
await t('a second job while one runs is refused', async () => { const w = world({ busy: true }); const r = await createJob(env, body(), w.f); assert.equal(r.status, 429); });
await t('oversized prompt is refused', async () => { const w = world(); const r = await createJob(env, body({ contents: [{ role: 'user', parts: [{ text: 'a'.repeat(70000) }] }] }), w.f); assert.equal(r.status, 413); });
await t('missing keys are reported', async () => { const r = await createJob({ ...env, GEMINI_API_KEY: '' }, body(), world().f); assert.equal(r.status, 500); });

await t('job runs: script saved to the chat, job done, chat bumped', async () => {
  const w = world(); const r = await runJob(env, { id: UUID, userId: 'u1', chatId: CHAT, system: 's', contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, w.f);
  assert.equal(r.ok, true); assert.equal(w.log.messages[0].content, 'SCRIPT TEXT'); assert.equal(w.log.messages[0].role, 'assistant'); assert.equal(w.log.messages[0].chat_id, CHAT);
  assert.equal(w.log.jobPatches.at(-1).status, 'done'); assert.equal(w.log.jobPatches.at(-1).message_id, 'm1'); assert.ok(w.log.chatPatches[0].updated_at); assert.equal(w.log.gemini[0].tools, true);
});
await t('search refused: retries without search and says so', async () => {
  const w = world({ gemini: (u, b) => b.tools ? J(429, { error: { message: 'grounding quota' } }) : J(200, { candidates: [{ content: { parts: [{ text: 'PLAIN SCRIPT' }] } }] }) });
  const r = await runJob(env, { id: UUID, userId: 'u1', chatId: CHAT, system: 's', contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, w.f);
  assert.equal(r.ok, true); assert.match(w.log.messages[0].content, /PLAIN SCRIPT/); assert.match(w.log.messages[0].content, /Live web search was not available/);
});
await t('model busy: next model is tried', async () => {
  const w = world({ gemini: (u) => u.includes('/m1:') ? J(503, { error: { message: 'busy' } }) : J(200, { candidates: [{ content: { parts: [{ text: 'FROM M2' }] } }] }) });
  const r = await writeScript(env, { system: 's', contents: [] }, w.f); assert.equal(r.text, 'FROM M2'); assert.equal(r.model, 'm2');
});
await t('total failure still leaves a visible note and an error job', async () => {
  const w = world({ gemini: () => J(500, { error: { message: 'boom' } }) });
  const r = await runJob(env, { id: UUID, userId: 'u1', chatId: CHAT, system: 's', contents: [{ role: 'user', parts: [{ text: 'x' }] }] }, w.f);
  assert.equal(r.ok, false); assert.match(w.log.messages[0].content, /couldn't finish the script/); assert.equal(w.log.jobPatches.at(-1).status, 'error');
});
console.log(n + ' script-job tests passed');
