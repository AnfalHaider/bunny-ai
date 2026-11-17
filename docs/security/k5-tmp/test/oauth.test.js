/**
 * Signing in to a provider without typing a key.
 *
 * The device-code flow is checked against a stand-in authorisation server: the
 * app asks for a code, the person signs in, and the app gets a token.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startApp, json, post } from './helpers.js';
import { startDeviceFlow, pollForToken } from '../src/providers/oauth.js';
import { findProvider } from '../src/providers/catalog.js';

/** A stand-in for a provider's authorisation server. */
async function startAuthServer({ token = 'gho_the_token', pendingFirst = true } = {}) {
  const seen = [];
  let polls = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ url: req.url, body });
      if (req.url === '/device/code') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          device_code: 'device-123', user_code: 'WXYZ-1234',
          verification_uri: 'https://example.com/device', interval: 1, expires_in: 300,
        }));
        return;
      }
      if (req.url === '/device/token') {
        polls += 1;
        if (pendingFirst && polls === 1) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'authorization_pending' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: token, token_type: 'bearer' }));
        return;
      }
      res.writeHead(404).end('not found');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, url: `http://127.0.0.1:${server.address().port}` };
}

/** A provider that points at the stand-in server. */
function fakeProvider(url) {
  return {
    id: 'test-oauth',
    name: 'Test OAuth',
    kind: 'oauth',
    oauth: {
      clientId: 'bunny-ai',
      deviceCodeUrl: `${url}/device/code`,
      tokenUrl: `${url}/device/token`,
      verificationUri: 'https://example.com/device',
      scopes: 'read:user',
      baseUrl: `${url}/v1`,
    },
  };
}

test('the device flow gives a code the person can type', async (t) => {
  const auth = await startAuthServer();
  t.after(() => new Promise((r) => auth.server.close(r)));

  const flow = await startDeviceFlow(fakeProvider(auth.url));
  assert.equal(flow.userCode, 'WXYZ-1234');
  assert.equal(flow.verificationUri, 'https://example.com/device');
  assert.ok(flow.deviceCode);
});

test('the token arrives once the person has signed in', async (t) => {
  const auth = await startAuthServer();
  t.after(() => new Promise((r) => auth.server.close(r)));
  const provider = fakeProvider(auth.url);

  const flow = await startDeviceFlow(provider);
  const first = await pollForToken(provider, flow.deviceCode);
  assert.equal(first.done, false, 'the sign-in has not happened yet');

  const second = await pollForToken(provider, flow.deviceCode);
  assert.equal(second.done, true);
  assert.equal(second.token, 'gho_the_token');
});

test('a provider with no sign-in address says so', async () => {
  await assert.rejects(
    () => startDeviceFlow({ id: 'x', oauth: {} }),
    (err) => err.code === 'oauth.notConfigured',
  );
});

test('the sign-in routes give a code and then connect the provider', async (t) => {
  const auth = await startAuthServer();
  t.after(() => new Promise((r) => auth.server.close(r)));

  // The app is started with the stand-in authorisation server in place of the
  // real one, so the whole flow can be exercised.
  const { base } = await startApp(t, { fake: true });
  const provider = findProvider('opencode-go');
  const original = provider.oauth;
  provider.oauth = { ...original, deviceCodeUrl: `${auth.url}/device/code`, tokenUrl: `${auth.url}/device/token` };
  t.after(() => { provider.oauth = original; });

  const started = await post(base, '/api/oauth/opencode-go/start');
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.userCode, 'WXYZ-1234');
  assert.ok(started.body.verificationUri);

  const finished = await post(base, '/api/oauth/opencode-go/finish', {});
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.status, 'connected');

  // The provider is now connected and shows up in the list.
  const { body: providers } = await json(base, '/api/providers');
  const connected = providers.find((p) => p.id === 'opencode-go');
  assert.equal(connected.status, 'connected');
});

test('finishing a sign-in that was never started is refused', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/oauth/opencode-go/finish', {});
  assert.equal(status, 400);
  assert.equal(body.code, 'oauth.notStarted');
});

test('a provider that uses a key cannot start a sign-in', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/oauth/openai/start');
  assert.equal(status, 400);
  assert.equal(body.code, 'oauth.notApplicable');
});
