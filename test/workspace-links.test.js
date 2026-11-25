import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/server/workspace.js';

// S-LINK-1 (HIGH): a write must never follow a link out of the folder, into Bunny's data folder, or to nowhere. Only invented temp folders; links are made inside them.
const WRITES = [
  ['write_file', (path, extra) => ({ path, content: 'PWNED', ...extra })],
  ['make_word', (path, extra) => ({ path, blocks: [{ type: 'paragraph', text: 'PWNED' }], overwrite: true, ...extra })],
  ['make_excel', (path, extra) => ({ path, sheets: [{ name: 'S', rows: [['PWNED']] }], overwrite: true, ...extra })],
  ['make_powerpoint', (path, extra) => ({ path, slides: [{ title: 'PWNED' }], overwrite: true, ...extra })],
];
const ext = { write_file: 'txt', make_word: 'docx', make_excel: 'xlsx', make_powerpoint: 'pptx' };

function world(t) {
  const base = mkdtempSync(join(tmpdir(), 'bunny-links-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project'); const outside = join(base, 'outside'); const data = join(base, 'data');
  for (const d of [root, outside, data]) mkdirSync(d);
  writeFileSync(join(outside, 'target.txt'), 'ORIGINAL');
  writeFileSync(join(data, 'secret.txt'), 'SECRET');
  return { base, root, outside, data, ws: createWorkspace(root, { protect: [data] }) };
}
/** A file link, or null (with the reason) when this PC does not allow it without developer mode. */
function fileLink(target, at, t) {
  try { symlinkSync(target, at, 'file'); return true; } catch (err) { t.skip(`file links need developer mode or admin on this PC (${err.code})`); return false; }
}
const refused = /link|outside|secrets/i;

for (const [tool, args] of WRITES) {
  const e = ext[tool];
  test(`${tool}: a new file and an existing file inside the folder still work`, async (t) => {
    const w = world(t);
    await w.ws.run(tool, args(`new.${e}`));
    assert.ok(existsSync(join(w.root, `new.${e}`)));
    await w.ws.run(tool, args(`sub/deep.${e}`));
    assert.ok(existsSync(join(w.root, 'sub', `deep.${e}`)));
    await w.ws.run(tool, args(`new.${e}`)); // overwrite of a plain existing file
  });

  test(`${tool}: a file link to a file outside the folder is refused and the file is untouched`, async (t) => {
    const w = world(t);
    if (!fileLink(join(w.outside, 'target.txt'), join(w.root, `l.${e}`), t)) return;
    await assert.rejects(w.ws.run(tool, args(`l.${e}`)), /is a link/);
    assert.equal(readFileSync(join(w.outside, 'target.txt'), 'utf8'), 'ORIGINAL');
  });

  test(`${tool}: a link that points nowhere is refused and nothing is created at its target`, async (t) => {
    const w = world(t);
    const gone = join(w.outside, 'not-there.txt');
    if (!fileLink(gone, join(w.root, `d.${e}`), t)) return;
    await assert.rejects(w.ws.run(tool, args(`d.${e}`)), /is a link/);
    assert.equal(existsSync(gone), false);
  });

  test(`${tool}: a dangling junction is refused`, async (t) => {
    const w = world(t);
    const gone = join(w.base, 'vanishing'); mkdirSync(gone);
    symlinkSync(gone, join(w.root, `jd.${e}`), 'junction'); rmSync(gone, { recursive: true });
    await assert.rejects(w.ws.run(tool, args(`jd.${e}`)), /is a link/);
    assert.equal(existsSync(gone), false);
  });

  test(`${tool}: a link to a file in the data folder is refused and the file is untouched`, async (t) => {
    const w = world(t);
    if (!fileLink(join(w.data, 'secret.txt'), join(w.root, `s.${e}`), t)) return;
    await assert.rejects(w.ws.run(tool, args(`s.${e}`)), refused);
    assert.equal(readFileSync(join(w.data, 'secret.txt'), 'utf8'), 'SECRET');
  });

  test(`${tool}: a junction to the data folder, as the path or as a parent, is refused`, async (t) => {
    const w = world(t);
    symlinkSync(w.data, join(w.root, `dj.${e}`), 'junction');
    await assert.rejects(w.ws.run(tool, args(`dj.${e}`)), refused);
    await assert.rejects(w.ws.run(tool, args(`dj.${e}/new.${e}`)), refused);
    assert.equal(existsSync(join(w.data, `new.${e}`)), false);
  });

  test(`${tool}: a junction parent that leads outside the folder is still refused`, async (t) => {
    const w = world(t);
    symlinkSync(w.outside, join(w.root, 'jp'), 'junction');
    await assert.rejects(w.ws.run(tool, args(`jp/new.${e}`)), /outside/);
    assert.equal(existsSync(join(w.outside, `new.${e}`)), false);
  });
}
