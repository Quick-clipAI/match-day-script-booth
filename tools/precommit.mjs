// Runs from the git pre-commit hook. (1) If index.html / admin.html changed but its version line did not, bump it. (2) Any code change must come with a README change.
import { execSync } from 'node:child_process';
import { bump } from './bump-version.mjs';
const sh = c => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const staged = sh('git diff --cached --name-only').split('\n').filter(Boolean);
if (!staged.length) process.exit(0);
const verOf = (txt, re) => (re.exec(txt) || [])[1];
const checks = [['app', 'index.html', /const APP_VERSION = '(\d+\.\d+\.\d+)'/], ['admin', 'admin.html', /const ADMIN_VERSION = '(\d+\.\d+\.\d+)'/]];
for (const [kind, file, re] of checks) {
  if (!staged.includes(file)) continue;
  const before = verOf(sh(`git show HEAD:${file}`), re), now = verOf(sh(`git show :${file}`), re);
  if (before && now === before) { const r = bump(kind); sh(`git add ${file}`); console.log(`pre-commit: ${file} changed without a new version, bumped ${kind} ${r.from} -> ${r.to}` + (kind === 'app' ? ' (also updated ../creator-booth-app; commit that repo too)' : '')); }
}
const code = staged.filter(f => !/^(README\.md|tests\/|tools\/|\.github\/)/.test(f));
if (code.length && !staged.includes('README.md')) { console.error('pre-commit: README.md must be updated with every change (both repos). Add the README note, `git add README.md`, then commit again.\nChanged: ' + code.slice(0, 6).join(', ')); process.exit(1); }
