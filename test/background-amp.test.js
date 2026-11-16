import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { endsInBackground, translateChains, createWorkspace } from '../src/server/workspace.js';

test('Q2-8: only an unquoted single trailing & is a background job', () => {
  assert.equal(endsInBackground('npx serve -l 3001 &'), true);
  assert.equal(endsInBackground('npx serve&'), true);
  assert.equal(endsInBackground('a && b'), false);
  assert.equal(endsInBackground('echo "wait &"'), false);
  assert.equal(endsInBackground("echo 'x &'"), false);
  assert.equal(endsInBackground('a &&'), false);
  assert.equal(endsInBackground(''), false);
  assert.equal(endsInBackground('echo hi'), false);
});

test('Q2-8: the trailing & is dropped by translateChains (start_process is already the background form)', () => {
  assert.equal(translateChains('npx serve -l 3001 &'), 'npx serve -l 3001');
  assert.equal(translateChains('cd x && npx serve &'), 'cd x; if ($?) { npx serve }');
  assert.equal(translateChains('echo "a &"'), 'echo "a &"');
});

test('Q2-8: run_command refuses a trailing & and says to use start_process', async () => {
  const ws = createWorkspace(await mkdtemp(join(tmpdir(), 'bunny-amp-')), {});
  await assert.rejects(() => ws.run('run_command', { command: 'npx serve -l 3001 &' }), /start_process/);
});
