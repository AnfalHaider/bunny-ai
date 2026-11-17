import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/server/workspace.js';

// S-3 (Security baseline 0.1.4): the agent's tools refuse Bunny's own secrets folder and account file: read, write, list, search and shell, by real path (junctions and symlinks too),
// even when the chat's folder is a parent of the data folder.
const PROTECTED = /where Bunny keeps its own secrets/;
function setup(t) {
  const data = realpathSync(mkdtempSync(join(tmpdir(), 'bunny-s3-')));
  t.after(() => rmSync(data, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }));
  mkdirSync(join(data, 'secrets'), { recursive: true });
  mkdirSync(join(data, 'project'), { recursive: true });
  writeFileSync(join(data, 'secrets', `${'ab'.repeat(16)}.secret`), '{"cipher":"TOPSECRET"}');
  writeFileSync(join(data, 'account.json'), '{"token":"TOPSECRET"}');
  writeFileSync(join(data, 'project', 'readme.txt'), 'plain TOPSECRET-FREE file\n');
  const protect = [join(data, 'secrets'), join(data, 'account.json')];
  return { data, protect, mine: (root) => createWorkspace(root, { protect }), plain: (root) => createWorkspace(root) };
}

test('S-3: with the chat\'s folder set to the data folder itself, reading, writing, listing and searching the secrets are refused; the rest of the folder still works', async (t) => {
  const { data, mine } = setup(t);
  const ws = mine(data);
  for (const [tool, args] of [
    ['read_file', { path: 'secrets/' + 'ab'.repeat(16) + '.secret' }], ['read_file', { path: 'account.json' }], ['read_file', { path: 'SECRETS\\' + 'ab'.repeat(16) + '.secret' }],
    ['write_file', { path: 'secrets/new.secret', content: 'x' }], ['write_file', { path: 'account.json', content: '{}' }], ['edit_file', { path: 'account.json', old_text: 'a', new_text: 'b' }],
    ['list_files', { path: 'secrets' }],
  ]) {
    await assert.rejects(ws.run(tool, args), PROTECTED, `${tool} ${JSON.stringify(args).slice(0, 60)}`);
  }
  // a walk from the folder never enters them or shows them
  const listing = await ws.run('list_files', { path: '.', depth: 3 });
  assert.doesNotMatch(listing, /secrets|account\.json|\.secret/);
  const found = await ws.run('search_files', { query: 'TOPSECRET' });
  assert.doesNotMatch(found, /\.secret|account\.json/);
  assert.match(found, /readme\.txt|No matches/);
  assert.match(await ws.run('read_file', { path: 'project/readme.txt' }), /plain/);
});

test('S-3: a junction or symlink inside the project that leads to the secrets is no way in', async (t) => {
  const { data, mine } = setup(t);
  const link = join(data, 'project', 'linked');
  try { symlinkSync(join(data, 'secrets'), link, 'junction'); } catch (err) { t.skip(`cannot make a junction here: ${err.code}`); return; }
  const ws = mine(join(data, 'project'));
  await assert.rejects(ws.run('read_file', { path: 'linked/' + 'ab'.repeat(16) + '.secret' }), /./);
  await assert.rejects(ws.run('list_files', { path: 'linked' }), /./);
  // and when the junction's target is inside a workspace that covers it, the real path still decides
  const wide = mine(data);
  await assert.rejects(wide.run('read_file', { path: 'project/linked/' + 'ab'.repeat(16) + '.secret' }), PROTECTED);
});

test('S-3: a shell command that names the secrets folder or the account file is refused, in any spelling', async (t) => {
  const { data, mine } = setup(t);
  const ws = mine(join(data, 'project'));
  const fwd = data.split('\\').join('/');
  for (const command of [
    `Get-Content "${data}\\secrets\\x.secret"`, `Get-Content '${fwd}/secrets/x.secret'`, `type ${fwd}/account.json`, `Get-ChildItem ${data}\\secrets`, `cat ${fwd.toUpperCase()}/SECRETS/a`,
    'Get-Content "$env:LOCALAPPDATA\\BunnyAI\\secrets\\k.secret"', 'cat ~/AppData/Local/BunnyAI/account.json', 'copy *.secret C:\\temp',
  ]) {
    await assert.rejects(ws.run('run_command', { command }), PROTECTED, command);
  }
  // an ordinary command is not touched
  if (process.platform === 'win32') assert.match(String(await ws.run('run_command', { command: 'Write-Output hello-from-the-project' })), /hello-from-the-project/);
});

test('S-3: a workspace made without protected paths behaves as before (nothing else changed)', async (t) => {
  const { data, plain } = setup(t);
  assert.match(await plain(data).run('read_file', { path: 'project/readme.txt' }), /plain/);
});
