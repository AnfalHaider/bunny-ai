import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waitingFor } from '../scripts/test-progress.mjs';

// TEST-DNS: when a run goes silent, HUNG names the file the run is waiting for (node --test reports files in order, only when each has ended).
const root = fileURLToPath(new URL('..', import.meta.url));

test('waitingFor: the first given file the reporter has not heard of is the one a hung run waits for', () => {
  const line = (e, file) => JSON.stringify({ e, file, name: 'x', nesting: 0, t: 1 });
  // the reporter writes Windows paths with backslashes; the runner compares them with the forward-slash ones it was given
  const win = (name) => `C:${String.fromCharCode(92)}r${String.fromCharCode(92)}test${String.fromCharCode(92)}${name}`;
  const text = [line('start', win('a.test.js')), line('pass', win('a.test.js')), line('fail', win('b.test.js')), 'not json'].join(String.fromCharCode(10));
  const files = ['C:/r/test/a.test.js', 'C:/r/test/b.test.js', 'C:/r/test/c.test.js', 'C:/r/test/d.test.js'];
  const { heard, waiting } = waitingFor(text, files);
  assert.equal(heard, 2);
  assert.deepEqual(waiting, ['C:/r/test/c.test.js', 'C:/r/test/d.test.js']);
});

test('a run that goes silent prints HUNG with the file the run is waiting for, and leaves no temp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-hang-'));
  try {
    writeFileSync(join(dir, 'ok.test.js'), "import { test } from 'node:test';\ntest('passes at once', () => {});\n");
    writeFileSync(join(dir, 'hang.test.js'), "import { test } from 'node:test';\ntest('never finishes', () => new Promise((resolve) => setTimeout(resolve, 25_000)));\n");
    const env = { ...process.env, BUNNY_TEST_DIR: dir, BUNNY_TEST_SILENT_MS: '4000' };
    delete env.NODE_TEST_CONTEXT; // this test runs inside node --test; the runner it starts is a run of its own
    const r = spawnSync(process.execPath, ['scripts/unit-tests.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000, env });
    const all = `${r.stdout}\n${r.stderr}`;
    assert.match(all, /HUNG: "all other unit tests, in parallel" printed nothing for/);
    assert.match(all, /Waiting for \(the run reports files in order, so this one holds the rest back\): .*hang\.test\.js/);
    assert.match(all, /Files finished and reported: 0 of 2/);
    assert.match(all, /Not yet reported after it: .*ok\.test\.js/);
    assert.match(all, /The last thing it printed:/);
    assert.notEqual(r.status, 0);
    assert.deepEqual(readdirSync(tmpdir()).filter((f) => f.startsWith(`bunny-test-progress-${r.pid}-`)), [], 'the progress file is removed when the run ends');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
