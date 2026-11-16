import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isFree } from '../src/providers/discovery.js';
import { FREE_ALLOWANCE, freeKindOf } from '../src/providers/freeAllowance.js';
import { orderProviders } from '../src/providers/providerOrder.js';
import { PROVIDERS } from '../src/providers/catalog.js';

// --- isFree -------------------------------------------------------------

test('isFree: OpenRouter :free id suffix is free', () => {
  assert.equal(isFree({}, 'vendor/model:free'), true);
  assert.equal(isFree({}, 'house-model-free'), true);
});

test('isFree: OpenRouter pricing with zero strings is free; a non-zero price is not', () => {
  assert.equal(isFree({ pricing: { prompt: '0', completion: '0' } }, 'a/b'), true);
  assert.equal(isFree({ pricing: { prompt: '0.000001', completion: '0' } }, 'a/b'), false);
  assert.equal(isFree({ pricing: { prompt: '0', completion: '0.5' } }, 'a/b'), false);
});

test('isFree: OpenCode cost shape (cost.text.input.price / output.price)', () => {
  const zero = { cost: { text: { input: { price: 0 }, output: { price: 0 } } } };
  const paid = { cost: { text: { input: { price: 0 }, output: { price: 2 } } } };
  assert.equal(isFree(zero, 'big-pickle'), true);
  assert.equal(isFree(paid, 'paid-model'), false);
});

test('isFree: Vercel pricing.input / pricing.output shape', () => {
  assert.equal(isFree({ type: 'language', pricing: { input: '0', output: '0' } }, 'reflection/beam'), true);
  assert.equal(isFree({ type: 'language', pricing: { input: '0.000002', output: '0' } }, 'x/y'), false);
  // One side only is not enough to call a model free.
  assert.equal(isFree({ pricing: { input: '0' } }, 'x/y'), false);
});

test('isFree: a non-language type is never a free chat model', () => {
  assert.equal(isFree({ type: 'image', pricing: { input: '0', output: '0' } }, 'x/image'), false);
  assert.equal(isFree({ type: 'rerank', pricing: { input: '0', output: '0' } }, 'x/rerank'), false);
  assert.equal(isFree({ type: 'embedding', cost: { text: { input: { price: 0 }, output: { price: 0 } } } }, 'x/e'), false);
  assert.equal(isFree({ type: 'music' }, 'lyria-free'), false);
  assert.equal(isFree({ type: 'language', pricing: { input: '0', output: '0' } }, 'x/chat'), true);
});

test('isFree: no price information at all is NOT free', () => {
  assert.equal(isFree({}, 'plain/model'), false);
  assert.equal(isFree({ pricing: {} }, 'plain/model'), false);
  assert.equal(isFree({ cost: {} }, 'plain/model'), false);
  assert.equal(isFree({ pricing: { input: '', output: '' } }, 'empty/model'), false);
  assert.equal(isFree({ pricing: { input: null, output: 'abc' } }, 'bad/model'), false);
});

test('isFree: keeps the existing prompt/completion cases', () => {
  assert.equal(isFree({ pricing: { prompt: 0, completion: 0 } }, 'zero/model'), true);
  assert.equal(isFree({ pricing: { prompt: 0 } }, 'half/model'), true);
});

// --- freeKindOf ---------------------------------------------------------

test('freeKindOf: null for a model that is not free, whatever the provider', () => {
  assert.equal(freeKindOf('openrouter', false), null);
  assert.equal(freeKindOf('unknown-provider', false), null);
});

test('freeKindOf: "daily" only for a provider whose kind is daily', () => {
  assert.equal(freeKindOf('openrouter', true), 'daily');
  assert.equal(freeKindOf('google', true), 'daily');
  assert.equal(freeKindOf('vercel', true), 'free');
  assert.equal(freeKindOf('github-copilot', true), 'free');
  assert.equal(freeKindOf('zhipu', true), 'free');
  assert.equal(freeKindOf('opencode-console', true), 'free');
});

test('freeKindOf: an unknown provider gives plain "free" for a zero-cost list entry', () => {
  assert.equal(freeKindOf('groq', true), 'free');
  assert.equal(freeKindOf('no-such-provider', true), 'free');
});

