/**
 * QA walk for lane A (search_files regex+glob, find_files, multi_edit). Invented profile and invented folder only.
 *
 *   SRC=<worktree at the commit under test> OUT=<temp> node e2e/lane-a-walk.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f91'; const PORT = +(process.env.PORT0 ?? 5461);
const NL = String.fromCharCode(10);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(5), name, '::', String(note).slice(0, 300));
};

// ---- the invented folder ----
const dir = mkdtempSync(join(tmpdir(), 'bunny-lanea-')); mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'test'));
const A0 = ['export const a = 1; // TODO1 first', 'export const b = 2; // todo3 lowercase', 'export const greet = (n) => `hi ${n}`; // TODO22 second', ''].join(NL);
writeFileSync(join(dir, 'src', 'a.js'), A0);
writeFileSync(join(dir, 'src', 'b.ts'), 'export const t = 3; // TODO9 in ts' + NL);
writeFileSync(join(dir, 'test', 'a.test.js'), 'x' + NL); writeFileSync(join(dir, 'test', 'b.test.js'), 'y' + NL); writeFileSync(join(dir, 'README.md'), '# demo' + NL);
utimesSync(join(dir, 'test', 'a.test.js'), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));

// ---- a scripted model ----
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args, i = 0) => frame({ tool_calls: [{ index: i, id: `c${i}_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const PLAN = {
  'do search': [['search_files', { query: 'TODO\\d+', regex: true, case_sensitive: true, path: 'src', include: '*.js' }]],
  'do find': [['find_files', { pattern: '**/*.test.js' }]],
  'do both': [['search_files', { query: 'TODO\\d+', regex: true, path: 'src', include: '*.js' }], ['find_files', { pattern: '**/*.test.js' }]],
  'do counts': [['search_files', { query: 'todo', output: 'counts' }]],
  'do regexbad': [['search_files', { query: '(unclosed', regex: true }]],
  'do multi': [['multi_edit', { path: 'src/a.js', edits: [{ old_text: 'TODO1 first', new_text: 'DONE1 first' }, { old_text: 'todo3 lowercase', new_text: 'done3' }, { old_text: 'hi ${n}', new_text: 'hello ${n}' }] }]],
  'do slowre': [['search_files', { query: '(a+)+$', regex: true, path: 'src' }]],
  'do slowglob': [['find_files', { pattern: '*a*a*a*a*a*a*a*a*a*a*b' }]],
  'do bigedit': [['edit_file', { path: 'src/big.txt', old_text: 'Z', new_text: 'Q'.repeat(2 * 1024 * 1024) }]],
  'do badmulti': [['multi_edit', { path: 'src/b.ts', edits: [{ old_text: 'TODO9', new_text: 'DONE9' }, { old_text: 'NOT-THERE', new_text: 'x' }] }]],
};
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    const key = Object.keys(PLAN).find((k) => asked.includes(k)); const steps = key ? PLAN[key] : [];
    // tool results since the last user message
    const lastUser = body.messages.map((m) => m.role).lastIndexOf('user'); const done = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end((done < steps.length ? call(...steps[done]) : frame({ content: 'Finished.' })) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const fport = fake.address().port;

const dataDir = mkdtempSync(join(tmpdir(), 'bunny-lanea-data-'));
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dataDir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 40; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
ok((await (await api('/api/health')).json()).fake, 'not an invented profile');
await api('/api/providers/custom', 'POST', { name: 'Scripted', baseUrl: `http://127.0.0.1:${fport}/v1` }); await api('/api/settings', 'PUT', { modelFilter: 'all' });

const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'code'); }); await page.goto('/'); await page.waitForSelector('#greeting');
await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
await page.locator('#mode-code').click(); if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click();
await page.locator('input[aria-label="Folder path"]').fill(dir); await page.getByRole('button', { name: 'Use folder' }).click();
await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: 'Auto' }).first().click();

