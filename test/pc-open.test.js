import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPcOpen } from '../electron/pc-open.js';
import { canOpen, OPEN_ALLOW } from '../src/server/pcService.js';
import { pcWorld } from './support/pc-world.mjs';

// SEARCH-PC SP-4: Open never runs a program; Open, Show in folder and Copy path are IPC calls from Bunny's window or the bar only, by ref.
const json = { 'content-type': 'application/json' };

function mocks(resolved) {
  const calls = [];
  const shell = { openPath: async (p) => { calls.push(['openPath', p]); return ''; }, showItemInFolder: (p) => { calls.push(['show', p]); } };
  const clipboard = { writeText: (p) => { calls.push(['copy', p]); } };
  const open = createPcOpen({ shell, clipboard, resolve: async () => resolved, allowedSender: (e) => e.ok === true });
  return { open, calls };
}

test('only the allow-listed kinds open; programs, scripts, links, macro files, web files get Show in folder, judged on the real path', () => {
  for (const ext of OPEN_ALLOW) assert.equal(canOpen(`C:\\a\\x${ext}`), true, ext);
  for (const ext of ['.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.msi', '.msp', '.msix', '.appx', '.scr', '.cpl', '.jar', '.reg',
    '.lnk', '.url', '.library-ms', '.search-ms', '.docm', '.xlsm', '.pptm', '.doc', '.xls', '.ppt', '.html', '.htm', '.svg', '.xml', '.mht', '']) {
    assert.equal(canOpen(`C:\\a\\x${ext}`), false, ext || '(no extension)');
  }
  assert.equal(canOpen('C:\\a\\NOTES.TXT'), true, 'the extension is judged without regard to case');
  assert.equal(canOpen('C:\\a\\x.txt.exe'), false, 'the last extension counts');
});

test('Open calls shell.openPath only for an openable result, otherwise Show in folder; Show and Copy do exactly that; no other call is ever made', async () => {
  const okTxt = mocks({ ok: true, real: 'C:\\docs\\a.txt', openable: true });
  assert.deepEqual(await okTxt.open.open({ ok: true }, 'f1-abc'), { ok: true });
  assert.deepEqual(okTxt.calls, [['openPath', 'C:\\docs\\a.txt']]);
  const exe = mocks({ ok: true, real: 'C:\\docs\\setup.exe', openable: false });
  const r = await exe.open.open({ ok: true }, 'f1-abc');
  assert.equal(r.shown, true);
  assert.deepEqual(exe.calls, [['show', 'C:\\docs\\setup.exe']], 'a program is shown in its folder, never opened');
  const both = mocks({ ok: true, real: 'C:\\docs\\a.txt', openable: true });
  await both.open.show({ ok: true }, 'f1-abc');
  await both.open.copy({ ok: true }, 'f1-abc');
  assert.deepEqual(both.calls, [['show', 'C:\\docs\\a.txt'], ['copy', 'C:\\docs\\a.txt']]);
});

test('a sender that is not Bunny\'s window or the bar is refused, and so is a ref that is not one', async () => {
  const m = mocks({ ok: true, real: 'C:\\docs\\a.txt', openable: true });
  for (const fn of [m.open.open, m.open.show, m.open.copy]) {
    assert.equal((await fn({ ok: false }, 'f1-abc')).ok, false);
    assert.equal((await fn({ ok: true }, { path: 'C:\\Windows\\notepad.exe' })).ok, false, 'an object is not a ref');
    assert.equal((await fn({ ok: true }, 'x'.repeat(200))).ok, false);
  }
  assert.deepEqual(m.calls, [], 'nothing was called');
  const gone = mocks({ ok: false, reason: 'That result is no longer available. Search again.' });
  assert.match((await gone.open.open({ ok: true }, 'f1-abc')).message, /no longer available/);
  assert.deepEqual(gone.calls, []);
});

test('the shell wiring: the preload offers open, show and copy by ref; main answers only Bunny\'s own pages and the bar, and asks the server (admin secret) for the path', async () => {
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const main = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  for (const k of ['open', 'show', 'copy']) assert.match(preload, new RegExp(`${k}: \\(ref\\) => ipcRenderer\\.invoke\\('pcsearch:${k}', ref\\)`));
  assert.match(main, /allowedSender: \(event\) => isOwn\(event\.senderFrame\?\.url \?\? ''\) \|\| Boolean\(quickAsk\?\.fromBar\?\.\(event\)\)/);
  assert.match(main, /bunnyApp\.adminFetch\('\/api\/pcsearch\/resolve'/);
  assert.doesNotMatch(main, /openExternal\(.*pcsearch|shell\.openPath\([^)]*ref/);
  assert.doesNotMatch(await readFile(new URL('../src/server/app.js', import.meta.url), 'utf8'), /pcsearch\/(open|show|copy)/, 'no server route opens anything');
});

test('the real server: an .exe and a .lnk pointing at an allowed .txt both come back as Show in folder only; a txt opens; an excluded folder added later refuses', async (t) => {
  const files = { 'Documents/setup tool.exe': 'MZ', 'Documents/shortcut tool.lnk': 'shortcut to ok tool.txt', 'Documents/ok tool.txt': 'plain text', 'Documents/private/diary tool.txt': 'diary' };
  const w = await pcWorld(t, { files, settings: { pcSearchEnabled: true, pcSearchAfter: 'show' }, calls: [['search_pc', { terms: ['tool'] }]] });
  const { events } = await w.say('find tool files');
  const results = events.find((e) => e.event === 'tool' && e.data.pcResults).data.pcResults;
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  const resolve = async (ref, admin = true) => {
    const init = { method: 'POST', headers: json, body: JSON.stringify({ ref }) };
    return admin ? (await w.app.adminFetch('/api/pcsearch/resolve', init)) : fetch(`${w.base}/api/pcsearch/resolve`, init);
  };
  assert.equal(byName['setup tool.exe'].openable, false);
  assert.equal(byName['shortcut tool.lnk'].openable, false);
  assert.equal(byName['ok tool.txt'].openable, true);
  const exe = await (await resolve(byName['setup tool.exe'].ref)).json();
  assert.deepEqual([exe.ok, exe.openable], [true, false]);
  const lnk = await (await resolve(byName['shortcut tool.lnk'].ref)).json();
  assert.deepEqual([lnk.ok, lnk.openable], [true, false]);
  assert.equal((await (await resolve(byName['ok tool.txt'].ref)).json()).openable, true);
  assert.equal((await resolve(byName['ok tool.txt'].ref, false)).status, 403, 'a page cannot ask for a path: only the main process, with the admin secret');
  assert.equal((await (await resolve('nope')).json()).ok, false);
  // the person excludes the folder afterwards: the same ref is refused (checked again at use)
  await fetch(`${w.base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ pcSearchExcluded: [`${w.dirs.home}\\Documents\\private`] }) });
  const diary = await (await resolve(byName['diary tool.txt'].ref)).json();
  assert.equal(diary.ok, false);
});
