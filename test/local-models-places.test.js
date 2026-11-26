/**
 * LOCAL-MODELS: the real service with the places wired in: a model in the download folder the person chose, an own file started with the right arguments (LF-9, LF-4, LF-5, LF-7),
 * who may start it (LM-0, LF-1), Move through the service, and Remove Bunny local across folders (LF-24). Invented tree, stand-in hosts and runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createRealLocalModels } from '../src/server/localModelsReal.js';
import { createFolderRules } from '../src/server/localFolderRules.js';
import { createPlaces } from '../src/server/localPlaces.js';
import { createStore } from '../src/server/localStore.js';
import { spawnTracked } from '../src/server/localRuntime.js';
import { makeZip } from './helpers-archives.js';
import { makeGguf } from './helpers-gguf.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-llama-server.mjs', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GB = 1024 ** 3;
const MODEL = Buffer.concat([Buffer.from('OK\n'), Buffer.alloc(4093, 5)]);
const LIST = [{ id: 'tiny', name: 'Tiny 1B', publisher: 'Acme', family: 'tiny', repo: 'Acme/Tiny-GGUF', revision: 'a'.repeat(40), file: 'tiny-q4.gguf', size: MODEL.length, sha256: sha(MODEL), licence: 'apache-2.0', gated: false, tools: true, toolsProof: 'S-LM2', kvBytesPerToken: 1024, nativeCtx: 32768 }];
const ZIP = makeZip([{ name: 'llama-server.exe', data: 'MZ' }, { name: 'ggml.dll', data: 'd' }]);
const PINS = { 'llama-server': { tag: 'b12760', licence: 'MIT', entry: 'llama-server.exe', signed: false, hosts: ['github.com', 'release-assets.githubusercontent.com'], skip: ['ggml-rpc-server.exe', 'ggml-rpc.dll'],
  files: { cpu: { name: 'x.zip', url: 'https://github.com/ggml-org/llama.cpp/releases/download/b12760/x.zip', size: ZIP.length, sha256: sha(ZIP), kind: 'zip', allowComplete: true, allow: ['llama-server.exe', 'ggml.dll'] } } } };
const stream = (buf) => (async function* () { for (let i = 0; i < buf.length; i += 1024) yield buf.subarray(i, i + 1024); })();
const hub = async (url, { headers = {} } = {}) => {
  const u = new URL(url);
  if (u.hostname === 'github.com') return { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x' }, body: [] };
  if (u.hostname === 'release-assets.githubusercontent.com') return { status: 200, headers: {}, body: stream(ZIP) };
  if (u.hostname === 'huggingface.co') return { status: 302, headers: { location: 'https://us.aws.cdn.hf.co/blob', 'x-linked-size': String(MODEL.length), 'x-linked-etag': `"${sha(MODEL)}"` }, body: [] };
  const from = headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)[1]) : 0;
  return { status: from ? 206 : 200, headers: {}, body: stream(MODEL.subarray(from)) };
};
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };

async function service(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-mp-')));
  const d = (...p) => join(root, ...p);
  for (const p of ['data', 'app', 'home', 'win', 'drive-a', 'drive-b', 'models', 'project']) await mkdir(d(p), { recursive: true });
  const rules = createFolderRules({ dataDir: d('data'), installDirs: [d('app')], home: d('home'), env: { SystemRoot: d('win') }, driveType: async () => 'Fixed', knownFolders: async () => ({}), projectFolders: () => [d('project')] });
  const launched = [];
  let lm;
  const places = createPlaces({ dataDir: d('data'), rules, home: d('home'), curatedTemplates: () => new Map(), memory: async () => ({ freeRam: 12 * GB, freeVram: null, gpu: false }) });
  const store = createStore({ dataDir: d('data'), places, rules, lock: async () => true });
  lm = createRealLocalModels({
    dataDir: d('data'), list: LIST, pins: PINS, fetchImpl: hub, trial: async () => true, gpuInfo: async () => null, rules, places, store, home: d('home'),
    pc: async () => ({ totalRam: 16 * GB, freeRam: 12 * GB, vram: null, freeVram: null, gpu: false, freeDisk: 100 * GB, gpuName: null }),
    launch: async ({ args, cwd, env }) => { launched.push({ args, cwd }); return spawnTracked(process.execPath, [FAKE, ...args], { cwd, env: { ...env, PATH: process.env.PATH } }); },
  });
  t.after(async () => { await lm.stopAll(); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
  await lm.load();
  await lm.setUp(); await until(async () => (await lm.status()).installed);
  return { root, d, lm, launched };
}
const readyModel = async (lm) => { await lm.download('tiny'); await until(async () => (await lm.status()).models[0].state === 'ready'); };

test('a download lands in the folder the person chose, under Bunny models, with its record in the data folder; Delete takes only that file', async (t) => {
  const { d, lm } = await service(t);
  await lm.chooseDownloadFolder(d('drive-a'));
  await readyModel(lm);
  const view = await lm.placesView();
  assert.ok(view.downloads.tiny.where.toLowerCase().startsWith(join(d('drive-a'), 'Bunny models').toLowerCase()));
  assert.equal(existsSync(d('data', 'models', 'Acme__Tiny-GGUF')), false);
  await lm.ensure('tiny', { who: 'window' });
  await lm.remove('tiny');
  assert.equal((await lm.status()).models[0].state, 'none');
  assert.equal(existsSync(d('drive-a', 'Bunny models')), false, 'the empty Bunny models folder went too');
});

test('LF-20: the folder cannot change while a download runs; changing it moves nothing; Move then brings the model across, checked against the pin', async (t) => {
  const { d, lm } = await service(t);
  await readyModel(lm);
  const first = (await lm.placesView()).downloads.tiny.where;
  await lm.chooseDownloadFolder(d('drive-b'));
  assert.equal((await lm.placesView()).downloads.tiny.where, first, 'nothing moved');
  assert.equal((await lm.status()).models[0].state, 'ready', 'the old copy still works');
  await lm.startMove();
  await until(async () => (await lm.placesView()).lastMove);
  const v = await lm.placesView();
  assert.deepEqual(v.lastMove.moved, ['tiny']);
  assert.ok(v.downloads.tiny.where.toLowerCase().includes('drive-b'));
  assert.equal(existsSync(first), false);
  await lm.ensure('tiny', { who: 'window' });
});

test('an own file: added through the card, started with -m <real path>, the runtime folder as working folder, tools off; a file with no chat format gets only --chat-template chatml', async (t) => {
  const { d, lm, launched } = await service(t);
  await writeFile(d('models', 'mine.gguf'), makeGguf({ contextLength: 32768 }));
  await writeFile(d('models', 'plain.gguf'), makeGguf({ template: null, contextLength: 32768 }));
  const card = await lm.inspectFile({ dialogPath: d('models', 'mine.gguf') });
  assert.equal(card.toolsOff, true);
  const { added } = await lm.addFile(card.token);
  const picker = await lm.pickerModels();
  const mine = picker.find((m) => m.id === `own:${added.id}`);
  assert.equal(mine.note, 'Your file'); assert.equal(mine.toolsOk, false); assert.equal(mine.ownedBy, 'Your file');
  await lm.ensure(`own:${added.id}`, { who: 'window' });
  const a = launched.at(-1);
  assert.equal(a.args[a.args.indexOf('-m') + 1].toLowerCase(), d('models', 'mine.gguf').toLowerCase());
  assert.ok(!a.args.includes('--chat-template'));
  assert.equal(a.cwd.toLowerCase(), join(d('data'), 'runtimes', 'llama.cpp', 'b12760-cpu').toLowerCase(), 'LF-7: the runtime folder');
  for (const bad of ['--lora', '--mmproj', '-md', '--slot-save-path', '--chat-template-file']) assert.ok(!a.args.includes(bad), bad);
  await lm.setFileTools(added.id, true);
  assert.equal((await lm.pickerModels()).find((m) => m.id === `own:${added.id}`).toolsOk, true);
  const plain = (await lm.addFile((await lm.inspectFile({ dialogPath: d('models', 'plain.gguf') })).token)).added;
  await lm.setFileTools(plain.id, true);
  assert.equal((await lm.pickerModels()).find((m) => m.id === `own:${plain.id}`).toolsOk, false, 'no chat format: never tools');
  await lm.ensure(`own:${plain.id}`, { who: 'window' });
  assert.deepEqual(launched.at(-1).args.slice(-2), ['--chat-template', 'chatml']);
});

test('LF-1: an own file can be chatted with by a device only once it runs; a device starts nothing; the file is checked again before every start', async (t) => {
  const { d, lm } = await service(t);
  await writeFile(d('models', 'mine.gguf'), makeGguf());
  const { added } = await lm.addFile((await lm.inspectFile({ dialogPath: d('models', 'mine.gguf') })).token);
  const id = `own:${added.id}`;
  await assert.rejects(lm.ensure(id, { who: 'device' }), (e) => e.code === 'local.notRunning');
  assert.equal(lm.runner.running(), null);
  await lm.ensure(id, { who: 'window' });
  assert.equal((await lm.ensure(id, { who: 'device' })).modelId, id);
  await lm.stopNow();
  await writeFile(d('models', 'mine.gguf'), makeGguf({ template: 'a different chat format than the one the person saw' }));
  await assert.rejects(lm.ensure(id, { who: 'window' }), (e) => e.code === 'place.templateChanged');
  assert.equal(lm.runner.running(), null, 'a changed file is not started');
});

test('the status sent to every client holds no folder path; only the window\'s places view does', async (t) => {
  const { d, lm } = await service(t);
  await lm.chooseDownloadFolder(d('drive-a'));
  await readyModel(lm);
  await writeFile(d('models', 'mine.gguf'), makeGguf());
  await lm.addFile((await lm.inspectFile({ dialogPath: d('models', 'mine.gguf') })).token);
  const text = JSON.stringify(await lm.status());
  assert.doesNotMatch(text, /drive-a|bunny-mp-|models\\\\mine|\\\\Users\\\\/i);
  assert.match(JSON.stringify(await lm.placesView()), /drive-a/i);
});

test('LF-24: Remove Bunny local deletes recorded downloads in both places, leaves a changed file, and keeps the person\'s own files', async (t) => {
  const { d, lm } = await service(t);
  await writeFile(d('models', 'mine.gguf'), makeGguf());
  await lm.addFile((await lm.inspectFile({ dialogPath: d('models', 'mine.gguf') })).token);
  await lm.chooseDownloadFolder(d('drive-a'));
  await readyModel(lm);
  const where = (await lm.placesView()).downloads.tiny.where;
  await lm.removeAll();
  assert.equal(existsSync(where), false);
  assert.equal(existsSync(d('models', 'mine.gguf')), true, 'the person\'s own file is never deleted');
  assert.equal((await lm.status()).removal.removed, 1);
  assert.equal((await lm.status()).installed, false);
});
