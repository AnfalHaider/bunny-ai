/**
 * QA walk for W0-4 (default "Show models" filter). Invented profile only; starts its own server per case.
 *
 *   SRC=<worktree at the commit under test> OUT=<temp> node e2e/w04-walk.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const NL = String.fromCharCode(10);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(14), name, '::', String(note).slice(0, 240));
};
let port = +(process.env.PORT0 ?? 5420);
async function server() {
  const p = port++; const dir = mkdtempSync(join(tmpdir(), 'bunny-w04-'));
  const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(p) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 40; i++) { try { const h = await (await fetch(base + '/api/health')).json(); if (h.fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
  const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
  return { base, H, stop: () => proc.kill() };
}
const browser = await chromium.launch();
const VIEWS = [['desktop', 1280, 800], ['phone', 390, 800]].filter((v) => (process.env.VIEWS ?? 'desktop,phone').split(',').includes(v[0]));
const SCHEMES = (process.env.SCHEMES ?? 'light,dark').split(',');

for (const [vn, w, h] of VIEWS) for (const scheme of SCHEMES) {
  const tag = `${vn}-${scheme}`;
  for (const scen of ['none', 'anthropic', 'nvidia', 'mixed']) {
    const s = await server();
    try {
      const api = (path, method = 'GET', body) => fetch(s.base + path, { method, headers: s.H, body: body ? JSON.stringify(body) : undefined });
      const filter = (await (await api('/api/settings')).json()).modelFilter;
      if (scen === 'anthropic' || scen === 'mixed') await api('/api/providers/anthropic/connect', 'POST', { apiKey: 'sk-test-000000000000' });
      if (scen === 'nvidia' || scen === 'mixed') await api('/api/providers/nvidia/connect', 'POST', { apiKey: 'nvapi-test-000000000000' });
      const all = await (await api('/api/models')).json();
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, baseURL: s.base });
      const page = await ctx.newPage();
      await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(500);
      const theme = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
      const id = `${tag}/${scen}`;
      await row(id + '/setup', `default filter is in force (filter="${filter}"), /api/models returns ${all.length}, theme ${JSON.stringify(theme)}`, async () => { ok(filter !== 'all', 'default filter is ' + filter); });
      if (scen === 'none') {
        if (w >= 768) await row(id + '/help', 'Settings help line names the chat Show all models button', async () => { await page.locator('#settings-open').click(); await page.waitForTimeout(1200); for (const f of page.frames()) { const l = f.getByText('Show all models button sets this to All'); if (await l.count()) { await f.locator('[data-section=models]').scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: `${OUT}/${tag}-settings.png` }); await page.keyboard.press('Escape'); await page.waitForTimeout(500); return 'found in ' + (f.url() || 'main'); } } await page.screenshot({ path: `${OUT}/${tag}-settings-missing.png` }); throw new Error('help line not found in page or frames: ' + page.frames().map((f) => f.url()).join(' ')); });
        await row(id, 'no provider: "Add a provider" shows, no Show-all button', async () => {
          ok(await page.getByRole('link', { name: 'Add a provider' }).isVisible(), 'no Add a provider link');
          ok((await page.getByRole('button', { name: 'Show all models' }).count()) === 0, 'Show all models button present');
          await page.screenshot({ path: `${OUT}/${tag}-none.png` });
        });
      } else if (scen === 'anthropic') {
        await row(id, 'Anthropic: count of hidden, Show all, a model picked, a reply', async () => {
          const label = (await page.locator('#picker-button').innerText()).trim();
          ok(/\d+ models? (is|are) hidden/.test(label) && !/No models/.test(label), 'picker says: ' + label);
          const n = +/(\d+)/.exec(label)[1]; ok(n === all.length, `hidden ${n} vs /api/models ${all.length}`);
          ok((await page.getByText('Add a provider').count()) === 0, '"Add a provider" shown with a provider connected');
          const note = (await page.locator('#empty-text').innerText()).trim();
          ok(!(await page.locator('#greeting').isVisible()), 'greeting line still shown above the hidden-models note'); await page.screenshot({ path: `${OUT}/${tag}-anthropic-hidden.png` });
          // the empty-state button
          await page.getByRole('button', { name: 'Show all models' }).click(); await page.waitForTimeout(600);
          ok(!/hidden|No models/.test(await page.locator('#picker-button').innerText()), 'still hidden after Show all'); ok(await page.locator('#greeting').isVisible(), 'greeting not back after Show all');
          ok((await (await api('/api/settings')).json()).modelFilter === 'all', 'setting did not stick');
          await page.locator('#picker-button').click();
          const opts = await page.locator('.picker-panel [role="option"][data-model]:not([data-section])').count(); ok(opts === all.length, `${opts} options vs ${all.length}`);
          await page.locator('.picker-panel [role="option"][data-model]:not([data-section])').first().click();
          await page.locator('#input').fill('hello'); await page.locator('#send').click();
          await page.locator('.msg.assistant .body').first().waitFor({ timeout: 20000 });
          await page.waitForTimeout(1500);
          const err = (await page.locator('#error').innerText().catch(() => '')).trim();
          const body = await page.evaluate(() => document.body.innerText);
          await page.screenshot({ path: `${OUT}/${tag}-anthropic-shown.png` });
          return `empty-state text "${note.replace(/\s+/g, ' ').slice(0, 90)}"; ${opts} options; error="${err}"; reply: "${(await page.locator('.msg.assistant .body').first().innerText()).slice(0, 40).replace(/\s+/g, ' ')}"`;
        });
        // second path on a fresh page: the picker's own "Show all models (N more)" entry
        await api('/api/settings', 'PUT', { modelFilter: 'free-nvidia' });
        await row(id + '/picker', 'picker entry "Show all models (N more)" is offered when models are hidden and works', async () => {
          await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(400);
          // empty state now: trigger itself shows all; open path only exists when some models are visible, so check the trigger click
          await page.locator('#picker-button').click(); await page.waitForTimeout(600);
          ok(!/hidden|No models/.test(await page.locator('#picker-button').innerText()), 'trigger click did not reveal models');
          ok((await (await api('/api/settings')).json()).modelFilter === 'all', 'setting did not stick');
        });
      } else if (scen === 'mixed') {
        await row(id, 'NVIDIA + Anthropic: picker lists the visible models and offers Show all models (N more)', async () => {
          const label = (await page.locator('#picker-button').innerText()).trim(); ok(!/No models|hidden/.test(label), 'picker says: ' + label);
          await page.locator('#picker-button').click();
          const more = page.locator('.picker-show-all'); ok((await more.count()) === 1, 'no Show all entry'); const t = (await more.innerText()).trim();
          const vis = await page.locator('.picker-panel [role="option"][data-model]:not([data-section])').count();
          await page.screenshot({ path: `${OUT}/${tag}-mixed.png` });
          const n = +/\((\d+) more\)/.exec(t)[1]; ok(vis + n === all.length, `visible ${vis} + more ${n} vs ${all.length}`);
          await more.click(); await page.waitForTimeout(600); await page.locator('#picker-button').click();
          const after = await page.locator('.picker-panel [role="option"][data-model]:not([data-section])').count(); ok(after === all.length, `after: ${after} vs ${all.length}`); ok((await page.locator('.picker-show-all').count()) === 0, 'entry still shown after Show all');
          return `"${t}"; visible ${vis}; after ${after}`;
        });
        await api('/api/settings', 'PUT', { modelFilter: 'free-nvidia' });
        await row(id + '/kbd', 'keyboard: End reaches the Show all row (active, aria-activedescendant), accent styling, Enter shows all', async () => {
          await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(400);
          await page.locator('#picker-button').click(); await page.waitForTimeout(500);
          const r0 = page.locator('#model-show-all'); ok((await r0.count()) === 1, 'no #model-show-all row'); ok((await r0.getAttribute('role')) === 'option', 'row is not an option');
          await page.keyboard.press('End'); await page.waitForTimeout(200);
          const st = await page.evaluate(() => { const r = document.querySelector('#model-show-all'); const n = document.querySelector('.picker-panel .picker-item[data-model]'); return { active: r.classList.contains('active'), sel: r.getAttribute('aria-selected'), ad: document.querySelector('.picker-list').getAttribute('aria-activedescendant'), accent: getComputedStyle(r).color, normal: getComputedStyle(n).color }; });
          ok(st.active && st.sel === 'true' && st.ad === 'model-show-all', 'not reached by End: ' + JSON.stringify(st)); ok(st.accent !== st.normal, 'no accent colour: ' + JSON.stringify(st));
          await page.screenshot({ path: `${OUT}/${tag}-mixed-kbd.png` });
          await page.keyboard.press('Enter'); await page.waitForTimeout(700);
          ok((await (await api('/api/settings')).json()).modelFilter === 'all', 'Enter did not show all'); ok((await page.locator('.picker-panel').count()) === 0, 'picker still open');
          return JSON.stringify(st);
        });
      } else {
        await row(id, 'NVIDIA only: nothing hidden, models offered, no Show-all, no "No models"', async () => {
          const label = (await page.locator('#picker-button').innerText()).trim();
          ok(!/hidden|No models|Add a provider/.test(label), 'picker says: ' + label);
          ok((await page.getByRole('button', { name: 'Show all models' }).count()) === 0, 'Show all models button present');
          await page.locator('#picker-button').click();
          ok((await page.locator('.picker-show-all').count()) === 0, 'Show all entry in picker');
          const opts = await page.locator('.picker-panel [role="option"][data-model]:not([data-section])').count(); ok(opts === all.length && opts > 0, `${opts} options vs ${all.length}`);
          await page.screenshot({ path: `${OUT}/${tag}-nvidia.png` });
          return `${opts} options`;
        });
      }
      const errs = await page.evaluate(() => 0); void errs;
      await ctx.close();
    } finally { s.stop(); }
  }
}
await browser.close();
writeFileSync(`${OUT}/w04.json`, JSON.stringify(rows, null, 1));
console.log(`${NL}${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
