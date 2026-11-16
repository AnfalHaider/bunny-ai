/**
 * Pictures for Design (W2-7): a step Blocked by a Deny rule, and the prompt raised by an Ask rule.
 * Invented profile and folder only.   SRC=<worktree> OUT=<folder for the pngs> node e2e/w27-shots.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f97'; const PORT = +(process.env.PORT0 ?? 5561);
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const PLAN = { 'shot-rm': ['run_command', { command: 'Remove-Item notes-old.txt' }], 'shot-push': ['run_command', { command: 'git push origin main' }] };
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    const key = Object.keys(PLAN).find((k) => asked.includes(k)); const lastUser = body.messages.map((m) => m.role).lastIndexOf('user'); const done = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end((key && !done ? call(...PLAN[key]) : frame({ content: key === 'shot-rm' ? 'I could not delete notes-old.txt because your rule blocks it, so I left it alone.' : 'Understood, I did not push.' })) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const fport = fake.address().port;
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: mkdtempSync(join(tmpdir(), 'bunny-w27s-data-')), BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 40; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
if (!(await (await api('/api/health')).json()).fake) throw new Error('not an invented profile');
const prov = await (await api('/api/providers/custom', 'POST', { name: 'Scripted', baseUrl: `http://127.0.0.1:${fport}/v1` })).json(); const PID = prov.id ?? prov.provider?.id;
await api('/api/settings', 'PUT', { modelFilter: 'all' });
await api('/api/permission-rules', 'PUT', { global: [{ kind: 'command', effect: 'deny', pattern: 'Remove-Item*' }, { kind: 'command', effect: 'ask', pattern: 'git push*' }], folders: {} });
const dir = mkdtempSync(join(tmpdir(), 'bunny-w27s-')); writeFileSync(join(dir, 'notes-old.txt'), 'old notes\n'); writeFileSync(join(dir, 'README.md'), '# demo\n');

const browser = await chromium.launch(); const results = [];
for (const [vn, w, h] of [['d', 1440, 900], ['m', 390, 844]]) for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, baseURL: BASE }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
  await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'code'); }); await page.goto('/'); await page.waitForSelector('#picker-button');
  for (const [kind, text, mode] of [['blocked', 'shot-rm', 'ask'], ['asked', 'shot-push', 'auto']]) {
    const s = await (await api('/api/sessions', 'POST', { title: kind === 'blocked' ? 'Tidy the notes' : 'Publish the work', providerId: PID, model: 'scripted' })).json();
    for (const [n, v] of [['folder', dir], ['workMode', 'code'], ['permissionMode', mode]]) await api(`/api/sessions/${s.id}/setting/${n}`, 'PATCH', { value: v });
    await page.goto(`/src/ui/index.html?s=${s.id}`); await page.waitForSelector('#input'); await page.waitForTimeout(600);
    if (!(await page.locator('#picker-button').innerText()).includes('scripted')) { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
    await page.locator('#input').fill(text); await page.locator('#send').click();
    const file = `${OUT}/rules-${kind}-${scheme}-${vn}.png`;
    if (kind === 'blocked') {
      await page.locator('.tool-group, .tool-call').first().waitFor({ timeout: 15000 }); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500);
      const line = page.locator('.tool-group-line').first(); if (await line.count()) await line.click(); await page.waitForTimeout(300);
      const hdr = page.locator('.tool-group-rows .tool-call-header').first(); if (await hdr.count()) await hdr.click(); await page.waitForTimeout(400);
      const seen = (await page.locator('#messages').innerText()).includes('Blocked by your permission rule'); results.push({ file, seen });
    } else {
      await page.getByText('Asked because of your rule').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(400); results.push({ file, seen: true });
    }
    await page.screenshot({ path: file });
    if (kind === 'asked') { const no = page.getByRole('button', { name: /^(Deny|No|Don.t allow)/ }).first(); if (await no.count()) await no.click().catch(() => {}); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {}); }
  }
  await ctx.close();
}
await browser.close(); proc.kill(); fake.close();
console.log(JSON.stringify(results, null, 1)); process.exit(0);
