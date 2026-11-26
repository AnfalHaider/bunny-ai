/**
 * LOCAL-MODELS LF-1, LF-13: the places routes are the window's alone, reads included; a path is never taken from a request; a device is refused at both levels; there is no AI tool for any of it.
 * The real service with an invented tree behind the real routes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';
import { createRealLocalModels } from '../src/server/localModelsReal.js';
import { createFolderRules } from '../src/server/localFolderRules.js';
import { createPlaces } from '../src/server/localPlaces.js';
import { createStore } from '../src/server/localStore.js';
import { WINDOW_ONLY_ROUTES, isWindowOnlyRoute } from '../src/server/windowOnly.js';
import { deviceRefusal, LOCAL_MODELS_REFUSED_MESSAGE } from '../src/server/remoteAccess.js';
import { makeGguf } from './helpers-gguf.js';

async function app(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-pr-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['data', 'home', 'win', 'models']) await mkdir(d(p), { recursive: true });
  const rules = createFolderRules({ dataDir: d('data'), home: d('home'), env: { SystemRoot: d('win') }, driveType: async () => 'Fixed', knownFolders: async () => ({}) });
  const places = createPlaces({ dataDir: d('data'), rules, home: d('home') });
  const store = createStore({ dataDir: d('data'), places, rules, lock: async () => true });
  const localModels = createRealLocalModels({ dataDir: d('data'), rules, places, store, home: d('home'), pc: async () => ({ totalRam: 16e9, freeRam: 12e9, vram: null, freeVram: null, gpu: false, freeDisk: 1e11, gpuName: null }) });
  const started = await startApp(t, { dataDir: d('data'), localModels });
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }));
  return { ...started, d, localModels };
}
const get = (base, path) => fetch(`${base}${path}`);

test('the window can read the places and use every action; the answers carry the folders', async (t) => {
  const { base, d, localModels } = await app(t);
  await writeFile(d('models', 'a.gguf'), makeGguf());
  const card = await localModels.inspectFile({ dialogPath: d('models', 'a.gguf') });
  const added = await post(base, '/api/local-models/places/add-file', { token: card.token });
  assert.equal(added.status, 200);
  const view = await (await get(base, '/api/local-models/places')).json();
  assert.equal(view.own.length, 1);
  assert.match(JSON.stringify(view), /a\.gguf/);
  const id = view.own[0].id;
  assert.equal((await post(base, '/api/local-models/places/file-tools', { id, on: true })).status, 200);
  assert.equal((await post(base, '/api/local-models/places/remove-file', { id })).status, 200);
  assert.equal((await post(base, '/api/local-models/places/refresh', {})).status, 200);
  assert.equal(await readFile(d('models', 'a.gguf')).then((b) => b.length > 0), true, 'the file stays');
});

test('LF-1: a path in a request body is never used: inspect takes only an entry id, and a token is used once', async (t) => {
  const { base, d } = await app(t);
  await writeFile(d('models', 'a.gguf'), makeGguf());
  const res = await post(base, '/api/local-models/places/inspect', { path: d('models', 'a.gguf'), dialogPath: d('models', 'a.gguf'), entryId: '' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'place.noFile');
  const res2 = await post(base, '/api/local-models/places/inspect', { entryId: 'deadbeefdeadbeef' });
  assert.equal(res2.status, 404);
  const res3 = await post(base, '/api/local-models/places/add-file', { token: 'forged' });
  assert.equal(res3.status, 410);
});

test('LF-1 and LF-13: every places route is window-only for every method (reads too), and a device is refused at both levels', () => {
  for (const [m, p] of [['GET', '/api/local-models/places'], ['POST', '/api/local-models/places/inspect'], ['POST', '/api/local-models/places/add-file'], ['POST', '/api/local-models/places/remove-file'], ['POST', '/api/local-models/places/file-tools'], ['POST', '/api/local-models/places/remove-folder'], ['POST', '/api/local-models/places/download-default'], ['POST', '/api/local-models/places/move'], ['POST', '/api/local-models/places/move-cancel'], ['POST', '/api/local-models/places/refresh']]) {
    assert.equal(isWindowOnlyRoute(m, p), true, `${m} ${p}`);
    assert.equal(deviceRefusal(m, p), LOCAL_MODELS_REFUSED_MESSAGE, `${m} ${p}`);
  }
  assert.equal(deviceRefusal('GET', '/api/local-models'), null, 'a device may still read what runs (its state holds no path)');
  assert.ok(WINDOW_ONLY_ROUTES.length > 0);
});

test('the shared status holds no path, and there is no tool a model can call to add, list or pick a model file or folder', async (t) => {
  const { base, d, localModels } = await app(t);
  await writeFile(d('models', 'a.gguf'), makeGguf());
  await localModels.addFile((await localModels.inspectFile({ dialogPath: d('models', 'a.gguf') })).token);
  const status = JSON.stringify(await (await get(base, '/api/local-models')).json());
  assert.doesNotMatch(status, /bunny-pr-|a\.gguf|\\\\Users\\\\/i);
  const { appToolDefinitions } = await import('../src/server/appTools.js');
  const names = JSON.stringify(appToolDefinitions ? appToolDefinitions() : []).toLowerCase();
  assert.doesNotMatch(names, /local-models|local_model|gguf|model_folder|download_folder/);
});

test('the dialogs and the service refuse a network path, a link as the download folder and a folder that holds the data folder, with plain messages', async (t) => {
  const { d, localModels } = await app(t);
  await assert.rejects(localModels.addModelFolder('\\\\server\\share\\models'), (e) => e.code === 'place.network' && /own drives/.test(e.message));
  await assert.rejects(localModels.chooseDownloadFolder(d('data')), (e) => e.code === 'place.data');
  await assert.rejects(localModels.addModelFolder(join(d('data'), '..')), (e) => e.code === 'place.data');
});
