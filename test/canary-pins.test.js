import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Security (canaries closed 2026-11-24): the canaries prove that Claude Code and Codex read no folder instruction file of their own under Bunny's flags, for ONE version of each. If a pin moves, the canaries must be rerun.
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const pins = read('src/server/engines/pins.json');
const tested = read('docs/security/canary-2026-11-24-pins.json');

test('the engine versions and file hashes in pins.json are the ones the canaries ran against', () => {
  for (const id of ['claude-code', 'codex']) {
    const pin = pins.engines[id];
    assert.equal(pin.version, tested[id].version, `${id}: the pinned version changed: rerun scripts/canary-engines.mjs and update docs/security/canary-2026-11-24-pins.json`);
    assert.deepEqual(pin.files.map((f) => f.sha256), [tested[id].sha256], `${id}: the pinned file changed: rerun the canaries`);
    assert.equal(pins.canaries[id].version, tested[id].version, `${id}: pins.json's canaries note names another version`);
  }
});

test('the raw canary JSON is the committed evidence: every run saw a request, and the controls saw markers', () => {
  const raw = read('docs/security/canary-2026-11-24.json');
  assert.ok(raw.runs.length >= 10);
  for (const r of raw.runs) assert.ok(r.requests >= 1, `${r.label} saw no request`);
  for (const r of raw.runs.filter((x) => /CONTROL/.test(x.label))) assert.ok(r.marks.length > 0, `${r.label}: a control must see a marker`);
  for (const r of raw.runs.filter((x) => !/CONTROL/.test(x.label))) assert.equal(r.marks.length, 0, `${r.label}: Bunny's flags must keep every marker out`);
  const sum = readFileSync(new URL('../docs/security/canary-2026-11-24-SUMMARY.md', import.meta.url), 'utf8');
  const sha = createHash('sha256').update(readFileSync(new URL('../docs/security/canary-2026-11-24.json', import.meta.url))).digest('hex');
  assert.ok(sum.includes(sha), 'the summary names the raw JSON by its sha256');
});

test('SB-2: the sign-in capture (the address the program gives its browser arrives whole) is for the pinned Claude Code version; a new pin repeats it', () => {
  const cap = read('docs/spikes/cli-engines/s-login/claude-auth-login-2026-11-26.json');
  assert.equal(cap.claudeCodeVersion, pins.engines['claude-code'].version, 'the pin moved: repeat the sign-in capture (docs/spikes/cli-engines/s-login), confirm the address arrives whole and quoted, and say so in the pin sign-off');
  assert.equal(cap.claudeCodeSha256, pins.engines['claude-code'].files[0].sha256);
  assert.equal(cap.addressArrivedWhole, true);
});

