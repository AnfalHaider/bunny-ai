/** LOCAL-MODELS LF-2, LF-14, LF-15, LF-19, LF-22, LF-23: the folder and file rules, in an invented tree. Nothing here looks at the real drives, home or LM Studio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFolderRules, FolderError, MESSAGES } from '../src/server/folderRules.js';

async function tree(t, extra = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-fr-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const d = (...p) => join(root, ...p);
  for (const p of ['data', 'app', 'home/Docs', 'home/Downloads', 'home/Desktop', 'home/AppData/Roaming', 'home/AppData/Local', 'home/AppData/LocalLow', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'models-a', 'models-b', 'project', 'dl', 'dl2', 'moved-known']) await mkdir(d(...p.split('/')), { recursive: true });
  const env = { SystemRoot: d('Windows'), ProgramFiles: d('Program Files'), 'ProgramFiles(x86)': d('Program Files (x86)'), ProgramData: d('ProgramData'), APPDATA: d('home', 'AppData', 'Roaming'), LOCALAPPDATA: d('home', 'AppData', 'Local') };
  const types = { default: 'Fixed' };
  const rules = createFolderRules({
    dataDir: d('data'), installDirs: [d('app')], home: d('home'), env,
    driveType: async (letter) => types[letter] ?? types.default, knownFolders: async () => ({ desktop: d('moved-known', 'Desktop'), downloads: d('moved-known', 'Downloads') }),
    isProtected: (p) => p.toLowerCase().includes('protected-thing'), projectFolders: () => [d('project')], ...extra,
  });
  return { root, d, rules, types };
}
const code = (c) => (e) => e instanceof FolderError && e.code === c;

test('LF-15: every never-allowed row is refused, including a folder that contains the data folder', async (t) => {
  const { d, rules, root } = await tree(t);
  const no = async (path, c, kind = 'model') => assert.rejects(rules.checkFolder(path, { kind }), code(c), `${path}`);
  await no(d('data'), 'data');
  await no(root, 'data'); // contains the data folder
  await no(d('app'), 'install');
  await no(d('home'), 'profile');
  await no(join(d('home'), '..'), 'data'); // contains home and the data folder
  await no(d('Windows'), 'system');
  await no(d('Program Files'), 'system');
  await no(d('Program Files (x86)'), 'system');
  await no(d('ProgramData'), 'system');
  await no(d('home', 'AppData', 'Roaming'), 'system');
  await no(d('home', 'AppData', 'Local'), 'system');
  await no(d('home', 'AppData', 'LocalLow'), 'system');
  await no(d('home', 'AppData'), 'system');
  await mkdir(d('x', '.git'), { recursive: true }); await no(d('x', '.git'), 'system');
  await mkdir(d('protected-thing'), { recursive: true }); await no(d('protected-thing'), 'system');
  for (const kind of ['model', 'download']) await no(d('data', 'models'), 'data', kind).catch(() => {});
});

test('a drive root is refused', async (t) => {
  const { rules } = await tree(t);
  await assert.rejects(rules.checkFolder('C:\\'), code('root'));
});

test('LF-14: UNC, \\\\?\\ and \\\\.\\ paths are refused before anything is looked at; a Network drive type is refused too', async (t) => {
  const { d, rules, types } = await tree(t);
  for (const bad of ['\\\\localhost\\c$\\x', '\\\\?\\C:\\x', '\\\\.\\C:\\x', '\\\\server\\share']) {
    await assert.rejects(rules.checkFolder(bad), code('network'), bad);
    await assert.rejects(rules.checkFile(bad), code('network'), bad);
  }
  // a mapped drive resolves to \\server\share, or, when it does not, its drive type is Network (the drive-type check of LF-14)
  types.default = 'Network';
  await assert.rejects(rules.checkFolder(d('models-a')), (e) => code('network')(e) && e.message === MESSAGES.network);
  await writeFile(d('models-a', 'f.gguf'), 'x');
  await assert.rejects(rules.checkFile(d('models-a', 'f.gguf')), code('network'));
});

test('a real path that comes back as \\\\server\\share is refused (what a mapped drive resolves to)', async (t) => {
  const { rules } = await tree(t, { realpath: async () => '\\\\server\\share\\models', lstat: async () => ({ isSymbolicLink: () => false }) });
  await assert.rejects(rules.checkFolder('Z:\\models'), code('network'));
  await assert.rejects(rules.checkFile('Z:\\models\\a.gguf'), code('network'));
});

test('LF-14: a model folder reached through a junction stores the real path; a junction re-pointed later gives "This folder has moved"', async (t) => {
  const { d, rules } = await tree(t);
  await symlink(d('models-a'), d('home', 'Docs', 'link-a'), 'junction');
  const r = await rules.checkFolder(d('home', 'Docs', 'link-a'));
  assert.equal(r.real.toLowerCase(), d('models-a').toLowerCase());
  assert.deepEqual(await rules.stillThere({ real: r.real }), { ok: true });
  await rm(r.real, { recursive: true, force: true });
  assert.equal((await rules.stillThere({ real: r.real })).reason, 'missing');
  await mkdir(d('models-a'));
  assert.equal((await rules.stillThere({ real: r.real })).ok, true);
  // a stored folder whose real path now resolves elsewhere: moved
  const moved = createFolderRules({ dataDir: d('data'), home: d('home'), env: {}, realpath: async () => d('models-b'), driveType: async () => 'Fixed' });
  assert.equal((await moved.stillThere({ real: d('models-a') })).message, MESSAGES.moved);
});

test('LF-14: the download folder itself must not be a link or junction', async (t) => {
  const { d, rules } = await tree(t);
  await symlink(d('dl'), d('dl-link'), 'junction');
  await assert.rejects(rules.checkFolder(d('dl-link'), { kind: 'download' }), (e) => code('link')(e) && e.message === MESSAGES.link);
  assert.equal((await rules.checkFolder(d('dl'), { kind: 'download' })).real.toLowerCase(), d('dl').toLowerCase());
});

test('LF-2: a file that is itself a link is refused; a file in a junction parent is accepted with its real path; a file inside the data folder or a protected place is refused', async (t) => {
  const { d, rules } = await tree(t);
  await writeFile(d('models-a', 'm.gguf'), 'x');
  await symlink(d('models-a'), d('home', 'Docs', 'pj'), 'junction');
  const viaParent = await rules.checkFile(d('home', 'Docs', 'pj', 'm.gguf'));
  assert.equal(viaParent.real.toLowerCase(), d('models-a', 'm.gguf').toLowerCase());
  try { await symlink(d('models-a', 'm.gguf'), d('models-a', 'lnk.gguf'), 'file'); } catch { t.diagnostic('file symlinks are not allowed here: the file-link case is skipped'); }
  await rules.checkFile(d('models-a', 'lnk.gguf')).then(() => assert.fail('a link must be refused'), (e) => assert.ok(code('link')(e) || e.code === 'missing', e.code));
  await writeFile(d('data', 'in.gguf'), 'x');
  await assert.rejects(rules.checkFile(d('data', 'in.gguf')), code('data'));
  await writeFile(d('app', 'in.gguf'), 'x');
  await assert.rejects(rules.checkFile(d('app', 'in.gguf')), code('install'));
  await writeFile(d('models-a', 'protected-thing.gguf'), 'x');
  await assert.rejects(rules.checkFile(d('models-a', 'protected-thing.gguf')), code('system'));
  await assert.rejects(rules.checkFile(d('models-a', 'nope.gguf')), code('missing'));
});

test('LF-19: the download folder and the model folders may not overlap, in either direction (the default <data>/models counts as the download folder)', async (t) => {
  const { d, rules } = await tree(t);
  await mkdir(d('models-a', 'inner'), { recursive: true });
  await assert.rejects(rules.checkFolder(d('models-a', 'inner'), { kind: 'download', models: [d('models-a')] }), code('overlap'));
  await assert.rejects(rules.checkFolder(d('home', '..'), { kind: 'download', models: [d('models-a')] }).catch((e) => { throw e; }), (e) => e instanceof FolderError);
  await assert.rejects(rules.checkFolder(d('models-a'), { kind: 'model', download: d('models-a', 'inner') }), code('overlap'));
  await assert.rejects(rules.checkFolder(d('models-a', 'inner'), { kind: 'model', download: d('models-a') }), code('overlap'));
  assert.equal((await rules.checkFolder(d('models-b'), { kind: 'model', download: d('models-a') })).real.toLowerCase(), d('models-b').toLowerCase());
  assert.equal((await rules.checkFolder(d('dl'), { kind: 'download', models: [d('models-a')] })).type, 'Fixed');
});

test('LF-22: a removable drive is refused as the download folder, and allowed as a model folder', async (t) => {
  const { d, rules, types } = await tree(t);
  types.default = 'Removable';
  await assert.rejects(rules.checkFolder(d('dl'), { kind: 'download' }), (e) => code('removable')(e) && e.message === MESSAGES.removable);
  assert.equal((await rules.checkFolder(d('models-a'), { kind: 'model' })).type, 'Removable');
});

test('LF-23: the download folder may not be Downloads or Desktop (the default or a moved known folder), inside a project folder, or contain one', async (t) => {
  const { d, rules } = await tree(t);
  await mkdir(d('moved-known', 'Downloads', 'sub'), { recursive: true }); await mkdir(d('moved-known', 'Desktop'), { recursive: true });
  for (const p of [d('home', 'Downloads'), d('home', 'Desktop'), d('moved-known', 'Downloads'), d('moved-known', 'Desktop'), d('moved-known', 'Downloads', 'sub')]) await assert.rejects(rules.checkFolder(p, { kind: 'download' }), code('place'), p);
  await mkdir(d('project', 'out'), { recursive: true });
  await assert.rejects(rules.checkFolder(d('project'), { kind: 'download' }), code('place'));
  await assert.rejects(rules.checkFolder(d('project', 'out'), { kind: 'download' }), code('place'));
  await mkdir(d('wide', 'project'), { recursive: true });
  const wide = createFolderRules({ dataDir: d('data'), home: d('home'), env: {}, driveType: async () => 'Fixed', knownFolders: async () => ({}), projectFolders: () => [d('wide', 'project')] });
  await assert.rejects(wide.checkFolder(d('wide'), { kind: 'download' }), code('place')); // contains a project folder
  // Documents and ordinary folders are fine, and Downloads is fine as a MODEL folder
  assert.ok((await rules.checkFolder(d('home', 'Docs'), { kind: 'download' })).real);
  assert.ok((await rules.checkFolder(d('home', 'Downloads'), { kind: 'model' })).real);
});
