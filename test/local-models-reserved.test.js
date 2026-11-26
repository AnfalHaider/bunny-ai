/**
 * LOCAL-MODELS LM-17 (Security R2-2): nothing a model, a page or a device names may reach the model runtime's port, on any loopback spelling,
 * decided after the name is resolved. Also LM-13: the local-models routes are the window's alone, and a device is refused at both levels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isReservedAddress, isReservedAddressResolved, registerRuntimePort, unregisterRuntimePort, runtimePorts } from '../src/server/ownAddress.js';
import { requestAllowed, loadable } from '../electron/browserViews.js';
import { fetchLimited } from '../src/server/download.js';

const PORT = 51789;
test.beforeEach(() => { runtimePorts.clear(); registerRuntimePort(PORT); });
test.afterEach(() => { unregisterRuntimePort(PORT); });

const SPELLINGS = ['127.0.0.1', '127.0.0.2', '0.0.0.0', 'localhost', 'localhost.', '[::1]', '[::ffff:127.0.0.1]', '127.1.2.3', 'app.localhost'];

test('LM-17: the runtime port is refused on every loopback spelling, and only at that port', () => {
  for (const host of SPELLINGS) {
    assert.equal(isReservedAddress(`http://${host}:${PORT}/v1/models`), true, host);
    assert.equal(isReservedAddress(`http://${host}:${PORT + 1}/`), false, `${host} at another port is somebody else's server`);
  }
  assert.equal(isReservedAddress(`http://example.com:${PORT}/`), false);
  unregisterRuntimePort(PORT);
  assert.equal(isReservedAddress(`http://127.0.0.1:${PORT}/`), false, 'a stopped runtime has no port to protect');
});

test('LM-17: a name that resolves to loopback is refused at the runtime port, decided after resolution', async () => {
  const loopback = async () => [{ address: '127.0.0.1', family: 4 }];
  const publicName = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.equal(await isReservedAddressResolved(`http://rebind.example:${PORT}/`, loopback), true);
  assert.equal(await isReservedAddressResolved(`http://rebind.example:${PORT + 1}/`, loopback), false);
  assert.equal(await isReservedAddressResolved(`http://fine.example:${PORT}/`, publicName), false);
  assert.equal(await isReservedAddressResolved(`http://127.0.0.2:${PORT}/`, publicName), true);
  assert.equal(await isReservedAddressResolved(`http://0.0.0.0:${PORT}/`, publicName), true);
});

test('LM-17: the browser panel and browser_open refuse the runtime port on every spelling; every redirect is judged the same', () => {
  for (const host of SPELLINGS) {
    const url = `http://${host}:${PORT}/`;
    assert.equal(loadable(url, '45678'), false, `browser_open ${host}`);
    for (const resourceType of ['mainFrame', 'subFrame', 'script', 'xhr', 'image']) assert.equal(requestAllowed({ url, resourceType }, '45678'), false, `${host} ${resourceType}`);
  }
  assert.equal(loadable('http://localhost:3000/', '45678'), true, 'a dev server on another port is fine');
});

test('LM-17: read_url and download_file (fetchLimited) refuse the runtime port, first address and redirect', async () => {
  for (const host of ['127.0.0.1', '127.0.0.2', '0.0.0.0', 'localhost.', '[::1]', '[::ffff:127.0.0.1]']) {
    await assert.rejects(fetchLimited(`http://${host}:${PORT}/`, { allowLoopback: true }), /own server/i, host); // even a caller that allows loopback (a test, a dev server) never reaches the runtime
  }
});

import { isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { deviceRefusal, LOCAL_MODELS_REFUSED_MESSAGE } from '../src/server/remoteAccess.js';

test('LM-13: every write on /api/local-models is the window\'s alone and refused for a device; reading the status is not', () => {
  for (const [method, path] of [['POST', '/api/local-models/runtime'], ['POST', '/api/local-models/download'], ['DELETE', '/api/local-models/qwen3-4b'], ['PUT', '/api/local-models/settings'], ['POST', '/api/local-models/stop'], ['POST', '/api/local-models/start'], ['DELETE', '/api/local-models']]) {
    assert.equal(isWindowOnlyRoute(method, path), true, `${method} ${path} is window only`);
    assert.equal(deviceRefusal(method, path), LOCAL_MODELS_REFUSED_MESSAGE, `${method} ${path} is refused for a device`);
  }
  assert.equal(isWindowOnlyRoute('GET', '/api/local-models'), false);
  assert.equal(deviceRefusal('GET', '/api/local-models'), null, 'a device may read what is running');
});
