import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import os from 'node:os';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startApp, post, json } from './helpers.js';
import { openZip } from '../src/server/documents.js';
import { OfficeError, buildOffice, validateOffice } from '../src/server/officeMake.js';
import { findMadeFile } from '../electron/made-file.js';

// OFFICE-MAKE, Security's required changes OM-1 to OM-6 (docs/security/2026-11-20-v0115-specs-review.md). Invented content only.

const made = (name, args, opts) => buildOffice(validateOffice(name, args, opts));
const word = (blocks, extra = {}) => ({ path: 'doc.docx', blocks, ...extra });
const BS = String.fromCharCode(92);

test('OM-1: the three libraries and the image-size override are pinned exactly (no ^ or ~), and every package in the lock file has an integrity value; the https placeholder ships no code', async () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.deepEqual([pkg.dependencies.docx, pkg.dependencies['write-excel-file'], pkg.dependencies.pptxgenjs], ['9.15.3', '4.1.1', '4.0.1']);
  assert.deepEqual(pkg.overrides, { 'image-size': '2.0.3' });
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  const missing = Object.entries(lock.packages).filter(([name, p]) => name && !p.link && !p.integrity && !p.dev).map(([name]) => name);
  assert.deepEqual(missing, [], 'every installed package has an integrity value');
  assert.equal(lock.packages['node_modules/image-size']?.version, '2.0.3');
  if (lock.packages['node_modules/https']) {
    const files = await readdir(new URL('node_modules/https/', root)).catch(() => []);
    assert.deepEqual(files.filter((f) => /\.(c|m)?js$/.test(f)), [], 'the placeholder https package has no code');
  }
});