let n = 0;
async function send(text) {
  const before = await page.locator('.msg.assistant').count();
  await page.locator('#input').fill(text); await page.locator('#send').click();
  await page.waitForFunction((b) => document.querySelectorAll('.msg.assistant').length > b, before, { timeout: 20000 });
  await page.locator('#stop').waitFor({ state: 'hidden', timeout: 20000 }); await page.waitForTimeout(500); n++;
  await page.screenshot({ path: `${OUT}/lanea-${n}-${text.replace(/\W+/g, '-')}.png` });
}
const sid = async () => (await (await api('/api/sessions')).json())[0].id;
const steps = async () => (await (await api(`/api/sessions/${await sid()}`)).json()).messages.filter((m) => m.kind === 'tool_call');
const lines = async (k = 1) => (await page.locator('#messages .tool-group-summary').allInnerTexts()).slice(-k);
const lastStep = async () => (await steps()).at(-1);

await send('do search');
await row('L1', 'regex + case switch + path + include: grouped line reads "Searched for /TODO\\d+/ in src (*.js)"', async () => {
  const l = await lines(); ok(l.length === 1 && l[0].trim() === 'Searched for /TODO\\d+/ in src (*.js)', 'lines: ' + JSON.stringify(l));
  const r = String((await lastStep()).result); ok(/TODO1/.test(r) && /TODO22/.test(r), 'missing matches: ' + r.slice(0, 200)); ok(!/TODO9/.test(r), 'b.ts leaked through include'); ok(!/todo3/.test(r), 'case switch ignored');
  return JSON.stringify(l) + ' result: ' + r.replace(/\s+/g, ' ').slice(0, 160);
});
await send('do find');
await row('L2', 'find_files: grouped line "Searched for files matching **/*.test.js", both files, newest first', async () => {
  const l = await lines(); ok(l.length === 1 && l[0].trim() === 'Searched for files matching **/*.test.js', 'lines: ' + JSON.stringify(l));
  const r = String((await lastStep()).result); const ib = r.indexOf('b.test.js'), ia = r.indexOf('a.test.js'); ok(ib >= 0 && ia >= 0, 'missing files: ' + r); ok(ib < ia, 'not newest first: ' + r.replace(/\s+/g, ' '));
  return JSON.stringify(l) + ' result: ' + r.replace(/\s+/g, ' ').slice(0, 120);
});
await send('do both');
await row('L3', 'a search and a find in one reply: two lines or a combined group, wording recorded', async () => {
  const l = await lines(2); ok(l.length >= 1, 'no group line'); return JSON.stringify(l);
});
await send('do counts');
await row('L4', 'search_files output=counts works and the step is not failed', async () => {
  const s = await lastStep(); ok(s.status === 'done', 'status ' + s.status + ' ' + String(s.result).slice(0, 120)); return String(s.result).replace(/\s+/g, ' ').slice(0, 160);
});
await send('do regexbad');
await row('L5', 'an invalid regex is a clear failed step, not a hang or crash', async () => {
  const s = await lastStep(); ok(s.status !== 'done', 'status ' + s.status); ok(/regex|expression|pattern|invalid/i.test(String(s.result)), 'unclear message: ' + s.result); return `${s.status}: ${String(s.result).slice(0, 140)}`;
});
await send('do badmulti');
await row('L6', 'multi_edit with one failing edit is all-or-nothing: file untouched, step failed, no Undo card', async () => {
  const s = await lastStep(); ok(s.status !== 'done', 'status ' + s.status); ok(/DONE9/.test(readFileSync(join(dir, 'src', 'b.ts'), 'utf8')) === false, 'file changed'); ok(readFileSync(join(dir, 'src', 'b.ts'), 'utf8').includes('TODO9'), 'file lost original');
  const bars = await page.locator('.msg.assistant').last().locator('.undo-bar button').count(); return `${s.status}: ${String(s.result).slice(0, 120)}; undo buttons ${bars}`;
});
await send('do multi');
await row('L7', 'multi_edit applies three edits at once; ONE Undo card for the reply', async () => {
  const f = readFileSync(join(dir, 'src', 'a.js'), 'utf8'); ok(f.includes('DONE1 first') && f.includes('done3') && f.includes('hello ${n}'), 'edits not applied: ' + f);
  const last = page.locator('.msg.assistant').last(); const bars = await last.locator('.undo-bar').count(); const btns = await last.locator('.undo-bar button').count(); ok(bars === 1 && btns === 1, `undo bars ${bars}, buttons ${btns}`);
  const hint = (await last.locator('.undo-bar .hint').innerText()).trim(); const s = await lastStep(); return `hint "${hint}"; step status ${s.status}; line ${JSON.stringify(await lines())}`;
});
await row('L8', 'Changes pane: one checkpoint card with one file for the multi_edit', async () => {
  await page.locator('.toolbar [data-view="diff"]').click(); await page.waitForTimeout(600);
  const cards = await page.locator('#diff-content .checkpoint-card').count(); const rows2 = await page.locator('#diff-content .checkpoint-card').first().locator('.change-row').count();
  await page.screenshot({ path: `${OUT}/lanea-changes.png` }); ok(cards === 1 && rows2 === 1, `cards ${cards}, rows ${rows2}`); return `cards ${cards}, rows ${rows2}`;
});
await row('L9', 'Undo restores the file exactly as before the multi_edit', async () => {
  const last = page.locator('.msg.assistant').last(); await last.locator('.undo-bar button').click(); await page.waitForTimeout(1200);
  const f = readFileSync(join(dir, 'src', 'a.js'), 'utf8'); ok(f === A0, 'not restored: ' + JSON.stringify(f));
  const after = (await last.locator('.undo-bar').innerText()).replace(/\s+/g, ' '); await page.screenshot({ path: `${OUT}/lanea-undone.png` }); return 'restored byte for byte; bar now: ' + after;
});
// ---- the three lane A review fixes (LA-1 glob, LA-2 regex time limit, LA-3 20 MB edit cap) ----
writeFileSync(join(dir, 'src', 'evil.txt'), 'a'.repeat(40) + '!' + NL);
writeFileSync(join(dir, 'src', 'a'.repeat(60) + '.txt'), 'x' + NL);
writeFileSync(join(dir, 'src', 'big.txt'), 'Z' + 'y'.repeat(19 * 1024 * 1024) + NL);
const timed = async (text) => { const t0 = Date.now(); await send(text); return Date.now() - t0; };
await row('X1', 'LA-2: a catastrophic regex stops with "That pattern is too slow", the app stays responsive', async () => {
  const ms = await timed('do slowre'); const s = await lastStep(); ok(s.status !== 'done' || /too slow/i.test(String(s.result)), 'status ' + s.status + ' ' + String(s.result).slice(0, 100)); ok(/too slow/i.test(String(s.result)), 'wrong message: ' + s.result); ok(ms < 8000, 'took ' + ms + ' ms');
  ok((await (await api('/api/health')).json()).ok, 'server not responding'); return `${ms} ms; ${s.status}: ${String(s.result).slice(0, 80)}`;
});
await row('X2', 'LA-1: a pathological glob returns quickly with a sensible answer', async () => {
  const ms = await timed('do slowglob'); const s = await lastStep(); ok(ms < 8000, 'took ' + ms + ' ms'); ok((await (await api('/api/health')).json()).ok, 'server not responding'); return `${ms} ms; ${s.status}: ${String(s.result).replace(/\s+/g, ' ').slice(0, 100)}`;
});
await row('X3', 'LA-3: an edit that would grow a file past 20 MB is refused, the file is untouched', async () => {
  const before = readFileSync(join(dir, 'src', 'big.txt')).length; const ms = await timed('do bigedit'); const s = await lastStep(); const after = readFileSync(join(dir, 'src', 'big.txt')).length;
  ok(s.status !== 'done', 'step ran: ' + s.status); ok(before === after, `file size changed ${before} -> ${after}`); return `${ms} ms; ${s.status}: ${String(s.result).slice(0, 120)}`;
});
await browser.close(); proc.kill(); fake.close();
writeFileSync(`${OUT}/lane-a.json`, JSON.stringify(rows, null, 1));
console.log(`${NL}${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
process.exit(0);
