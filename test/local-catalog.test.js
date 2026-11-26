/** LOCAL-MODELS LM-1: the "Bunny local" catalogue entry has no form, and nobody can give it an address or a key. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { findProvider, fieldsFor, KINDS } from '../src/providers/catalog.js';
import { validateInput } from '../src/providers/connections.js';

test('LM-1: bunny-local is a managed provider with no fields', () => {
  const p = findProvider('bunny-local');
  assert.equal(p.name, 'Bunny local');
  assert.equal(p.kind, 'managed');
  assert.ok(KINDS.includes('managed'));
  assert.deepEqual(fieldsFor(p), []);
  assert.deepEqual(p.abilities, ['local-offline'], 'tool-use only per model, never for the provider');
});

test('LM-1: an address or a key in the input is refused with provider.managed, whoever sends it', () => {
  const p = findProvider('bunny-local');
  for (const bad of [{ baseUrl: 'http://127.0.0.1:1234/v1' }, { baseUrl: '' }, { apiKey: 'sk-0000000000' }, { baseUrl: 'https://evil.example/v1', apiKey: 'sk-0000000000' }]) {
    assert.throws(() => validateInput(p, bad), (e) => e.code === 'provider.managed', JSON.stringify(bad));
  }
  assert.deepEqual(validateInput(p, {}), { baseUrl: '' });
});
