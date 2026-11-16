import { spawn, execFileSync } from 'node:child_process'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { chromium } from 'playwright';
const T = 'a1b2c3d4e5f60718293a4b5c6d7e8fa2', P = 5921;
const proc = spawn('node', ['src/server/main.js'], { cwd: process.env.SRC, env: { ...process.env, BUNNY_DATA_DIR: mkdtempSync(join(tmpdir(), 'bunny-w45p-')), BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: T, PORT: String(P) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 390, height: 800 }, baseURL: `http://127.0.0.1:${P}` })).newPage();
await page.goto('/'); await page.waitForTimeout(800);
for (const name of ['deepseek/deepseek-r1-distill-llama-70b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'accounts/fireworks/models/llama-v3p1-405b-instruct', 'nvidia/llama-3.3-nemotron-super-49b-v1']) {
  const r = await page.evaluate(async (model) => { const { createWorking } = await import('/src/ui/bunny-working.js'); const w = createWorking('waiting', { model }); document.body.append(w.el); w.set('slow'); await new Promise((r) => setTimeout(r, 400)); const l = w.el.querySelector('.bunny-line').getBoundingClientRect(); const t = w.el.querySelector('.bunny-time').getBoundingClientRect(); const o = { len: model.length, h: Math.round(l.height), lineRight: Math.round(l.right), timeRight: Math.round(t.right), docWide: document.documentElement.scrollWidth, tail: getComputedStyle(w.el.querySelector('.bunny-tail')).textOverflow }; w.stop(); w.el.remove(); return o; }, name);
  console.log(name.padEnd(54), JSON.stringify(r));
}
await b.close(); try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} process.exit(0);
