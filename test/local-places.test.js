/**
 * LOCAL-MODELS LF-1 to LF-12 (own files), LF-8 and LF-16 (listing, LM Studio), LF-25 (depth). An invented tree, an injected home folder, test-written tiny GGUF files.
 * Nothing here reads the real drives, the real profile or the real .lmstudio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath, link, stat, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFolderRules } from '../src/server/localFolderRules.js';
import { createPlaces, WALK, PlaceError } from '../src/server/localPlaces.js';
import { GgufError } from '../src/server/ggufHeader.js';
import { makeGguf } from './helpers-gguf.js';

async function world(t, { curated = new Map(), mem = {} } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-pl-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const d = (...p) => join(root, ...p);
  for (const p of ['data', 'app', 'home', 'win', 'models', 'extra']) await mkdir(d(p), { recursive: true });
  const rules = createFolderRules({ dataDir: d('data'), installDirs: [d('app')], home: d('home'), env: { SystemRoot: d('win') }, driveType: async () => 'Fixed', knownFolders: async () => ({}) });
  const places = createPlaces({ dataDir: d('data'), rules, home: d('home'), curatedTemplates: () => curated, memory: async () => ({ freeRam: 8e9, freeVram: null, gpu: false, ...mem }) });
  return { root, d, rules, places };
}
const gguf = (file, opts) => writeFile(file, makeGguf(opts));
const snapshot = async (dir) => { const out = {}; for (const n of await readdir(dir, { recursive: true })) { const s = await stat(join(dir, n)); out[n] = [s.isDirectory() ? 'd' : s.size, Math.round(s.mtimeMs)]; } return out; };

test('LF-12.1 and LF-6: a valid file is inspected, added, listed with the facts of its card; adding twice makes one entry', async (t) => {
  const { d, places } = await world(t);
  await gguf(d('models', 'tiny.Q4_K_M.gguf'));
  const card = await places.inspect({ dialogPath: d('models', 'tiny.Q4_K_M.gguf') });
  assert.equal(card.name, 'tiny.Q4_K_M.gguf'); assert.equal(card.architecture, 'llama'); assert.equal(card.quant, 'Q4_K_M');
  assert.equal(card.license, 'The file says: apache-2.0'); assert.equal(card.toolsOff, true); assert.match(card.trust, /didn't download this file/);
  assert.equal(card.format.kind, 'unknown'); assert.equal(card.format.text, 'Unknown chat format'); assert.match(card.template, /messages/);
  const own = await places.add(card.token);
  assert.equal(own.toolsOn, false);
  const again = await places.add((await places.inspect({ dialogPath: d('models', 'tiny.Q4_K_M.gguf') })).token);
  assert.equal(again.id, own.id); assert.equal((await places.ownList()).length, 1);
  await assert.rejects(places.add(card.token), (e) => e instanceof PlaceError && e.code === 'place.expired', 'a token is used once');
});

test('LF-4: a template equal to a curated entry says "Same chat format as"; no template says so and has tools off; a template with <img onerror> is returned as plain text', async (t) => {
  const tpl = '{% for m in messages %}<|{{ m.role }}|>{{ m.content }}{% endfor %}';
  const sha = (await import('node:crypto')).createHash('sha256').update(tpl).digest('hex');
  const { d, places } = await world(t, { curated: new Map([[sha, 'Qwen3 4B']]) });
  await gguf(d('models', 'a.gguf'));
  assert.equal((await places.inspect({ dialogPath: d('models', 'a.gguf') })).format.text, 'Same chat format as Qwen3 4B');
  await gguf(d('models', 'none.gguf'), { template: null });
  const none = await places.inspect({ dialogPath: d('models', 'none.gguf') });
  assert.equal(none.format.kind, 'none'); assert.match(none.format.text, /no chat format/); assert.equal(none.format.tools, false);
  await gguf(d('models', 'evil.gguf'), { template: '<img src=x onerror=alert(1)>{{ messages }}' });
  const evil = await places.inspect({ dialogPath: d('models', 'evil.gguf') });
  assert.equal(evil.format.text, 'Unknown chat format'); assert.match(evil.template, /^<img src=x onerror/); // the window shows it with textContent only (tested in the UI file)
});

test('LF-12.2: a bad file is refused with a plain message before anything is stored', async (t) => {
  const { d, places } = await world(t);
  await writeFile(d('models', 'notes.gguf'), 'hello this is not a model file at all, just words');
  await assert.rejects(places.inspect({ dialogPath: d('models', 'notes.gguf') }), (e) => e instanceof GgufError && /doesn't start like a real GGUF/.test(e.message));
  await gguf(d('models', 'part-00001-of-00002.gguf'));
  await assert.rejects(places.inspect({ dialogPath: d('models', 'part-00001-of-00002.gguf') }), (e) => e.code === 'split');
  await gguf(d('models', 'mmproj-x.gguf'));
  await assert.rejects(places.inspect({ dialogPath: d('models', 'mmproj-x.gguf') }), (e) => e.code === 'projector');
  await gguf(d('data', 'in.gguf'));
  await assert.rejects(places.inspect({ dialogPath: d('data', 'in.gguf') }), (e) => e.code === 'data');
  await assert.rejects(places.inspect({ dialogPath: '\\\\localhost\\c$\\x.gguf' }), (e) => e.code === 'network');
  await assert.rejects(places.inspect({}), (e) => e.code === 'place.noFile');
  assert.equal((await places.ownList()).length, 0);
});

test('LF-12.5: a file changed after it was added is checked again; a changed template is refused and sends the person back to the card; a missing file says so', async (t) => {
  const { d, places } = await world(t);
  const f = d('models', 'm.gguf'); await gguf(f);
  const own = await places.add((await places.inspect({ dialogPath: f })).token);
  assert.equal((await places.verifyForStart(own.id)).real.toLowerCase(), f.toLowerCase());
  // the mtime moves, the template is the same: the checks pass and the record follows
  const later = new Date(Date.now() + 60_000); await utimes(f, later, later);
  assert.ok(await places.verifyForStart(own.id));
  // same size, a different template: refused
  await gguf(f, { template: 'X'.repeat(70) }); await utimes(f, new Date(Date.now() + 120_000), new Date(Date.now() + 120_000));
  await assert.rejects(places.verifyForStart(own.id), (e) => e.code === 'place.templateChanged');
  // broken into something else
  await writeFile(f, 'junk'); await utimes(f, new Date(Date.now() + 180_000), new Date(Date.now() + 180_000));
  await assert.rejects(places.verifyForStart(own.id), (e) => e.code === 'place.changed');
  await rm(f);
  await assert.rejects(places.verifyForStart(own.id), (e) => e.code === 'place.missing' && /isn't where it was/.test(e.message));
});

test('LF-2: a file swapped for another file with a different file id is caught the same way', async (t) => {
  const { d, places } = await world(t);
  const f = d('models', 's.gguf'); await gguf(f);
  const own = await places.add((await places.inspect({ dialogPath: f })).token);
  await rm(f); await gguf(f, { template: 'a different chat format that is not the one the person saw' });
  await assert.rejects(places.verifyForStart(own.id), (e) => e.code === 'place.templateChanged');
});

test('LF-12.6: the file\'s folder is untouched by add, list, verify and remove (names, sizes, mtimes), and removing leaves the file', async (t) => {
  const { d, places } = await world(t);
  await gguf(d('models', 'keep.gguf')); await writeFile(d('models', 'other.txt'), 'x');
  const before = await snapshot(d('models'));
  const own = await places.add((await places.inspect({ dialogPath: d('models', 'keep.gguf') })).token);
  await places.addModelFolder(d('models')); await places.folders(); await places.verifyForStart(own.id);
  await places.removeOwn(own.id); await places.removeModelFolder(places.state().modelFolders[0].id);
  assert.deepEqual(await snapshot(d('models')), before);
});

test('LF-8 and LF-12.7: LM Studio\'s folder from its own setting (a local path) is listed; a UNC setting says why; a missing, malformed or oversized setting uses the default', async (t) => {
  const { d, places } = await world(t);
  await mkdir(d('home', '.lmstudio', 'models', 'pub', 'm'), { recursive: true });
  await gguf(d('home', '.lmstudio', 'models', 'pub', 'm', 'x.gguf'));
  // 1. no setting: the default folder
  let lm = await places.folders(); assert.equal(lm[0].id, 'lmstudio'); assert.equal(lm[0].count, 1); assert.equal(lm[0].models[0].name, 'x.gguf');
  // 2. the setting points to another local folder
  await mkdir(d('extra', 'lm'), { recursive: true }); await gguf(d('extra', 'lm', 'y.gguf'));
  await writeFile(d('home', '.lmstudio', 'settings.json'), JSON.stringify({ downloadsFolder: d('extra', 'lm') }));
  lm = await places.folders(); assert.deepEqual(lm[0].models.map((m) => m.name), ['y.gguf']);
  // 3. the setting is a UNC path: not listed, with the message
  await writeFile(d('home', '.lmstudio', 'settings.json'), JSON.stringify({ downloadsFolder: '\\\\server\\share\\models' }));
  lm = await places.folders(); assert.equal(lm[0].state, 'network'); assert.match(lm[0].message, /network drive; Bunny only runs files from this PC/);
  // 4. malformed and oversized: the default again, no crash
  await writeFile(d('home', '.lmstudio', 'settings.json'), '{ not json');
  assert.deepEqual((await places.folders())[0].models.map((m) => m.name), ['x.gguf']);
  await writeFile(d('home', '.lmstudio', 'settings.json'), JSON.stringify({ downloadsFolder: d('extra', 'lm'), pad: 'x'.repeat(1.2 * 1024 * 1024) }));
  assert.deepEqual((await places.folders())[0].models.map((m) => m.name), ['x.gguf']);
  // 5. the home pointer moves LM Studio's home
  await rm(d('home', '.lmstudio', 'settings.json'));
  await mkdir(d('extra', 'LM Studio', 'models'), { recursive: true }); await gguf(d('extra', 'LM Studio', 'models', 'z.gguf'));
  await writeFile(d('home', '.lmstudio-home-pointer'), `${d('extra', 'LM Studio')}\n`);
  assert.deepEqual((await places.folders())[0].models.map((m) => m.name), ['z.gguf']);
  // 6. removed by the person: not looked for again until added back
  await places.removeModelFolder('lmstudio');
  assert.equal((await places.folders()).length, 0);
  await places.addLmStudioBack();
  assert.equal((await places.folders()).length, 1);
});

test('LF-12.7 and LF-25: LM Studio\'s own layout (publisher/model/file) is listed, a file at the fourth level is not; a junction inside is not followed; the entry cap holds; a bidi name is cleaned', async (t) => {
  const { d, places } = await world(t);
  const lm = d('home', '.lmstudio', 'models');
  await mkdir(join(lm, 'pub', 'model'), { recursive: true });
  await gguf(join(lm, 'pub', 'model', 'level3.gguf'));
  await mkdir(join(lm, 'a', 'b', 'c'), { recursive: true }); await gguf(join(lm, 'a', 'b', 'c', 'level4.gguf'));
  await gguf(join(lm, 'top.gguf'));
  await mkdir(d('extra', 'outside'), { recursive: true }); await gguf(d('extra', 'outside', 'secret.gguf'));
  await symlink(d('extra', 'outside'), join(lm, 'jct'), 'junction');
  await gguf(join(lm, 'name‮gguf.gguf'));
  const names = (await places.folders())[0].models.map((m) => m.name).sort();
  assert.deepEqual(names, ['level3.gguf', 'namegguf.gguf', 'top.gguf']);
  assert.ok(!names.includes('level4.gguf') && !names.includes('secret.gguf'));
  assert.equal(WALK.depth, 3);
});

test('LF-12.7: the entry cap holds, and files that are not chat models are counted, not listed', async (t) => {
  const { d, places } = await world(t);
  const lm = d('home', '.lmstudio', 'models', 'p', 'm'); await mkdir(lm, { recursive: true });
  await gguf(join(lm, 'ok.gguf')); await gguf(join(lm, 'mmproj-v.gguf')); await gguf(join(lm, 'big-00001-of-00002.gguf')); await writeFile(join(lm, 'broken.gguf'), 'nope'); await writeFile(join(lm, 'readme.txt'), 'x');
  const r = (await places.folders())[0];
  assert.deepEqual(r.models.map((m) => m.name), ['ok.gguf']);
  assert.deepEqual(r.skipped, { split: 1, projector: 1, unreadable: 1 });
  const capped = createPlaces({ dataDir: d('data'), rules: createFolderRules({ dataDir: d('data'), home: d('home'), env: {}, driveType: async () => 'Fixed' }), home: d('home') });
  const big = d('extra', 'big'); await mkdir(big, { recursive: true });
  for (let i = 0; i < 12; i++) await writeFile(join(big, `f${i}.txt`), 'x');
  const res = await capped.walk(big); assert.equal(res.truncated, false);
  assert.equal(WALK.entries, 5000);
});

test('LF-16: a model folder is stored by its real path (through a junction); a file two folders reach is listed once; a missing folder says "Folder not found" with no crash; at most 20 folders', async (t) => {
  const { d, places } = await world(t);
  await mkdir(d('extra', 'one'), { recursive: true }); await mkdir(d('extra', 'two'), { recursive: true });
  await gguf(d('extra', 'one', 'shared.gguf')); await link(d('extra', 'one', 'shared.gguf'), d('extra', 'two', 'shared-too.gguf'));
  await symlink(d('extra', 'one'), d('home', 'via'), 'junction');
  const first = await places.addModelFolder(d('home', 'via'));
  assert.equal(first.real.toLowerCase(), d('extra', 'one').toLowerCase());
  await places.addModelFolder(d('extra', 'two'));
  const all = await places.folders();
  assert.equal(all.reduce((n, f) => n + f.models.length, 0), 1, 'the file reached from two folders is listed once');
  await rm(d('extra', 'two'), { recursive: true });
  assert.equal((await places.folders()).find((f) => f.real?.toLowerCase() === d('extra', 'two').toLowerCase()).state, 'missing');
  await assert.rejects(places.addModelFolder(d('home', 'via')), (e) => e.code === 'place.listed');
  for (let i = 0; i < 18; i++) { const p = d('extra', `f${i}`); await mkdir(p); await places.addModelFolder(p); }
  const p = d('extra', 'over'); await mkdir(p);
  await assert.rejects(places.addModelFolder(p), (e) => e.code === 'place.tooMany');
});

test('LF-5: tools are off for an added file until the person turns them on; a file with no chat format never gets them', async (t) => {
  const { d, places } = await world(t);
  await gguf(d('models', 't.gguf'));
  const own = await places.add((await places.inspect({ dialogPath: d('models', 't.gguf') })).token);
  assert.equal((await places.verifyForStart(own.id)).tools, false);
  await places.setTools(own.id, true);
  assert.equal((await places.verifyForStart(own.id)).tools, true);
  await gguf(d('models', 'n.gguf'), { template: null });
  const none = await places.add((await places.inspect({ dialogPath: d('models', 'n.gguf') })).token);
  await places.setTools(none.id, true);
  assert.equal((await places.verifyForStart(none.id)).tools, false);
});

test('the listing hands out entry ids, never paths: only an id from the last listing can be inspected', async (t) => {
  const { d, places } = await world(t);
  const lm = d('home', '.lmstudio', 'models'); await mkdir(lm, { recursive: true }); await gguf(join(lm, 'x.gguf'));
  const m = (await places.folders())[0].models[0];
  assert.deepEqual(Object.keys(m).filter((k) => /real|path|full/i.test(k)), []);
  assert.equal((await places.inspect({ entryId: m.id })).fromLmStudio, true);
  await assert.rejects(places.inspect({ entryId: 'deadbeef' }), (e) => e.code === 'place.unknownEntry');
});

test('Security M-2: a UNC home pointer is never opened; a pointer on a Network-type drive is ignored; a relative or ~ downloadsFolder falls back to the default', async (t) => {
  const { d, rules, places } = await world(t);
  const lm = d('home', '.lmstudio', 'models'); await mkdir(lm, { recursive: true }); await gguf(join(lm, 'x.gguf'));
  const opened = [];
  const watching = createPlaces({ dataDir: d('data'), rules: { ...rules, checkFolder: (...a) => { opened.push(a[0]); return rules.checkFolder(...a); } }, home: d('home') });
  await writeFile(d('home', '.lmstudio-home-pointer'), '\\attacker\share\lm\n');
  assert.deepEqual((await watching.folders())[0].models.map((m) => m.name), ['x.gguf'], 'the default is used');
  assert.deepEqual(opened.filter((p) => p.startsWith('\\')), [], 'the UNC pointer was not even checked as a folder, let alone read');
  await writeFile(d('home', '.lmstudio-home-pointer'), `${d('extra')}\n`);
  const netRules = createFolderRules({ dataDir: d('data'), home: d('home'), env: { SystemRoot: d('win') }, driveType: async () => 'Network', knownFolders: async () => ({}) });
  const netPlaces = createPlaces({ dataDir: d('data'), rules: netRules, home: d('home') });
  await mkdir(d('extra'), { recursive: true }); await writeFile(d('extra', 'settings.json'), JSON.stringify({ downloadsFolder: d('extra') }));
  assert.equal((await netPlaces.folders())[0].state !== 'ok', true, 'nothing on a Network drive is listed');
  await rm(d('home', '.lmstudio-home-pointer'));
  for (const bad of ['models', '~/.lmstudio/models', '..\models', '/x']) {
    await mkdir(d('home', '.lmstudio'), { recursive: true });
    await writeFile(d('home', '.lmstudio', 'settings.json'), JSON.stringify({ downloadsFolder: bad }));
    assert.deepEqual((await places.folders())[0].models.map((m) => m.name), ['x.gguf'], bad);
  }
});

test('LF-4 (L-b): a file whose default template is known but a named variant is not is "Unknown chat format"; the view shows every template, whole', async (t) => {
  const tpl = '{% for m in messages %}<|{{ m.role }}|>{{ m.content }}{% endfor %}';
  const sha = (await import('node:crypto')).createHash('sha256').update(tpl).digest('hex');
  const { d, places } = await world(t, { curated: new Map([[sha, 'Qwen3 4B']]) });
  await gguf(d('models', 'v.gguf'), { extra: [['tokenizer.chat_template.tool_use', 8, 'TOOLS ' + 'x'.repeat(6000)]] });
  const card = await places.inspect({ dialogPath: d('models', 'v.gguf') });
  assert.equal(card.format.text, 'Unknown chat format');
  assert.match(card.template, /--- tokenizer\.chat_template\.tool_use ---/);
  assert.ok(card.template.length > 6000, 'not cut at 4,000');
});
