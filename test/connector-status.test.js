/**
 * W3-6b: the words a connector's state is shown in (src/ui/connectorStatus.js, shared by Customize and Automation).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectorStatus, SIGN_IN_EXPIRED, KEY_REFUSED, hostOf } from '../src/ui/connectorStatus.js';

const base = { id: 'a', name: 'Notes Hub', url: 'https://notes.example.test/mcp', enabled: true, status: 'unknown', tools: [], oauth: { signedIn: false } };

test('needs sign-in is an amber word with the host the browser opens', () => {
  const s = connectorStatus({ ...base, status: 'needsSignIn' });
  assert.deepEqual([s.word, s.tone, s.detail, s.canSignIn, s.signInLabel], ['Needs sign-in', 'warn', 'Opens notes.example.test in your browser', true, 'Sign in']);
});

test('signed in is a green word with the account under it, and no Sign in', () => {
  const s = connectorStatus({ ...base, oauth: { signedIn: true, account: 'ada@example.test' } });
  assert.deepEqual([s.word, s.tone, s.detail, s.canSignIn], ['Signed in', 'ok', 'ada@example.test', false]);
});

test('a sign-in that could not be renewed says expired and offers Sign in again', () => {
  const s = connectorStatus({ ...base, status: 'needsSignIn', lastError: SIGN_IN_EXPIRED });
  assert.deepEqual([s.word, s.canSignIn, s.signInLabel], ['Sign-in expired', true, 'Sign in again']);
});

test('a refused key is an error with the reason, and never offers Sign in', () => {
  const s = connectorStatus({ ...base, status: 'error', lastError: KEY_REFUSED });
  assert.deepEqual([s.word, s.tone, s.detail, s.canSignIn], ['Key refused', 'bad', KEY_REFUSED, false]);
});

test('waiting, failed, cancelled and needing a client ID follow the sign-in the person is in the middle of', () => {
  const needs = { ...base, status: 'needsSignIn' };
  const w = connectorStatus(needs, { phase: 'waiting' });
  assert.deepEqual([w.word, w.wait, w.detail], ['Waiting for your browser', true, 'Opens notes.example.test in your browser. 5 minutes to finish.']);
  const f = connectorStatus(needs, { phase: 'error', message: 'notes.example.test refused the sign-in (invalid_grant).' });
  assert.deepEqual([f.word, f.tone, f.detail, f.canSignIn, f.signInLabel], ['Sign-in failed', 'bad', 'notes.example.test refused the sign-in (invalid_grant).', true, 'Try again']);
  assert.equal(connectorStatus(needs, { phase: 'error', message: 'The sign-in was cancelled, so nothing was connected.' }).word, 'Sign-in cancelled');
  const c = connectorStatus(needs, { phase: 'needsClientId', message: 'x' });
  assert.deepEqual([c.word, c.canSignIn], ['Needs a client ID', false]);
});

test('the plain states keep their words', () => {
  assert.equal(connectorStatus({ ...base, enabled: false }).word, 'Off');
  assert.equal(connectorStatus({ ...base, status: 'connected', tools: [1, 2] }).word, '✓ 2 tools');
  assert.equal(connectorStatus({ ...base, status: 'error', lastError: 'boom' }).word, 'Error');
  assert.equal(connectorStatus(base).word, 'Not checked');
  assert.equal(hostOf('not a url'), '');
});
