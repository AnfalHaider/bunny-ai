import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { createExclusions, FIXED_EXCLUSIONS, partsOf } from '../src/server/pcExclusions.js';

// SEARCH-PC SP-2: what Bunny may never show, search or read. An invented computer in a temp folder, with real junctions.
const windows = process.platform === 'win32';
const opts = { skip: !windows && 'Windows paths and junctions' };

function world(t) {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'bunny-pcx-')));
  t.after(() => rmSync(T, { recursive: true, force: true }));
  const mk = (...p) => { const d = join(T, ...p); mkdirSync(d, { recursive: true }); return d; };
  const home = mk('Users', 'me');
  const dirs = {
    home, docs: mk('Users', 'me', 'Documents'), ssh: mk('Users', 'me', '.ssh'), data: mk('Users', 'me', 'AppData', 'Local', 'BunnyAI'), roaming: mk('Users', 'me', 'AppData', 'Roaming'),
    local: mk('Users', 'me', 'AppData', 'Local'), programData: mk('ProgramData'), windows: mk('Windows'), pf: mk('Program Files'), pf86: mk('Program Files (x86)'),
    other: mk('Users', 'sam', 'Documents'), pub: mk('Users', 'Public', 'Documents'), proj: mk('Users', 'me', 'Documents', 'proj'),
  };
  const drive = parse(T).root.replace(/[\\/]+$/, '').toUpperCase();
  const env = { APPDATA: dirs.roaming, LOCALAPPDATA: dirs.local, ProgramData: dirs.programData, windir: dirs.windows, ProgramFiles: dirs.pf, 'ProgramFiles(x86)': dirs.pf86, SystemDrive: drive };
  const make = (extra = {}) => createExclusions({ dataDir: dirs.data, electronData: join(dirs.roaming, 'bunny-ai'), home, users: join(T, 'Users'), env, driveType: async () => 'local', ...extra });
  const file = (dir, name, text = 'hello') => { const f = join(dir, name); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); return f; };
  return { T, dirs, env, make, file, drive };
}

test('an ordinary document is allowed, and the answer is its real path', opts, async (t) => {
  const w = world(t);
  const f = w.file(w.dirs.docs, 'tax return 2025.txt');
  const r = await w.make().allowedPath(f);
  assert.equal(r.ok, true);
  assert.equal(r.real.toLowerCase(), f.toLowerCase());
});

test('every fixed folder is refused, with every subfolder', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  for (const [name, dir] of Object.entries({ data: w.dirs.data, roaming: w.dirs.roaming, local: w.dirs.local, programData: w.dirs.programData, windows: w.dirs.windows, pf: w.dirs.pf, pf86: w.dirs.pf86, other: w.dirs.other, pub: w.dirs.pub })) {
    const f = w.file(dir, join('deep', 'note.txt'));
    assert.equal((await x.allowedPath(f)).ok, false, `${name}: ${f}`);
  }
  // the recycle bin and System Volume Information sit under every drive's root: judged by name, with a stand-in that resolves nothing
  const bare = w.make({ realpath: async (p) => p });
  for (const f of ['C:\\$Recycle.Bin\\S-1-5\\a.txt', 'D:\\System Volume Information\\b.txt', 'C:\\$RECYCLE.BIN\\c.txt']) assert.equal((await bare.allowedPath(f)).ok, false, f);
});

test('folders that hold keys are refused wherever they are: .ssh .gnupg .aws .azure .kube .docker .git .config\\gh', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  for (const sub of ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.git', join('.config', 'gh')]) {
    const f = w.file(w.dirs.proj, join(sub, 'config.txt'));
    const r = await x.allowedPath(f);
    assert.equal(r.ok, false, sub);
  }
  assert.equal((await x.allowedPath(w.file(w.dirs.proj, join('.config', 'other', 'a.txt')))).ok, true, '.config alone is fine');
});

test('files that may hold a key or password are refused by name or type, wherever they are', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  for (const name of ['.env', '.env.local', '.npmrc', '.pypirc', '.netrc', '_netrc', '.git-credentials', 'credentials', 'credentials.json', 'id_rsa', 'id_rsa.pub', 'id_ed25519', 'id_ecdsa', 'id_dsa',
    'server.pem', 'tls.KEY', 'cert.pfx', 'cert.p12', 'putty.ppk', 'vault.kdbx', 'old.kdb', 'mac.keychain-db', 'office.ovpn', 'wallet.dat', 'coins.wallet']) {
    assert.equal((await x.allowedPath(w.file(w.dirs.proj, name))).ok, false, name);
  }
  assert.equal((await x.allowedPath(w.file(w.dirs.proj, 'environment.txt'))).ok, true, 'a name that only starts like one is fine');
});

test('case, trailing dots and spaces do not get around a folder', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  const f = w.file(w.dirs.data, 'chats.json');
  const upper = f.toUpperCase();
  assert.equal((await x.allowedPath(upper)).ok, false);
  assert.deepEqual(partsOf('C:\\Users\\Me.\\App Data. \\x'), ['c:', 'users', 'me', 'app data', 'x'], 'trailing dots and spaces are taken off every part');
});

