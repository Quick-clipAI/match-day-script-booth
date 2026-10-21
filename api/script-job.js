// /api/script-job  (POST)  Starts a background script-writing job and returns at once (202).
// Body: { token, chatId, jobId, system, contents }. The result is saved into the chat by the server.
import { createJob, runJob, backgroundRunner } from '../lib/script-job.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { message: 'POST only' } }); }
  const made = await createJob(process.env, req.body).catch(e => ({ ok: false, status: 500, error: 'Could not start the job: ' + String(e && e.message || e).slice(0, 160) }));
  if (!made.ok) return res.status(made.status).json({ error: { message: made.error } });
  const work = runJob(process.env, made.job);
  const bg = backgroundRunner();
  if (bg) { bg(work); return res.status(202).json({ ok: true, jobId: made.job.id }); }
  await work;                                   // runtime cannot run work after the answer: hold the request open instead
  return res.status(200).json({ ok: true, jobId: made.job.id, done: true });
}