test('OM-3: a picture is a path inside the folder: an address, a network path, a drive path, an absolute path or .. is refused before the worker starts, and the libraries receive bytes only', async () => {
  const bads = ['https://x.test/a.png', 'http://x.test/a.png', 'file:///C:/a.png', `${BS}${BS}server${BS}x.png`, `C:${BS}Windows${BS}a.png`, '/etc/a.png', `..${BS}a.png`, 'a/../../b.png', '//server/x.png', 'data:image/png;base64,AAAA'];
  for (const bad of bads) {
    assert.throws(() => validateOffice('make_word', word([{ type: 'image', path: bad }]), { code: true }), (e) => e instanceof OfficeError && /Nothing was written/.test(e.message), bad);
    assert.throws(() => validateOffice('make_powerpoint', { path: 'a.pptx', slides: [{ image: { path: bad } }] }, { code: true }), OfficeError, bad);
  }
  const src = await readFile(new URL('../src/server/officeWorker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /addImage\(\{[^}]*path:/, 'no path is ever given to pptxgenjs');
  assert.match(src, /data: `image\//); assert.match(src, /data: Buffer\.from\(bytes\)/);
});

test('OM-4: links are https: or mailto: everywhere (Word text, PowerPoint text, table cells); a javascript:, file: or data: link is plain text; an Excel sheet has no hyperlink at all', async () => {
  const bad = ['javascript:alert(1)', 'file:///C:/x', 'data:text/html,x', 'ftp://x.test', 'vbscript:x'];
  const link = (u) => `[l](${u})`;
  const w = await made('make_word', word([{ type: 'paragraph', text: [...bad, 'https://ok.test/a', 'mailto:a@example.test'].map(link).join(' ') }, { type: 'table', rows: [[link('javascript:x'), link('https://ok.test/t')]] }]));
  const wRels = openZip(w).text('word/_rels/document.xml.rels'); const wXml = openZip(w).text('word/document.xml');
  assert.deepEqual([...wRels.matchAll(/Target="([^"]+)"[^>]*TargetMode="External"/g)].map((m) => m[1]).sort(), ['https://ok.test/a', 'https://ok.test/t', 'mailto:a@example.test']);
  assert.doesNotMatch(wRels + wXml, /javascript:|file:|vbscript|ftp:|data:text/);
  const p = await made('make_powerpoint', { path: 'a.pptx', slides: [{ title: link('javascript:x'), bullets: [link('https://ok.test/b'), link('file:///C:/x')], text: link('data:text/html,x'), table: { rows: [[link('vbscript:x'), link('https://ok.test/c')]] }, notes: link('javascript:y') }] });
  const zip = openZip(p); const all = zip.names.filter((n) => /\.(xml|rels)$/.test(n)).map((n) => zip.text(n)).join('\n');
  assert.doesNotMatch(all, /javascript:|file:\/\/|vbscript|data:text|ftp:/);
  const targets = [...all.matchAll(/Target="(https?:[^"]+)"/g)].map((m) => m[1]).filter((t) => t.includes('ok.test'));
  assert.ok(targets.includes('https://ok.test/b') && targets.includes('https://ok.test/c'), targets.join(','));
  const x = await made('make_excel', { path: 'a.xlsx', sheets: [{ name: 'S', rows: [[link('https://ok.test'), 'https://ok.test', { value: link('https://ok.test') }]] }] });
  const xs = openZip(x);
  assert.ok(!xs.names.some((n) => /hyperlink/i.test(n))); assert.doesNotMatch(xs.text('xl/worksheets/sheet1.xml'), /hyperlink/i);
});

test('OM-6: no personal data in the documents: the author, last-modified-by and company are Bunny AI, and no file mentions the OS user name or the profile name', async () => {
  const me = os.userInfo().username; const profile = 'Invented Person';
  const files = [await made('make_word', word([{ type: 'paragraph', text: 'x' }], { title: 'T' })), await made('make_excel', { path: 'a.xlsx', sheets: [{ name: 'S', rows: [[1]] }] }), await made('make_powerpoint', { path: 'a.pptx', title: 'T', slides: [{ title: 'x', notes: 'n' }] })];
  for (const buf of files) {
    const zip = openZip(buf);
    for (const n of zip.names.filter((x) => /^docProps\/.+\.xml$/.test(x))) {
      const xml = zip.text(n) ?? '';
      if (me.length > 2) assert.ok(!xml.toLowerCase().includes(me.toLowerCase()), `${n} does not name the OS user`);
      assert.ok(!xml.includes(profile), n);
      for (const tag of ['dc:creator', 'cp:lastModifiedBy', 'Company', 'Manager']) for (const m of xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))) assert.ok(['Bunny AI', ''].includes(m[1]), `${n} ${tag} is ${m[1]}`);
    }
  }
  const core = openZip(files[0]).text('docProps/core.xml');
  assert.match(core, /<dc:creator>Bunny AI<\/dc:creator>/); assert.match(core, /<cp:lastModifiedBy>Bunny AI<\/cp:lastModifiedBy>/);
});

// ---------------------------------------------------------------- OM-5: the route and the desktop side

async function scripted(t, steps) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const seen = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
      const step = steps[seen];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `c${seen}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('OM-5: the file route serves only .docx, .xlsx and .pptx (never a macro format), with an RFC 5987 name; the desktop finds a file itself from two ids and refuses anything else; no server route hands a path to the page', async (t) => {
  const { base, dataDir } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await scripted(t, [{ name: 'make_word', args: word([{ type: 'paragraph', text: 'hi' }], { path: 'r.docx' }) }]) });
  const { body: session } = await post(base, '/api/sessions', { title: 'Office' });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'make it', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  await res.text();
  const m = (await json(base, `/api/sessions/${session.id}`)).body.messages.find((x) => x.madeFile).madeFile;
  const dir = join(dataDir, 'made', session.id);
  const macro = `${'c'.repeat(8)}-cccc-cccc-cccc-${'c'.repeat(12)}`;
  await writeFile(join(dir, `${macro}.docm`), 'x'); await writeFile(join(dir, `${macro}.xlsm`), 'x');
  assert.equal((await fetch(`${base}/api/sessions/${session.id}/made/${macro}`)).status, 404, 'a macro format is never served');
  const ok = await fetch(`${base}/api/sessions/${session.id}/made/${m.id}`);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-disposition'), `attachment; filename="r.docx"; filename*=UTF-8''r.docx`);
  assert.equal((await findMadeFile(dataDir, session.id, m.id)).ok, true);
  assert.equal((await findMadeFile(dataDir, session.id, macro)).ok, false, 'the desktop never opens a macro format either');
  assert.equal((await findMadeFile(dataDir, session.id, '../../x')).ok, false);
  assert.equal((await findMadeFile(dataDir, '../x', m.id)).ok, false);
  assert.equal((await fetch(`${base}/api/made/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
});