test('a junction from an allowed folder into .ssh, and into the data folder, is refused: on the search result and on the read', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  const key = w.file(w.dirs.ssh, 'notes.txt', 'ordinary words');
  const chat = w.file(w.dirs.data, 'sessions.json', 'ordinary words');
  symlinkSync(w.dirs.ssh, join(w.dirs.proj, 'looks-fine'), 'junction');
  symlinkSync(w.dirs.data, join(w.dirs.proj, 'also-fine'), 'junction');
  for (const through of [join(w.dirs.proj, 'looks-fine', 'notes.txt'), join(w.dirs.proj, 'also-fine', 'sessions.json')]) {
    assert.equal((await x.allowedPath(through)).ok, false, `result: ${through}`);
    const read = await x.readAllowed(through);
    assert.equal(read.ok, false, `read: ${through}`);
  }
  void key; void chat;
});

test('network, device and stream forms are refused: UNC, \\\\?\\, \\\\.\\, a network drive, alternate data streams, relative paths', opts, async (t) => {
  const w = world(t);
  const x = w.make({ driveType: async (l) => (l === 'Z:' ? 'network' : 'local') });
  const f = w.file(w.dirs.docs, 'a.txt');
  for (const bad of ['\\\\server\\share\\a.txt', '//server/share/a.txt', '\\\\?\\' + f, '\\\\.\\' + f, 'Z:\\share\\a.txt', f + ':secret', 'a.txt', '..\\a.txt', '']) {
    assert.equal((await x.allowedPath(bad)).ok, false, JSON.stringify(bad));
  }
  const unknown = w.make({ driveType: async () => undefined });
  assert.equal((await unknown.allowedPath(f)).ok, true, 'the system drive stays allowed when its type cannot be read');
  assert.equal((await unknown.allowedPath('Q:\\a.txt')).ok, false, 'a drive whose type cannot be read is refused');
});

test('a short 8.3 name or a path that cannot be resolved cannot reach an excluded folder', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  w.file(w.dirs.pf, 'app.txt');
  assert.equal((await x.allowedPath(join(w.T, 'PROGRA~1', 'app.txt'))).ok, false);
  assert.equal((await x.allowedPath(join(w.dirs.docs, 'not-there.txt'))).ok, false);
});

test("the person's own folders are added to the fixed list, never instead of it", opts, async (t) => {
  const w = world(t);
  const secret = w.file(join(w.dirs.docs, 'private'), 'diary.txt');
  const x = w.make({ personal: [join(w.dirs.docs, 'private')] });
  assert.equal((await x.allowedPath(secret)).ok, false);
  assert.equal((await x.allowedPath(w.file(w.dirs.docs, 'public.txt'))).ok, true);
  assert.equal((await x.allowedPath(w.file(w.dirs.data, 'x.txt'))).ok, false, 'the fixed list still holds with a personal list');
  x.setPersonal([]);
  assert.equal((await x.allowedPath(secret)).ok, true, 'removing the person\'s own folder frees only it');
  assert.equal((await x.allowedPath(w.file(w.dirs.data, 'y.txt'))).ok, false);
  assert.ok(Object.isFrozen(FIXED_EXCLUSIONS) && Object.isFrozen(FIXED_EXCLUSIONS.folders), 'no setting can edit the fixed list');
});

test('the read: a path swapped between the check and the open is refused, a big file is cut at the limit, a normal file reads', opts, async (t) => {
  const w = world(t);
  const good = w.file(w.dirs.docs, 'big.txt', 'x'.repeat(5000));
  const read = await w.make().readAllowed(good, { maxBytes: 1000 });
  assert.equal(read.ok, true);
  assert.equal(read.buffer.length, 1000);
  assert.equal(read.partial, true);
  assert.equal(read.size, 5000);
  // a junction swapped in after the first look: the second look at the same path resolves somewhere else
  const evil = w.file(w.dirs.ssh, 'target.txt', 'private');
  let looks = 0;
  const swapping = createExclusions({
    dataDir: w.dirs.data, electronData: '', home: w.dirs.home, users: join(w.T, 'Users'), env: w.env, driveType: async () => 'local',
    realpath: async (p) => (String(p).toLowerCase() === good.toLowerCase() && (looks += 1) > 1 ? evil : p),
  });
  const swapped = await swapping.readAllowed(good);
  assert.equal(swapped.ok, false);
});

test('a folder the person adds is kept by its real path, and a path that is not a folder here is refused', opts, async (t) => {
  const w = world(t);
  const x = w.make();
  symlinkSync(w.dirs.proj, join(w.dirs.docs, 'link'), 'junction');
  assert.equal((await x.resolveFolder(join(w.dirs.docs, 'link'))).toLowerCase(), w.dirs.proj.toLowerCase());
  assert.equal(await x.resolveFolder('\\\\server\\share'), null);
  assert.equal(await x.resolveFolder('relative\\folder'), null);
});
