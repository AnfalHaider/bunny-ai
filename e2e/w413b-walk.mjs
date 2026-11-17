/**
 * QA, W4-13 picker at 2ef5070 (slice 2 and 2c: one row per model with every provider as a tag, Free tags, Filters with Provider, Can do and
 * Free only, Sort chips, "N of M models", Best for as one row per model, context size on the right, Speech only for models that make sound;
 * plus what the same commit carries of slice 2b: Details, favourites, Recent). Invented profile and invented models only
 * (BUNNY_DATA_DIR temp, BUNNY_FAKE_UPSTREAM=1; /api/models is answered by the walk). Screenshots go to $SHOTS or the temp folder.
 *   node e2e/w413b-walk.mjs
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
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/settings', { headers: { 'x-bunny-token': TOKEN } })).status < 500) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
await fetch(BASE + '/api/settings', { method: 'PUT', headers: { 'x-bunny-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ modelFilter: 'all' }) });

const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`); };
const row = (providerId, providerName, id, displayName, freeKind, contextLength, extra = {}) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength, ...extra });
const H = ['harbor', 'Harbor'], M = ['meadow', 'Meadow'], Q = ['quill', 'Quill'];
const MODELS = [
  row(...H, 'gpt-4o', 'GPT 4o', 'free', 128000), row(...M, 'gpt-4o', 'GPT 4o', 'daily', 128000), row(...Q, 'gpt-4o', 'GPT 4o', null, 128000),
  row(...H, 'claude-sonnet-4', 'Claude Sonnet 4', null, 200000), row(...M, 'claude-sonnet-4', 'Claude Sonnet 4', null, 200000),
  row(...M, 'qwen3-coder', 'Qwen3 Coder', 'daily', 262144), row(...H, 'qwen3-coder', 'Qwen3 Coder', 'free', 262144),
  row(...H, 'flux-schnell', 'Flux Schnell', 'free', 0),
  row(...Q, 'veo-3', 'Veo 3', null, 0),
  row(...M, 'gemini-2.5-flash-tts', 'Gemini Flash TTS', 'daily', 32768),
  row(...H, 'llama-3.1-8b', 'Llama 3.1 8B', 'free', 131072),
  row(...Q, 'mystery-1', 'Mystery One', null, null),
  row(...H, 'gpt-4.1', 'GPT 4.1', 'free', 1048576, { unavailable: 'this account cannot use it' }), row(...Q, 'gpt-4.1', 'GPT 4.1', null, 1048576),
  ...[['harbor', 'Harbor'], ['meadow', 'Meadow'], ['quill', 'Quill'], ['lantern', 'Lantern Cloud Inference'], ['marsh', 'Marshland AI Gateway']].map(([i, n]) => row(i, n, 'extraordinarily-long-model-name-v12-instruct-quantized-awq-int4', 'Extraordinarily Long Model Name v12 Instruct Quantized AWQ INT4', i === 'lantern' ? 'daily' : null, 65000)),
];
const UNIQUE = [...new Set(MODELS.map((m) => m.id))];
const nameOf = (id) => MODELS.find((m) => m.id === id).displayName;

const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const browser = await chromium.launch();
async function openPage(w, h, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
  const page = await ctx.newPage();
  await page.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-model').first().waitFor();
  return { ctx, page, errors };
}
const allRows = (page) => page.locator('.picker-panel .picker-model:not([data-section])');
const clean = (s) => s.replace(/unavailable|★/g, '').trim();
const names = async (page) => (await allRows(page).locator('.model-name').allTextContents()).map(clean);
const chip = (page, label) => page.locator('.picker-panel .picker-chip', { hasText: label }).first();
const countText = (page) => page.locator('.picker-count').textContent();
const tagsOf = (loc) => loc.locator('.picker-tag').allTextContents();
const stripFree = (s) => s.replace(/Free( daily)?$/, '');

for (const [sz, w, h] of [['desktop', 1280, 800], ['phone', 390, 800]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  const { ctx, page, errors } = await openPage(w, h, theme);

  // ---- W413-1: Best for is one row per model, and the arrow keys follow the Free-first order
  const best = page.locator('.picker-panel .picker-model[data-section="best"]');
  const bestNames = (await best.locator('.model-name').allTextContents()).map(clean);
  check(`B1 ${tag}`, 'Best for lists each model once (no repeats) and at most five', bestNames.length >= 1 && bestNames.length <= 5 && new Set(bestNames).size === bestNames.length, JSON.stringify(bestNames));
  const gptBest = best.filter({ hasText: 'GPT 4o' });
  const gptAll = allRows(page).filter({ hasText: 'GPT 4o' }).first();
  const bestTags = (await gptBest.count()) ? await tagsOf(gptBest.first()) : null;
  check(`B2 ${tag}`, 'a Best for row shows every provider as a tag in the same Free-first order as the All models row (Harbor Free, Meadow Free daily, Quill)', bestTags && JSON.stringify(bestTags) === JSON.stringify(await tagsOf(gptAll)) && JSON.stringify(bestTags) === JSON.stringify(['HarborFree', 'MeadowFree daily', 'Quill']), JSON.stringify(bestTags));
  await page.locator('.picker-panel input').first().focus();
  const thirdRow = page.locator('.picker-panel .picker-item').nth(2).locator('xpath=ancestor-or-self::*[contains(@class,"picker-row")][1]');
  const thirdTags = await tagsOf(thirdRow);
  const expectProvider = thirdTags.length ? stripFree(thirdTags[0]) : '';
  const expectModel = clean(await thirdRow.locator('.model-name').first().textContent());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const trig = ((await page.locator('#picker-button').textContent()) ?? '').trim();
  check(`B3 ${tag}`, 'ArrowDown twice then Enter picks the second row under Auto, with its first (Free-first) provider', expectProvider !== '' && trig.includes(expectProvider), `row ${expectModel}, first provider ${expectProvider}, trigger "${trig}"`);
  await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-model').first().waitFor();

  // ---- rows, tags, unavailable, wrapping
  const n = await allRows(page).count();
  check(`P1 ${tag}`, `All models has one row per model (${UNIQUE.length} models from ${MODELS.length} provider rows)`, n === UNIQUE.length, `${n} rows`);
  const st = await allRows(page).filter({ hasText: 'GPT 4.1' }).first().locator('.picker-tag').evaluateAll((els) => els.map((e) => ({ t: e.textContent, out: e.classList.contains('is-out') })));
  check(`P2 ${tag}`, 'a provider this account cannot use is struck through and listed after the usable one', st.length === 2 && st[0].t === 'Quill' && st[1].out, JSON.stringify(st));
  const longRow = allRows(page).filter({ hasText: 'Extraordinarily' }).first();
  const lb = await longRow.boundingBox(); const tb = await longRow.locator('.picker-tags').boundingBox();
  check(`P3 ${tag}`, 'the long model name on five providers wraps inside its row', lb && tb && tb.x + tb.width <= lb.x + lb.width + 1 && !(await longRow.evaluate((el) => el.scrollWidth > el.clientWidth + 1)), `row ${Math.round(lb?.width)} tags ${Math.round(tb?.width)}`);
  const panelBox = await page.locator('.picker-panel').boundingBox();
  check(`P4 ${tag}`, 'no sideways page scroll and the panel is inside the window', (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) && panelBox.x >= -1 && panelBox.x + panelBox.width <= w + 1, JSON.stringify(panelBox));

  // ---- context size on the right
  const ctxOf = async (name) => {
    const el = allRows(page).filter({ hasText: name }).first();
    return el.evaluate((e) => { const c = e.closest('.picker-row')?.querySelector('.picker-ctx'); return c ? c.textContent.trim() : null; });
  };
  const ctxs = {}; for (const nm of ['GPT 4o', 'Claude Sonnet 4', 'Qwen3 Coder', 'Gemini Flash TTS', 'Llama 3.1 8B', 'GPT 4.1', 'Flux Schnell', 'Mystery One', 'Extraordinarily']) ctxs[nm] = await ctxOf(nm);
  const wantCtx = { 'GPT 4o': '128K', 'Claude Sonnet 4': '200K', 'Qwen3 Coder': '256K', 'Gemini Flash TTS': '32K', 'Llama 3.1 8B': '128K', 'GPT 4.1': '1M', 'Flux Schnell': null, 'Mystery One': null, Extraordinarily: '65K' };
  check(`C1 ${tag}`, 'context size is shown compactly on the right (128K, 200K, 256K for 262,144, 32K, 1M for 1,048,576) and left out when unknown or 0', JSON.stringify(ctxs) === JSON.stringify(wantCtx), JSON.stringify(ctxs));
  const place = await allRows(page).filter({ hasText: 'Claude Sonnet 4' }).first().evaluate((el) => { const r = el.closest('.picker-row'); const c = r?.querySelector('.picker-ctx'); const d = r?.querySelector('.picker-details-link'); if (!c || !d) return null; const rb = r.getBoundingClientRect(); const cb = c.getBoundingClientRect(); const db = d.getBoundingClientRect(); return { ctxRight: Math.round(cb.right - rb.left), width: Math.round(rb.width), beforeDetails: cb.right <= db.left + 1 }; });
  check(`C2 ${tag}`, 'the context size sits at the right of the row, before the Details button, inside the row', place && place.beforeDetails && place.ctxRight <= place.width, JSON.stringify(place));
  const desc = async (name) => (await allRows(page).filter({ hasText: name }).first().locator('.model-desc').textContent()).trim();
  check(`C3 ${tag}`, 'the second line no longer repeats the context size and shows the id', !/tokens/.test(await desc('GPT 4o')) && /gpt-4o/.test(await desc('GPT 4o')), await desc('GPT 4o'));
  check(`SP1 ${tag}`, 'the Speech label shows for the text-to-speech model and not for GPT 4o or Claude', /Speech/.test(await desc('Gemini Flash TTS')) && !/Speech/.test(await desc('GPT 4o')) && !/Speech/.test(await desc('Claude Sonnet 4')), `${await desc('Gemini Flash TTS')} | ${await desc('GPT 4o')}`);

  // ---- Filters: Can do, Sort
  await page.getByRole('button', { name: 'Filters' }).click();
  const chipLabels = await page.locator('.picker-panel .picker-chip').allTextContents();
  check(`F1 ${tag}`, 'the bar has Provider chips, Can do chips (Code, See, Image, Video, Speech), Free only and Sort chips (Recommended, Name, Context size)', ['Code', 'See', 'Image', 'Video', 'Speech', 'Recommended', 'Name', 'Context size'].every((l) => chipLabels.some((c) => c.trim() === l)) && chipLabels.some((c) => /Free only/.test(c)), JSON.stringify(chipLabels));
  const canDo = { Code: ['gpt-4o', 'claude-sonnet-4', 'qwen3-coder', 'llama-3.1-8b', 'gemini-2.5-flash-tts', 'gpt-4.1'], See: ['gpt-4o', 'claude-sonnet-4', 'gemini-2.5-flash-tts', 'gpt-4.1'], Image: ['flux-schnell'], Video: ['veo-3'], Speech: ['gemini-2.5-flash-tts'] };
  for (const [label, want] of Object.entries(canDo)) {
    await chip(page, label).click();
    const got = await names(page);
    check(`F2 ${tag} ${label}`, `Can do ${label}: ${want.length} model(s), count "${want.length} of ${UNIQUE.length} models"`, got.length === want.length && want.every((id) => got.includes(nameOf(id))) && (await countText(page)) === `${want.length} of ${UNIQUE.length} models`, `${await countText(page)}: ${got.join(', ')}`);
    await chip(page, label).click();
  }
  await chip(page, 'See').click(); await chip(page, 'Code').click();
  check(`F3 ${tag}`, 'Can do See and Code together (AND): 4 models do both', (await countText(page)) === `4 of ${UNIQUE.length} models`, await countText(page));
  await page.getByRole('button', { name: /Free only/ }).click();
  const andFree = await names(page);
  check(`F4 ${tag}`, 'See + Code + Free only (AND): GPT 4o, Gemini Flash TTS and GPT 4.1 (free on Harbor); not Claude', ['GPT 4o', 'Gemini Flash TTS', 'GPT 4.1'].every((x) => andFree.includes(x)) && !andFree.includes('Claude Sonnet 4'), andFree.join(', '));
  check(`F5 ${tag}`, 'the Filters button counts all three chosen (Filters · 3) and Auto and Best for are hidden', (await page.getByRole('button', { name: /Filters · 3/ }).isVisible()) && (await page.locator('.picker-panel .picker-auto').count()) === 0 && (await best.count()) === 0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  check(`F6 ${tag}`, 'Clear filters clears Can do chips too and restores everything (only the Sort chip stays pressed)', (await allRows(page).count()) === UNIQUE.length && (await page.locator('.picker-chip[aria-pressed="true"]').count()) === 1, `${await page.locator('.picker-chip[aria-pressed="true"]').count()} pressed`);
  check(`S1 ${tag}`, 'Sort has exactly one chip pressed (Recommended) at the start', (await page.locator('.picker-chip[aria-pressed="true"]').allTextContents()).join() === 'Recommended');
  await chip(page, 'Name').click();
  const byName = await names(page);
  const wantName = [...UNIQUE].map(nameOf).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  check(`S2 ${tag}`, 'Sort by Name: A to Z by the shown name', JSON.stringify(byName) === JSON.stringify(wantName), byName.join(' | '));
  check(`S2b ${tag}`, 'only Name is pressed, and a sort alone is not counted as a filter (button says just Filters, no count shown)', (await page.locator('.picker-chip[aria-pressed="true"]').allTextContents()).join() === 'Name' && (await page.locator('.picker-filters-btn').textContent()).trim() === 'Filters' && (await page.locator('.picker-count').isHidden()));
  await chip(page, 'Context size').click();
  const byCtx = await names(page);
  const topCtx = (id) => Math.max(0, ...MODELS.filter((m) => m.id === id).map((m) => Number(m.contextLength) || 0));
  const wantCtxOrder = [...UNIQUE].sort((a, b) => topCtx(b) - topCtx(a) || nameOf(a).localeCompare(nameOf(b))).map(nameOf);
  check(`S3 ${tag}`, 'Sort by Context size: largest first, ties by name, unknown or 0 last', JSON.stringify(byCtx) === JSON.stringify(wantCtxOrder), byCtx.join(' | '));
  await chip(page, 'Name').click(); await page.getByRole('button', { name: /Free only/ }).click();
  const freeByName = await names(page);
  check(`S4 ${tag}`, 'Sort and a filter work together (Free only, by Name): sorted A to Z', JSON.stringify(freeByName) === JSON.stringify([...freeByName].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) && freeByName.length >= 4, freeByName.join(' | '));
  await page.getByRole('button', { name: 'Clear filters' }).click(); await chip(page, 'Recommended').click();

  const colours = await page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return parse(c); } return [255, 255, 255]; };
    const out = {};
    const pairs = { chipPressed: '.picker-chip[aria-pressed="true"]', chipIdle: '.picker-chip[aria-pressed="false"]', ctx: '.picker-ctx', details: '.picker-details-link', label: '.picker-chip-label' };
    for (const [k, sel] of Object.entries(pairs)) { const el = document.querySelector(`.picker-panel ${sel}`); if (el) out[k] = [parse(getComputedStyle(el).color), bgOf(el)]; }
    return out;
  });
  const cr = Object.fromEntries(Object.entries(colours).map(([k, [fg, bg]]) => [k, +ratio(fg, bg).toFixed(2)]));
  const low = Object.entries(cr).filter(([, v]) => v < 4.5);
  check(`K1 ${tag}`, 'text contrast of the chips, context size, Details button and chip label is at least 4.5:1', Object.keys(cr).length >= 4 && low.length === 0, JSON.stringify(low.length ? low : cr));
  await page.screenshot({ path: join(SHOTS, `picker-${sz}-${theme}-filters.png`) });
  await page.getByRole('button', { name: 'Filters' }).click().catch(() => {});

  // ---- Details, favourites, provider order (the same commit carries slice 2b)
  const row1 = allRows(page).filter({ hasText: 'GPT 4o' }).first().locator('xpath=ancestor::*[contains(@class,"picker-row")][1]');
  await row1.locator('.picker-details-link').click();
  const det = page.locator('.picker-details');
  const order = async () => (await det.locator('li .picker-order-name').allTextContents()).map(stripFree);
  check(`D1 ${tag}`, 'Details opens in the picker with the providers in Free-first order and "tokens of context"', (await det.isVisible()) && JSON.stringify(await order()) === JSON.stringify(['Harbor', 'Meadow', 'Quill']) && /128,000 tokens of context/.test(await det.locator('.picker-details-meta').textContent()), JSON.stringify(await order()));
  await det.locator('li').first().locator('.picker-move').nth(1).click();
  check(`D2 ${tag}`, 'moving Harbor down puts Meadow first, and the picker stays open (the click is not "outside")', JSON.stringify(await order()) === JSON.stringify(['Meadow', 'Harbor', 'Quill']) && (await det.isVisible()) && (await page.locator('.picker-panel').isVisible()), JSON.stringify(await order()));
  await det.locator('.picker-fav').click();
  check(`D3 ${tag}`, 'Add to favourites turns into Remove from favourites', /Remove from favourites/.test(await det.locator('.picker-fav').textContent()));
  await det.locator('.picker-back').click();
  const afterBack = (await tagsOf(allRows(page).filter({ hasText: 'GPT 4o' }).first())).map(stripFree);
  check(`D4 ${tag}`, 'Back returns to the list with the new order on the GPT 4o tags (Meadow first) and a star', JSON.stringify(afterBack) === JSON.stringify(['Meadow', 'Harbor', 'Quill']) && (await allRows(page).filter({ hasText: 'GPT 4o' }).first().locator('.picker-star').count()) === 1, JSON.stringify(afterBack));
  check(`D5 ${tag}`, 'a Favourites group sits above Best for with GPT 4o in it', (await page.locator('.picker-panel .picker-group', { hasText: 'Favourites' }).count()) === 1 && (await page.locator('.picker-panel .picker-model[data-section="fav"]').count()) === 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  check(`D6 ${tag}`, 'Escape closes the picker', (await page.locator('.picker-panel').count()) === 0);
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-model').first().waitFor();
  await page.locator('.picker-panel .picker-model[data-section="fav"]').first().click();
  const trig2 = ((await page.locator('#picker-button').textContent()) ?? '').trim();
  check(`D7 ${tag}`, 'choosing the favourite uses the provider the person put first (Meadow)', /Meadow/.test(trig2) && /gpt-4o|GPT 4o/i.test(trig2), trig2);
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-model').first().waitFor();
  await page.waitForTimeout(600);
  check(`D8 ${tag}`, 'reopening after choosing a model: the picker stays open, and a favourite is not repeated under Recent', (await page.locator('.picker-panel').isVisible()) && (await page.locator('.picker-panel .picker-model[data-section="recent"]').filter({ hasText: 'GPT 4o' }).count()) === 0);
  await page.screenshot({ path: join(SHOTS, `picker-${sz}-${theme}-open.png`) });
  check(`E1 ${tag}`, 'no page error', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close(); server.kill();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
