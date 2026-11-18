// tools/bump-version.mjs — one place that knows how versions go up, so nobody has to remember.
// Rule: the LAST number only goes 0-9; after 9 it carries into the middle number (1.7.9 -> 1.8.0), and the middle one also stops at 9 (1.9.9 -> 2.0.0).
//   node tools/bump-version.mjs app   "what changed"   -> APP_VERSION in index.html (+ ../creator-booth-app: package.json and www/index.html copy)
//   node tools/bump-version.mjs admin "what changed"   -> ADMIN_VERSION in admin.html
// With a text it also adds the README heading (this repo and, for "app", the app repo). Run it BEFORE committing; the pre-commit hook runs it for you if you forgot.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function nextVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim()); if (!m) throw new Error('not a version: ' + v);
  let [a, b, c] = [+m[1], +m[2], +m[3]];
  c += 1; if (c > 9) { c = 0; b += 1; } if (b > 9) { b = 0; a += 1; }
  return `${a}.${b}.${c}`;
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = { app: { file: 'index.html', re: /(const APP_VERSION = ')(\d+\.\d+\.\d+)(')/ }, admin: { file: 'admin.html', re: /(const ADMIN_VERSION = ')(\d+\.\d+\.\d+)(')/ } };

export function bump(kind, note = '', dir = root) {
  const t = TARGETS[kind]; if (!t) throw new Error('use "app" or "admin"');
  const f = path.join(dir, t.file), src = readFileSync(f, 'utf8'), m = t.re.exec(src); if (!m) throw new Error('version line not found in ' + t.file);
  const to = nextVersion(m[2]); writeFileSync(f, src.replace(t.re, `$1${to}$3`));
  const touched = [t.file];
  const appDir = path.join(dir, '..', 'creator-booth-app');
  if (kind === 'app' && existsSync(path.join(appDir, 'package.json'))) {
    const pj = path.join(appDir, 'package.json'); writeFileSync(pj, readFileSync(pj, 'utf8').replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${to}$2`));
    copyFileSync(f, path.join(appDir, 'www', 'index.html')); touched.push('../creator-booth-app/package.json', '../creator-booth-app/www/index.html');
  }
  if (note) for (const rd of [path.join(dir, 'README.md'), ...(kind === 'app' ? [path.join(appDir, 'README.md')] : [])]) {
    if (!existsSync(rd)) continue; const r = readFileSync(rd, 'utf8'), i = r.search(/^## /m);
    const head = `## ${kind === 'admin' ? 'Admin ' : ''}${to} — ${note}\n\n- (describe the change here)\n\n`;
    writeFileSync(rd, i < 0 ? r + '\n' + head : r.slice(0, i) + head + r.slice(i)); touched.push(path.relative(dir, rd));
  }
  return { from: m[2], to, touched };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [kind, ...rest] = process.argv.slice(2); const r = bump(kind, rest.join(' '));
  console.log(`${kind}: ${r.from} -> ${r.to}\nchanged: ${r.touched.join(', ')}`);
}
