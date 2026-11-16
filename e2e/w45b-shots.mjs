/**
 * Pictures for Design (W4-5b): the step state (a "Thought for Ns" row above a live line that names a step) and the grumpy slow state.
 * Invented profile and folder only.   SRC=<worktree> OUT=<folder for the pngs> node e2e/w45b-shots.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fa3'; const PORT = +(process.env.PORT0 ?? 5971); const NL = String.fromCharCode(10);
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const toolFrame = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random().toString(36).slice(2)}`, function: { name, arguments: JSON.stringify(args) } }] });
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const lastUser = body.messages.map((m) => m.role).lastIndexOf('user');
    const asked = String(body.messages[lastUser]?.content ?? ''); const afterTool = body.messages.slice(lastUser).some((m) => m.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const at = (ms, fn) => setTimeout(() => { if (!res.writableEnded) fn(); }, ms); const end = () => { res.write('data: [DONE]' + NL + NL); res.end(); };
    if (/slowone/.test(asked)) { at(28_000, () => { res.write(frame({ content: 'Sorry for the wait. Here is the answer.' })); end(); }); return; }
    if (!afterTool) {
      res.write(frame({ reasoning_content: 'The README says what this is, so I will read it first. ' }));
      at(900, () => res.write(frame({ reasoning_content: 'Then I can tidy the notes.' })));
      at(1800, () => { res.write(toolFrame('run_command', { command: 'Start-Sleep -Seconds 14' })); end(); });
      return;
    }
    // the step result came back: a second thought that stays open so the picture can be taken
    res.write(frame({ reasoning_content: 'Now I have the README. ' }));
    at(60_000, end);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const FPORT = fake.address().port;
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: mkdtempSync(join(tmpdir(), 'bunny-w45s-data-')), BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
let browser; const results = [];
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } fake.closeAllConnections?.(); fake.close(); process.exit(code); };
const readLine = (page) => page.evaluate(() => ({
  word: document.querySelector('.bunny-working .bunny-word')?.textContent ?? '', tail: document.querySelector('.bunny-working .bunny-tail')?.textContent ?? '',
  time: document.querySelector('.bunny-working .bunny-time')?.textContent ?? '', slow: !!document.querySelector('.bunny-working.is-slow'),
  thought: [...document.querySelectorAll('details.thinking summary')].map((x) => x.textContent.trim()), steps: document.querySelectorAll('.tool-group, .tool-call').length,
}));
try {
  if (!(await (await api('/api/health')).json()).fake) throw new Error('not an invented profile');
  const prov = await (await api('/api/providers/custom', 'POST', { name: 'Thinker', baseUrl: `http://127.0.0.1:${FPORT}/v1` })).json(); const PID = prov.id ?? prov.provider?.id;
  await api('/api/settings', 'PUT', { modelFilter: 'all', transcriptView: 'normal' });
  const work = mkdtempSync(join(tmpdir(), 'bunny-w45s-')); writeFileSync(join(work, 'README.md'), '# demo' + NL);
  browser = await chromium.launch();
  for (const [vn, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) for (const scheme of ['light', 'dark']) for (const kind of (process.env.KINDS ?? 'step,slow').split(',')) {
    const s = await (await api('/api/sessions', 'POST', { title: kind === 'step' ? 'Tidy the notes' : 'A slow model', providerId: PID, model: 'offline/bunny-code' })).json();
    if (kind === 'step') for (const [n, v] of [['folder', work], ['workMode', 'code'], ['permissionMode', 'auto']]) await api(`/api/sessions/${s.id}/setting/${n}`, 'PATCH', { value: v });
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, baseURL: BASE }); const page = await ctx.newPage();
    await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); }); await page.goto(`/src/ui/index.html?s=${s.id}`); await page.waitForSelector('#input'); await page.waitForTimeout(700);
    if (!(await page.locator('#picker-button').innerText()).includes('bunny-code')) { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
    await page.locator('#input').fill(kind === 'step' ? 'tidy the notes' : 'slowone please'); await page.locator('#send').click();
    const file = join(OUT, `${kind}-${scheme}-${vn}.png`); let line = null;
    if (kind === 'step') {
      for (let i = 0; i < 80; i++) { await page.waitForTimeout(150); line = await readLine(page); if (line.thought.length && line.steps && line.word && line.tail === '') break; }
      await page.waitForTimeout(3000); line = await readLine(page);
    } else {
      for (let i = 0; i < 70; i++) { await page.waitForTimeout(500); if (await page.locator('.bunny-working.is-slow').count()) break; }
      await page.waitForTimeout(1500); line = await readLine(page);
    }
    await page.screenshot({ path: file }); results.push({ file: file.split(/[\\/]/).pop(), line }); await ctx.close();
  }
  console.log(JSON.stringify(results, null, 1)); await finish(0);
} catch (e) { console.log('HARNESS ERROR', e.stack); await finish(1); }