// --- FREE_ALLOWANCE table ----------------------------------------------

test('FREE_ALLOWANCE has an entry for every catalogue provider', () => {
  const missing = PROVIDERS.map((p) => p.id).filter((id) => !FREE_ALLOWANCE[id]);
  assert.deepEqual(missing, [], `providers missing from FREE_ALLOWANCE: ${missing.join(', ')}`);
});

test('FREE_ALLOWANCE entries are well formed', () => {
  const kinds = new Set(['daily', 'monthly', 'once', 'priced-zero', 'none', 'unknown']);
  for (const [id, entry] of Object.entries(FREE_ALLOWANCE)) {
    assert.ok(kinds.has(entry.kind), `${id} has kind ${entry.kind}`);
    assert.equal(typeof entry.note, 'string', `${id} note`);
    assert.ok(entry.note.length > 0, `${id} note is empty`);
    assert.match(entry.url, /^https:\/\//, `${id} url`);
    assert.equal(entry.checked, '2026-11-17', `${id} checked`);
    if (entry.kind === 'unknown') {
      assert.match(entry.note, /not checked/, `${id} unknown must say "not checked"`);
    }
  }
});

test('FREE_ALLOWANCE: daily only for the providers the research note confirms', () => {
  const daily = Object.entries(FREE_ALLOWANCE).filter(([, e]) => e.kind === 'daily').map(([id]) => id).sort();
  assert.deepEqual(daily, ['cerebras', 'google', 'openrouter']);
});

// --- orderProviders -----------------------------------------------------

test('orderProviders: default order is Free, then Free daily, then the rest, input order kept inside a group', () => {
  const result = orderProviders(['a', 'b', 'c', 'd', 'e'], {
    free: { a: null, b: 'daily', c: 'free', d: 'free', e: 'daily' },
  });
  assert.deepEqual(result, ['c', 'd', 'b', 'e', 'a']);
});

test('orderProviders: the person\'s overall order beats the default groups', () => {
  const result = orderProviders(['a', 'b', 'c'], {
    free: { a: null, b: 'free', c: 'daily' },
    personOrder: ['a', 'c'],
  });
  // a and c are listed in personOrder; b is not, so it falls back to the default groups after them.
  assert.deepEqual(result, ['a', 'c', 'b']);
});

test('orderProviders: the model\'s own order beats the person\'s overall order', () => {
  const result = orderProviders(['a', 'b', 'c'], {
    free: { a: 'free', b: null, c: null },
    personOrder: ['a', 'b', 'c'],
    modelOrder: ['c', 'b'],
  });
  assert.deepEqual(result, ['c', 'b', 'a']);
});

test('orderProviders: a provider that has run out goes last', () => {
  const result = orderProviders(['a', 'b', 'c'], {
    free: { a: 'free', b: 'daily', c: null },
    out: { a: true },
  });
  assert.deepEqual(result, ['b', 'c', 'a']);
});

test('orderProviders: out also beats an explicit order, and a Set works too', () => {
  assert.deepEqual(
    orderProviders(['a', 'b'], { modelOrder: ['a', 'b'], out: { a: true } }),
    ['b', 'a'],
  );
  assert.deepEqual(
    orderProviders(['a', 'b'], { free: { b: 'free' }, out: new Set(['b']) }),
    ['a', 'b'],
  );
});

test('orderProviders: does not change its inputs and returns a new array', () => {
  const providers = ['a', 'b', 'c'];
  const free = { a: null, b: 'free', c: 'daily' };
  const personOrder = ['c'];
  const modelOrder = ['b'];
  const out = { a: true };
  const snapshot = JSON.stringify({ providers, free, personOrder, modelOrder, out });

  const result = orderProviders(providers, { free, personOrder, modelOrder, out });

  assert.notEqual(result, providers);
  assert.deepEqual(providers, ['a', 'b', 'c']);
  assert.equal(JSON.stringify({ providers, free, personOrder, modelOrder, out }), snapshot);
});

test('orderProviders: with no options returns the input order', () => {
  assert.deepEqual(orderProviders(['x', 'y', 'z']), ['x', 'y', 'z']);
  assert.deepEqual(orderProviders([]), []);
});
