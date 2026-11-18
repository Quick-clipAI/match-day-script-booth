// node tests/version.test.mjs
import assert from 'node:assert/strict';
import { nextVersion } from '../tools/bump-version.mjs';
import { readFileSync } from 'node:fs';
assert.equal(nextVersion('1.7.8'), '1.7.9'); assert.equal(nextVersion('1.7.9'), '1.8.0');
assert.equal(nextVersion('1.9.9'), '2.0.0'); assert.equal(nextVersion('1.7.30'), '1.8.0'); assert.equal(nextVersion('1.9.4'), '1.9.5');
assert.throws(() => nextVersion('1.7'));
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), adm = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
assert.ok(/const APP_VERSION = '\d+\.\d+\.\d+'/.test(idx) && /const ADMIN_VERSION = '\d+\.\d+\.\d+'/.test(adm), 'both version lines exist (the bump tool edits them)');
console.log('version tests passed');
