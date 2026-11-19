import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CSS-CHECK: src/ui/app.css is generated from docs/design/bunny-design-system.css and bunny-app-bindings.css. `build-css.mjs --check` builds in memory and fails when app.css differs
// (ignoring line endings), naming the bindings file, so a hand edit (which the next build would drop) cannot reach a release. The gate runs it as "css matches its build", also in --quick.
const script = new URL('../scripts/build-css.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = (root, ...args) => spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bunny-css-check-'));
  mkdirSync(join(root, 'docs/design'), { recursive: true });
  mkdirSync(join(root, 'src/ui'), { recursive: true });
  writeFileSync(join(root, 'docs/design/bunny-design-system.css'), ':root { --x: 1; }\n.a { color: var(--x); }\n');
  writeFileSync(join(root, 'docs/design/bunny-app-bindings.css'), '.b { margin: 0; }\n');
  assert.equal(run(root).status, 0); // build it
  return root;
}

test('a built app.css passes the check, with LF or with CRLF line endings', () => {
  const root = fixture();
  try {
    assert.equal(run(root, '--check').status, 0);
    const css = readFileSync(join(root, 'src/ui/app.css'), 'utf8');
    writeFileSync(join(root, 'src/ui/app.css'), css.replace(/\n/g, '\r\n'));
    assert.equal(run(root, '--check').status, 0, 'only the line endings differ: still a match');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a hand-edited app.css fails the check, and the message names the bindings file and the way out; the file is not rewritten', () => {
  const root = fixture();
  try {
    const edited = readFileSync(join(root, 'src/ui/app.css'), 'utf8') + '\n.hand-made { color: red; }\n';
    writeFileSync(join(root, 'src/ui/app.css'), edited);
    const r = run(root, '--check');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /docs\/design\/bunny-app-bindings\.css/);
    assert.match(r.stderr, /npm run build:css/);
    assert.equal(readFileSync(join(root, 'src/ui/app.css'), 'utf8'), edited, '--check never writes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing app.css fails the check; a source change that was not rebuilt fails it too', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'docs/design/bunny-app-bindings.css'), '.b { margin: 0; }\n.c { padding: 1px; }\n');
    assert.equal(run(root, '--check').status, 1, 'the source moved on, app.css did not');
    rmSync(join(root, 'src/ui/app.css'));
    assert.equal(run(root, '--check').status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the real app.css matches its build, and the gate runs the check (also in --quick)', () => {
  const real = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  assert.equal(spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', cwd: real }).status, 0);
  const gate = readFileSync(new URL('../scripts/gate.mjs', import.meta.url), 'utf8');
  assert.match(gate, /step\('css matches its build', process\.execPath, \['scripts\/build-css\.mjs', '--check'\]/);
  assert.doesNotMatch(gate, /if \(!quick\) step\('css matches/);
});
