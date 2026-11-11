// api/gemini.js: when every configured model answers 404, it asks ListModels and uses the newest stable Flash model.
import assert from 'node:assert/strict';
process.env.GEMINI_API_KEY = 'test'; process.env.GEMINI_MODEL = 'gemini-2.5-flash,gemini-2.5-flash-lite';
const calls = [];
globalThis.fetch = async (url, opts) => {
  url = String(url); calls.push(url);
  const json = (status, body) => ({ status, json: async () => body });
  if (/\/models\?/.test(url)) return json(200, { models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
  if (/gemini-3\.5-flash:generateContent/.test(url)) return json(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  return json(404, { error: { message: 'This model is no longer available' } });
};
const { default: handler } = await import('../api/gemini.js');
const mkRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const res = mkRes();
await handler({ method: 'POST', headers: {}, body: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } }, res);
console.log(res.code, res.headers['x-gemini-model'], calls.length);
assert.equal(res.code, 200); assert.equal(res.headers['x-gemini-model'], 'gemini-3.5-flash');
console.log('ok');
