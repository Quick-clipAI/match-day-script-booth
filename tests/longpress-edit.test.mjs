// node tests/longpress-edit.test.mjs — the long-press flag must never block taps inside the message edit box
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const s = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ts = s.slice(s.indexOf("thread.addEventListener('touchstart'"), s.indexOf("thread.addEventListener('contextmenu'"));
assert.ok(/isTouchUI\(\)\) return;\s*\n\s*lpFired = false;/.test(ts), 'every new touch resets lpFired BEFORE the early returns');
assert.ok(/\.closest\('\.edit-wrap, a, button, textarea, input'\)\)\) e\.preventDefault\(\)/.test(ts), 'touchend never cancels taps inside the edit box, buttons, links or inputs');
assert.ok(/lpFired = false;\s*\n\}, \{ passive: false \}\)\);/.test(ts), 'touchend clears the flag');
const em = s.slice(s.indexOf('function enterUserEditMode'), s.indexOf('const restore = () =>'));
assert.ok(/lpFired = false;/.test(em), 'entering edit mode clears the flag');
// behaviour model of the old bug: flag stayed true, touch started in the edit box (early return), touchend swallowed the tap
let lpFired = true; const inEdit = true;
const oldTouchEnd = () => lpFired && !false;           // old: no exclusion, no reset
assert.equal(oldTouchEnd(), true);
lpFired = true; const newTouchStart = () => { lpFired = false; };
newTouchStart(); const newTouchEnd = () => lpFired && !inEdit; assert.equal(newTouchEnd(), false);
console.log('long-press edit-box tests passed');
