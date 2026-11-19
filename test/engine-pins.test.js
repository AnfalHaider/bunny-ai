import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { checkPins, loadPins } from '../src/server/engines/pins.js';

// CLI-ENGINES §5.4: the pins are tested ones, https only, on their own hosts, with a sha256 per file.
test('the shipped pins pass the check: Claude Code 2.1.311 and Codex 0.170.0, https, on their hosts, a sha256 for every file, the schema file present', () => {
  const pins = loadPins();
  assert.deepEqual(Object.keys(pins).sort(), ['claude-code', 'codex']);
  assert.deepEqual(checkPins(pins, { schemaExists: (f) => existsSync(new URL(`../src/server/engines/${f}`, import.meta.url)) }), []);
  assert.equal(pins['claude-code'].files[0].sha256, '32a333769981c72843b990f944cdcac53595ec5a98ca73ff75f0f5c417c79ee6');
  assert.ok(pins.codex.hosts.includes('release-assets.githubusercontent.com'), "GitHub's asset host is on the list");
  assert.equal(pins.codex.model, 'gpt-5.5');
});
test('checkPins names what is wrong: http, an off-list host, a missing hash, no files, a missing schema', () => {
  const base = { version: '1.2.3', entry: 'x.exe', signature: 'S', licence: 'L', hosts: ['a.test'], files: [{ url: 'https://a.test/f', sha256: 'a'.repeat(64), kind: 'zip' }] };
  assert.deepEqual(checkPins({ e: base }), []);
  const bad = (patch) => checkPins({ e: { ...base, ...patch } });
  assert.match(bad({ files: [{ ...base.files[0], url: 'http://a.test/f' }] })[0], /not https/);
  assert.match(bad({ files: [{ ...base.files[0], url: 'https://evil.test/f' }] })[0], /not on the host list/);
  assert.match(bad({ files: [{ ...base.files[0], sha256: 'zz' }] })[0], /no sha256/);
  assert.match(bad({ files: [] })[0], /no files/);
  assert.match(bad({ version: 'latest' })[0], /exact version/);
  assert.match(checkPins({ e: { ...base, schema: 'x.json' } }, { schemaExists: () => false })[0], /missing/);
  assert.deepEqual(checkPins({}), ['no engines are pinned']);
});
