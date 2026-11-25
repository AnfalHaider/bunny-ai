import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// QA's Quick ask audit (e2e/w0115-qaudit.mjs, from claude/qa-quickask-audit-0115) is run as a test: the bar's real answerer against Bunny's real server, an invented index of invented files,
// a stand-in internet and a scripted model that calls its tools, ignores them, or answers with the needs-window marker. Every row must pass: a model that ignores its tools still gets a sourced answer,
// a files question is searched or answered in Bunny's own words, and the window card never shows for a files or web question.
const root = fileURLToPath(new URL('..', import.meta.url));

test('QA\'s Quick ask audit: every flow passes (A1-A10 files, B1-B9 web, C1-C2 settings that survive a restart)', { timeout: 240_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-qaudit-'));
  try {
    const out = join(dir, 'rows.json');
    const env = { ...process.env, BUNNY_FAKE_UPSTREAM: '1', BUNNY_PCSEARCH_FAKE: '1' };
    delete env.CLAUDE_PROJECT_DIR;
    const run = spawnSync(process.execPath, [join(root, 'e2e', 'w0115-qaudit.mjs'), out], { cwd: root, env, encoding: 'utf8', timeout: 200_000 });
    const rows = JSON.parse(readFileSync(out, 'utf8'));
    const bad = rows.filter((r) => !r.ok).map((r) => `${r.id}: ${String(r.actual).slice(0, 200)}`);
    assert.deepEqual(bad, [], `${run.stdout.slice(-1500)}`);
    assert.ok(rows.length >= 21, 'all the flows ran');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
