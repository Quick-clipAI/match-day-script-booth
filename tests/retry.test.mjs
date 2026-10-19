import assert from 'node:assert/strict';
import { createSupabaseStore } from '../lib/bank-store.js';
let calls = 0;
const fetchImpl = async () => { calls++; return calls < 3 ? { ok: false, status: 401, text: async () => '{"message":"JWT issued at future"}' } : { ok: true, status: 200, text: async () => '[]' }; };
const s = createSupabaseStore({ url: 'http://x', key: 'k', fetchImpl });
await s.listCoaches({});
assert.equal(calls, 3);
console.log('retry test passed');
