/**
 * QA, W4-13 slice 2: the model picker (one row per model, every provider a tag, Free / Free daily, Filters, "N of M models").
 * Invented profile only: BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1. /api/models is answered with invented models by the walk
 * (the page route), and the real /api/models of the invented server is checked for the freeKind field.
 *   node e2e/w413-walk.mjs      (needs playwright from node_modules; screenshots go to $SHOTS or the temp folder, never the repo)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

const free = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = await free(); const TOKEN = randomBytes(16).toString('hex');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w413-'));
const SHOTS = process.env.SHOTS || join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, ['src/server/main.js'], { env: { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/settings', { headers: { 'x-bunny-token': TOKEN } })).status < 500) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + detail : ''}`); };

const row = (providerId, providerName, id, displayName, freeKind, extra = {}) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength: 128000, ...extra });
const MODELS = [
  row('harbor', 'Harbor', 'falcon-flash', 'Falcon Flash', 'free', { contextLength: 1000000 }),
  row('meadow', 'Meadow', 'falcon-flash', 'Falcon Flash', 'daily', { contextLength: 1000000 }),
  row('quill', 'Quill', 'falcon-flash', 'Falcon Flash', null, { contextLength: 1000000 }),
  row('harbor', 'Harbor', 'otter-3-coder', 'Otter 3 Coder', 'daily'),
  row('meadow', 'Meadow', 'otter-3-coder', 'Otter 3 Coder', 'daily'),
  row('harbor', 'Harbor', 'willow-7b', 'Willow 7B', 'free'),
  row('quill', 'Quill', 'willow-7b', 'Willow 7B', null),
  row('harbor', 'Harbor', 'birch-large', 'Birch Large', null),
  row('meadow', 'Meadow', 'birch-large', 'Birch Large', null),
  row('meadow', 'Meadow', 'reef-image', 'Reef Image', 'daily', { contextLength: 0 }),
  // a model whose cheapest provider cannot be used by this account, and one with a very long name on five providers
  row('harbor', 'Harbor', 'sable-9', 'Sable 9', 'free', { unavailable: 'this account cannot use it' }),
  row('quill', 'Quill', 'sable-9', 'Sable 9', null),
  ...['harbor:Harbor', 'meadow:Meadow', 'quill:Quill', 'lantern:Lantern Cloud Inference', 'marsh:Marshland AI Gateway'].map((p) => { const [i, n] = p.split(':'); return row(i, n, 'extraordinarily-long-model-name-v12-instruct-quantized-awq-int4', 'Extraordinarily Long Model Name v12 Instruct Quantized AWQ INT4', i === 'lantern' ? 'daily' : null); }),
];

const browser = await chromium.launch();
const sizes = [['desktop', 1280, 800], ['phone', 390, 800]];
const themes = ['light', 'dark'];

async function openPage(width, height, theme) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
  const page = await ctx.newPage();
  await page.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
  await page.addInitScript((th) => { try { localStorage.setItem('bunny.theme', th); } catch {} }, theme);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/?token=' + TOKEN).catch(() => page.goto(BASE + '/'));
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-model').first().waitFor();
  return { ctx, page, errors };
}
const models = (page) => page.locator('.picker-panel .picker-model');
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- R: the real server, invented profile
{
  const r = await fetch(BASE + '/api/models', { headers: { 'x-bunny-token': TOKEN } });
  const list = await r.json();
  check('R1', 'the real /api/models of the invented server answers and every row has freeKind (free, daily or null)', r.status === 200 && Array.isArray(list) && list.every((m) => 'freeKind' in m && [null, 'free', 'daily'].includes(m.freeKind)), `status ${r.status}, ${list.length} rows`);
}

await fetch(BASE + '/api/settings', { method: 'PUT', headers: { 'x-bunny-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ modelFilter: 'all' }) });
for (const [sizeName, w, h] of sizes) for (const theme of themes) {
  const tag = `${sizeName}/${theme}`;
  const { ctx, page, errors } = await openPage(w, h, theme);
  const n = await models(page).count();
  check(`P1 ${tag}`, 'one row per model: 7 models from 15 provider rows, Auto shown with no filter', n === 7 && await page.locator('.picker-panel .picker-auto').isVisible(), `${n} rows`);
  const falcon = models(page).filter({ hasText: 'Falcon Flash' }).first();
  const tags = await falcon.locator('.picker-tag').allTextContents();
  check(`P2 ${tag}`, 'Falcon Flash tags in order: Harbor Free, Meadow Free daily, Quill', JSON.stringify(tags) === JSON.stringify(['HarborFree', 'MeadowFree daily', 'Quill']), JSON.stringify(tags));
  const sable = models(page).filter({ hasText: 'Sable 9' }).first();
  const sableTags = await sable.locator('.picker-tag').evaluateAll((els) => els.map((e) => ({ t: e.textContent, out: e.classList.contains('is-out') })));
  check(`P3 ${tag}`, 'a provider this account cannot use is shown struck through and listed after the one it can use', sableTags.length === 2 && sableTags[0].t.startsWith('Quill') && sableTags[1].out, JSON.stringify(sableTags));
  const widthOk = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const panelBox = await page.locator('.picker-panel').boundingBox();
  check(`P4 ${tag}`, 'no horizontal page scroll and the panel is inside the window', widthOk && panelBox && panelBox.x >= -1 && panelBox.x + panelBox.width <= w + 1, JSON.stringify(panelBox));
  const longRow = models(page).filter({ hasText: 'Extraordinarily' }).first();
  const lb = await longRow.boundingBox(); const tb = await longRow.locator('.picker-tags').boundingBox();
  const overflow = await longRow.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  check(`P5 ${tag}`, 'the long name on five providers wraps inside its row, nothing spills out', lb && tb && tb.x + tb.width <= lb.x + lb.width + 1 && !overflow, `row ${Math.round(lb?.width)} tags ${Math.round(tb?.width)} overflow ${overflow}`);
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: /Free only/ }).click();
  const c1 = await page.locator('.picker-count').textContent();
  check(`P6 ${tag}`, 'Free only: count says "6 of 7 models" (only Birch Large has no free provider)', c1 === '6 of 7 models', c1);
  const autoGone = await page.locator('.picker-panel .picker-auto').count();
  check(`P7 ${tag}`, 'filtering hides Auto and the suggestions', autoGone === 0);
  await page.getByRole('button', { name: 'Quill', exact: true }).click();
  const empty = await page.locator('.picker-panel .picker-empty').count();
  check(`P8 ${tag}`, 'Free only + Quill (AND): nothing free on Quill gives the empty note and a count of 0', empty === 1 && (await page.locator('.picker-count').textContent()).startsWith('0 of'), await page.locator('.picker-count').textContent());
  await page.getByRole('button', { name: 'Quill', exact: true }).click();
  await page.getByRole('button', { name: 'Harbor', exact: true }).click();
  const harborRows = await models(page).count();
  const tagsAfter = await models(page).first().locator('.picker-tag').allTextContents();
  check(`P9 ${tag}`, 'Free only + Harbor: only Harbor-free models; their tag list shows only the providers that fit', harborRows >= 1 && tagsAfter.every((t) => t.startsWith('Harbor')), `${harborRows} rows, first row tags ${JSON.stringify(tagsAfter)}`);
  const pressed = await page.locator('.picker-chip[aria-pressed="true"]').count();
  check(`P10 ${tag}`, 'the two chosen chips are marked pressed and the button says "Filters · 2"', pressed === 2 && await page.getByRole('button', { name: /Filters · 2/ }).isVisible(), `${pressed} pressed`);
  // contrast of the Free tag text and the pressed chip in this theme
  const colours = await page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return parse(c); } return [255, 255, 255]; };
    const out = {};
    const f = document.querySelector('.picker-free'); if (f) out.free = [parse(getComputedStyle(f).color), bgOf(f)];
    const t = document.querySelector('.picker-tag'); if (t) out.tag = [parse(getComputedStyle(t).color), bgOf(t)];
    const c = document.querySelector('.picker-chip[aria-pressed="true"]'); if (c) out.chip = [parse(getComputedStyle(c).color), bgOf(c)];
    const k = document.querySelector('.picker-count'); if (k) out.count = [parse(getComputedStyle(k).color), bgOf(k)];
    return out;
  });
  const cr = Object.fromEntries(Object.entries(colours).map(([k, [fg, bg]]) => [k, +ratio(fg, bg).toFixed(2)]));
  check(`P11 ${tag}`, 'text contrast at least 4.5:1 for the Free tag, provider tag, pressed chip and count', Object.values(cr).length >= 3 && Object.values(cr).every((v) => v >= 4.5), JSON.stringify(cr));
  await page.screenshot({ path: join(SHOTS, `picker-${sizeName}-${theme}-filtered.png`) });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  const back = await models(page).count();
  check(`P12 ${tag}`, 'Clear filters brings all 7 models, the count and Auto back', back === 7 && await page.locator('.picker-count').isHidden() && await page.locator('.picker-panel .picker-auto').isVisible());
  // search and filter together
  await page.locator('.picker-panel input').first().fill('otter');
  const sr = await models(page).count();
  check(`P13 ${tag}`, 'typing "otter" leaves one row', sr === 1, `${sr}`);
  await page.getByRole('button', { name: 'Free only (Free and Free daily)' }).click();
  const c2 = await page.locator('.picker-count').textContent();
  check(`P14 ${tag}`, 'search + Free only: count "1 of 7 models"', c2 === '1 of 7 models', c2);
  await page.locator('.picker-panel input').first().fill('');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  // keyboard: arrow down twice then Enter picks the row's first provider
  await page.locator('.picker-panel input').first().focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const trig = await page.locator('#picker-button').textContent();
  check(`P15 ${tag}`, 'arrow keys and Enter choose a model (the trigger shows model and provider)', /\S/.test(trig) && !/Choose/i.test(trig) , trig.trim().slice(0, 60));
  await page.screenshot({ path: join(SHOTS, `picker-${sizeName}-${theme}-after.png`) });
  // reopen: filters start clean
  await page.locator('#picker-button').click();
  await page.waitForTimeout(600); await page.locator('.picker-panel').waitFor({ timeout: 3000 }).catch(() => {});
  const clean = (await page.locator('.picker-panel').isVisible()) && (await models(page).count()) === 7 && await page.locator('.picker-count').isHidden();
  check(`P16 ${tag}`, 'reopening the picker starts with no filter', clean);
  await page.screenshot({ path: join(SHOTS, `picker-${sizeName}-${theme}-open.png`) });
  check(`P17 ${tag}`, 'no page error or console error', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close(); server.kill();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
