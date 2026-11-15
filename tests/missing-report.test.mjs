// node tests/missing-report.test.mjs
import assert from 'node:assert/strict';
import { missingReport } from '../lib/missing-report.js';
const P = (o) => ({ id: o.name, league: 'EPL', season: 2026, club: 'X', position: 'Midfielder', shirt: 8, dob: '2000-01-01', age: 26, nationality: 'Spain', ...o });
const prof = [{ id: 'a', norm: 'full player', dob: '2000-01-01', mv: 1000000, tr: [['2020-07-01', 'A', 'B', 0]] }, { id: 'b', norm: 'half player', dob: '1999-05-05', mv: null, tr: [] }];
const rows = missingReport([P({ name: 'Full Player' }), P({ name: 'Half Player', dob: '1999-05-05' }), P({ name: 'Nobody', nationality: null, dob: null, age: 30, shirt: null }), P({ name: 'No Age', dob: null, age: null }), P({ name: 'Old Season', season: 2025, nationality: null })], prof);
const by = n => rows.find(r => r.name === n);
assert.equal(by('Full Player'), undefined, 'complete player is not listed');
assert.equal(by('Half Player').missing, 'transfer history; market value');
assert.match(by('Nobody').missing, /^nationality; exact birth date; shirt number; no Transfermarkt profile/);
assert.match(by('No Age').missing, /birth date and age/);
assert.equal(by('Old Season'), undefined, 'older seasons are ignored');
assert.equal(by('Nobody').has_transfer_history, 'no');
console.log('5 missing-report tests passed');
// both stores must offer profileIndex (a real-store method was once missing)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../lib/bank-store.js', import.meta.url), 'utf8');
assert.equal((src.match(/async profileIndex\(/g) || []).length, 2, 'memory store and Supabase store each need profileIndex');
assert.ok(/async profileIndex\(\) \{ return \(await getAll/.test(src), 'the Supabase version reads through getAll');
console.log('store method present in both stores');
