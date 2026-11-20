import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMadeFile } from '../electron/made-file.js';

// OFFICE-MAKE: the desktop side of the file card (Open, Save as…, Show in folder): own window only, ids only (never a path from a page), the person chooses where Save as… goes.

const CHAT = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12); const FILE = 'b'.repeat(8) + '-bbbb-bbbb-bbbb-' + 'b'.repeat(12);
function make({ found = { ok: true, real: 'C:/data/made/x/f.docx', name: 'Report.docx' }, allowed = true, picked = { canceled: false, filePath: 'C:/Users/me/Report.docx' }, openFails = false } = {}) {
  const calls = [];
  const m = createMadeFile({
    shell: { openPath: async (p) => { calls.push(['open', p]); return openFails ? 'failed' : ''; }, showItemInFolder: (p) => calls.push(['show', p]) },
    dialog: { showSaveDialog: async (_w, o) => { calls.push(['dialog', o.defaultPath, o.filters]); return picked; } },
    copyFile: async (a, b) => calls.push(['copy', a, b]),
    resolve: async (chat, file) => { calls.push(['resolve', chat, file]); return found; },
    allowedSender: () => allowed, windowOf: () => ({}),
  });
  return { m, calls };
}

test('Open, Show in folder and Save as use the path the SERVER found for two ids, never one from the page', async () => {
  const { m, calls } = make();
  assert.deepEqual(await m.open({}, CHAT, FILE), { ok: true });
  assert.deepEqual(await m.show({}, CHAT, FILE), { ok: true });
  assert.deepEqual(await m.save({}, CHAT, FILE), { ok: true, saved: true });
  assert.deepEqual(calls.filter((c) => c[0] !== 'resolve'), [['open', 'C:/data/made/x/f.docx'], ['show', 'C:/data/made/x/f.docx'], ['dialog', 'Report.docx', [{ name: 'DOCX', extensions: ['docx'] }]], ['copy', 'C:/data/made/x/f.docx', 'C:/Users/me/Report.docx']]);
});

test('refused: a sender that is not Bunnys window, ids that are not uuids (a path), a file the server cannot find; a cancelled Save as copies nothing; a failed Open says so', async () => {
  const bad = make({ allowed: false });
  assert.equal((await bad.m.open({}, CHAT, FILE)).ok, false); assert.deepEqual(bad.calls, []);
  const { m, calls } = make();
  for (const [c, f] of [['../../x', FILE], [CHAT, 'C:/Windows/win.ini'], [CHAT, 5], [undefined, FILE]]) assert.equal((await m.open({}, c, f)).ok, false);
  assert.deepEqual(calls, [], 'a bad id never reaches the server or the shell');
  assert.equal((await make({ found: { ok: false, reason: 'gone' } }).m.save({}, CHAT, FILE)).message, 'gone');
  const cancelled = make({ picked: { canceled: true } });
  assert.deepEqual(await cancelled.m.save({}, CHAT, FILE), { ok: true, cancelled: true }); assert.equal(cancelled.calls.some((c) => c[0] === 'copy'), false);
  assert.match((await make({ openFails: true }).m.open({}, CHAT, FILE)).message, /Save as/);
});
