/**
 * QA, W4-9: the Settings row "Wait for a first reply" in Chromium, desktop 1280 and phone 390, light and dark.
 * Invented profile only (BUNNY_DATA_DIR temp, BUNNY_FAKE_UPSTREAM=1). Screenshots go to $SHOTS or the temp folder.
 *   node e2e/w49-ui-walk.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

const free = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const TOKEN = randomBytes(16).toString('hex');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w49ui-'));
const SHOTS = process.env.SHOTS || join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
let server; let BASE;
async function start() {
  const PORT = await free();
  server = spawn(process.execPath, ['src/server/main.js'], { env: { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
  BASE = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/settings', { headers: { 'x-bunny-token': TOKEN } })).status < 500) return; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
}
await start();
const stored = async () => (await (await fetch(BASE + '/api/settings', { headers: { 'x-bunny-token': TOKEN } })).json()).firstReplyWaitSeconds;
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).slice(0, 220) : ''}`); };
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch();
async function open(w, h, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/src/ui/settings.html?embed=1&section=capabilities');
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await page.locator('#wait-select').waitFor({ state: 'attached' });
  await page.locator('#wait-row').scrollIntoViewIfNeeded();
  return { ctx, page, errors };
}
const settle = (p) => p.waitForTimeout(500);
let first = true;
for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 800]]) for (const theme of ['light', 'dark']) {
  const tag = `${name}/${theme}`;
  const { ctx, page, errors } = await open(w, h, theme);
  const sel = page.locator('#wait-select'); const box = page.locator('#wait-custom-input'); const now = page.locator('#wait-now');
  if (first) {
    check('U1', 'default: "30 seconds (default)" is selected, Custom box hidden, note says 30 and 60 for reasoning models', await sel.inputValue() === '30' && !(await box.isVisible()) && /Now: 30 seconds, or 60 for reasoning, image and video models/.test(await now.textContent()), await now.textContent());
  }
  const options = await sel.locator('option').allTextContents();
  check(`U2 ${tag}`, 'the choices are 15, 30 (default), 60, 90, 120 seconds and Custom', JSON.stringify(options) === JSON.stringify(['15 seconds', '30 seconds (default)', '60 seconds', '90 seconds', '120 seconds', 'Custom…']), JSON.stringify(options));
  await sel.selectOption('90'); await settle(page);
  check(`U3 ${tag}`, 'choosing 90 saves 90 and the note says 90 and 180', await stored() === 90 && /Now: 90 seconds, or 180/.test(await now.textContent()), `stored ${await stored()}`);
  await sel.selectOption('custom'); await settle(page);
  check(`U4 ${tag}`, 'Custom shows the number box, keeps the current 90 in it, and focuses it', await box.isVisible() && await box.inputValue() === '90' && await box.evaluate((e) => document.activeElement === e), await box.inputValue());
  for (const bad of ['9', '601', 'abc', '30.5', '', '-5', '1e3', ' ']) {
    await box.fill(bad); await settle(page);
    const note = await now.textContent();
    check(`U5 ${tag} "${bad}"`, `typing "${bad}": the note says "Use a whole number of seconds from 10 to 600. Not saved: still waiting 90 seconds." and 90 stays saved`, /Use a whole number of seconds from 10 to 600\. Not saved: still waiting 90 seconds\./.test(note) && await stored() === 90 && (await box.getAttribute('class') ?? '').includes('bad'), `stored ${await stored()}; ${note.slice(0, 60)}`);
  }
  await box.fill('9'); await settle(page);
  const colours = await page.evaluate(() => { const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); const n = document.getElementById('wait-now'); let bg = [255, 255, 255]; for (let e = n; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) { bg = parse(c); break; } } return [parse(getComputedStyle(n).color), bg]; });
  const cr = +ratio(...colours).toFixed(2);
  check(`U6 ${tag}`, 'the not-saved note is readable (contrast at least 4.5:1)', cr >= 4.5, `${cr}`);
  await page.screenshot({ path: join(SHOTS, `wait-${name}-${theme}-bad.png`) });
  await box.fill('45'); await settle(page);
  check(`U7 ${tag}`, 'typing 45 saves 45 straight away and the note says 45 and 90', await stored() === 45 && /Now: 45 seconds, or 90/.test(await now.textContent()), `stored ${await stored()}`);
  await box.fill('600'); await settle(page);
  check(`U8 ${tag}`, '600 is accepted and the note says it applies to every model', await stored() === 600 && /Now: 600 seconds for every model/.test(await now.textContent()), await now.textContent());
  await box.fill('10'); await settle(page);
  check(`U9 ${tag}`, '10 is accepted', await stored() === 10, `stored ${await stored()}`);
  await box.fill('45'); await settle(page);
  await sel.focus(); await sel.selectOption('15'); await settle(page); // a person's click moves the focus off the number box first
  check(`U10 ${tag}`, 'choosing the preset 15 hides the box and saves 15', await stored() === 15 && !(await box.isVisible()));
  // the blur fix (375d368): a preset chosen while the number box still has focus (no focus move first) must not be overwritten by the old Custom value
  await sel.selectOption('custom'); await box.fill('45'); await settle(page);
  await sel.selectOption('15'); await page.waitForTimeout(1000);
  check(`U10b ${tag}`, 'BLUR FIX: Custom 45, then the preset 15 chosen with the box still focused: 15 stays saved (not overwritten by 45), the select shows 15 and the note says 15', await stored() === 15 && (await sel.inputValue()) === '15' && /Now: 15 seconds/.test(await now.textContent()), `stored ${await stored()}; select ${await sel.inputValue()}; ${(await now.textContent()).slice(0, 40)}`);
  await sel.selectOption('custom'); await box.fill('45'); await settle(page);
  await sel.selectOption('60'); await sel.selectOption('15'); await page.waitForTimeout(800);
  check(`U10c ${tag}`, 'and presets chosen one after another after a Custom value all stick (60 then 15 gives 15)', await stored() === 15);
  await sel.selectOption('custom'); await box.fill('45'); await settle(page);
  await page.reload(); await page.locator('#wait-select').waitFor({ state: 'attached' });
  check(`U11 ${tag}`, 'after a reload the Custom choice and the 45 come back', await page.locator('#wait-select').inputValue() === 'custom' && await page.locator('#wait-custom-input').inputValue() === '45', `${await page.locator('#wait-select').inputValue()} ${await page.locator('#wait-custom-input').inputValue()}`);
  await page.locator('#wait-select').selectOption('30'); await settle(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(`U12 ${tag}`, 'no sideways scroll', overflow);
  await page.screenshot({ path: join(SHOTS, `wait-${name}-${theme}.png`) });
  check(`U13 ${tag}`, 'no page error', errors.length === 0, errors.join(' | '));
  first = false;
  await ctx.close();
}
// the fallback switch dims the row and says so
{
  const { ctx, page } = await open(1280, 800, 'light');
  const fb = page.locator('[data-cap="fallbackWhenBusy"]');
  const was = await fb.isChecked();
  await fb.evaluate((e) => e.click()); await settle(page);
  const dimmed = await page.locator('#wait-row').evaluate((e) => e.style.opacity);
  const note = await page.locator('#wait-off-note').isVisible();
  check('U14', 'switching "try another model when busy" off dims the row and shows the note that the wait is used only with it on', was ? (dimmed === '0.55' && note) : (dimmed === '' && !note), `was ${was}, dimmed ${dimmed}, note ${note}`);
  await fb.evaluate((e) => e.click());
  await ctx.close();
}
// restart: the saved value is read again
{
  const before = await stored(); server.kill(); await new Promise((r) => setTimeout(r, 1500)); await start();
  const after = await stored();
  check('U15', 'after a restart of the app the saved wait is what it was before the restart', before === after, `before ${before}, after ${after}`);
}
await browser.close(); server.kill();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
