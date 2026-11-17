/** W4-9: the "Wait for a first reply" setting: limits for each choice, the fallback, custom values, the 600 s cap, and the server refusing bad values. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { waitLimits, waitSeconds, validWaitSeconds } from '../src/server/waitLimits.js';
import { firstByteLimit, DEFAULT_STALL_MS, SLOW_FIRST_BYTE_MS, DEFAULT_GAP_MS } from '../src/server/chat.js';
import { startApp, json } from './helpers.js';

const SLOW = 'openai/gpt-5';
const FAST = 'meta/llama-3.1-70b';
const S = (n) => n * 1000;

for (const n of [15, 30, 60, 90, 120]) {
  test(`preset ${n}: first reply ${n}, slow model and silence ${n * 2}`, () => {
    assert.deepEqual(waitLimits(n), { firstMs: S(n), slowFirstMs: S(n * 2), gapMs: S(n * 2) });
    assert.equal(firstByteLimit(FAST, n), S(n));
    assert.equal(firstByteLimit(SLOW, n), S(n * 2));
  });
}

test('the default behaves exactly as before: 30 / 60 / 60', () => {
  assert.deepEqual(waitLimits(undefined), { firstMs: DEFAULT_STALL_MS, slowFirstMs: SLOW_FIRST_BYTE_MS, gapMs: DEFAULT_GAP_MS });
  assert.equal(firstByteLimit(FAST), DEFAULT_STALL_MS);
  assert.equal(firstByteLimit(SLOW), SLOW_FIRST_BYTE_MS);
});

test('a missing or unusable stored value falls back to 30', () => {
  for (const bad of [undefined, null, 'x', '45', NaN, Infinity, 0, -5, 9, 601, 1.5, '', {}, [], true]) {
    assert.equal(waitSeconds(bad), 30, String(bad));
    assert.equal(waitLimits(bad).firstMs, 30_000);
  }
});

test('custom values inside 10 to 600 are kept; outside, fractional or not a number are refused', () => {
  for (const ok of [10, 45, 600]) assert.equal(validWaitSeconds(ok), ok);
  for (const bad of [9, 601, 1.5, 'abc', '', '45', null, undefined, NaN]) assert.equal(validWaitSeconds(bad), null, String(bad));
  assert.deepEqual(waitLimits(45), { firstMs: 45_000, slowFirstMs: 90_000, gapMs: 90_000 });
});

test('the doubling is capped at 600 seconds', () => {
  assert.deepEqual(waitLimits(600), { firstMs: 600_000, slowFirstMs: 600_000, gapMs: 600_000 });
  assert.deepEqual(waitLimits(400), { firstMs: 400_000, slowFirstMs: 600_000, gapMs: 600_000 });
  assert.equal(firstByteLimit(SLOW, 400), 600_000);
  assert.equal(firstByteLimit(SLOW, 600), 600_000);
});

test('the server saves a good wait and refuses a bad one with a plain message', async (t) => {
  const { base } = await startApp(t);
  const put = (body) => json(base, '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put({ firstReplyWaitSeconds: 45 })).status, 200);
  assert.equal((await json(base, '/api/settings')).body.firstReplyWaitSeconds, 45);
  for (const bad of [5, 601, 1.5, 'abc', '', '45', null]) {
    const r = await put({ firstReplyWaitSeconds: bad });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.message, 'Use a whole number of seconds from 10 to 600. Not saved.');
  }
  assert.equal((await json(base, '/api/settings')).body.firstReplyWaitSeconds, 45, 'the last good value stays');
});
