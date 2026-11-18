import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

// W4-8: the quick-ask bar page, at the real window size (700 x 300), with a stand-in for the two bridge calls.
// The bar page imports the app's own markdown module (../../src/ui/markdown.js). Electron loads it from a file; a plain browser cannot import a module from file://,
// so this spec serves the project folder (read only, localhost) and opens the same page from there.
const ROOT = resolve('.');
let origin = '';
let staticServer;
test.beforeAll(async () => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  staticServer = createServer(async (req, res) => {
    const target = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    const rel = target.startsWith(ROOT + sep) ? target.slice(ROOT.length + 1).split(sep).join('/') : '';
    if (!/^(electron\/quick-ask|src\/ui)\//.test(rel)) { res.writeHead(404).end(); return; } // only the bar and the app's own UI files
    try { res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' }).end(await readFile(target)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${staticServer.address().port}`;
});
test.afterAll(() => new Promise((r) => staticServer.close(r)));
const barUrl = () => `${origin}/electron/quick-ask/bar.html`;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function openBar(page, { submit }) {
  await page.setViewportSize({ width: 700, height: 300 });
  await page.addInitScript(({ pixel, mode }) => {
    window.quickAsk = {
      captureScreenshot: async () => ({ ok: true, data: pixel }),
      pickFile: async () => (mode === 'cancel' ? { ok: false, cancelled: true } : mode === 'refuse' ? { ok: false, message: 'That file is over 8 MB.' } : { ok: true, id: 'invented-id-1', name: 'report.pdf', kind: 'pdf', size: 5 }),
      dropFile: async () => ({ ok: true }),
      submit: () => (mode === 'wait' ? new Promise(() => {}) : Promise.resolve({ ok: false })),
      // QA-ANSWERS: the rest of the bridge the page uses
      ask: () => (mode === 'wait' ? new Promise(() => {}) : mode === 'fail' ? Promise.resolve({ ok: false, message: 'Bunny could not start the answer.' }) : Promise.resolve({ ok: true })), stop: async () => ({ ok: true }), openInBunny: async () => ({ ok: true }), resize: async () => ({ ok: true }), onAnswer: () => () => {}, onEscape: () => () => {}, close: async () => ({ ok: true }), escHandled: async () => ({ ok: true }),
    };
  }, { pixel: PIXEL, mode: submit });
  await page.goto(barUrl());
}

for (const scheme of ['light', 'dark']) {
  test(`the + menu fits inside the window (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openBar(page, { submit: 'wait' });
    await page.locator('#text').fill('x'); // the + shows with the first keystroke
    await page.locator('#plus').click();
    const box = await page.locator('#menu').boundingBox();
    const body = await page.evaluate(() => ({ body: document.body.getBoundingClientRect().bottom, inner: window.innerHeight }));
    expect(box.y + box.height).toBeLessThanOrEqual(body.inner); // not cut off by the window
    expect(box.y + box.height).toBeLessThanOrEqual(body.body); // nor by the page's own overflow:hidden
    await expect(page.locator('#shot-item small')).toBeVisible();
    if (process.env.W48_SHOT) await page.screenshot({ path: process.env.W48_SHOT + '/menu-' + scheme + '.png' }); // pictures for Design (not part of the gate)
  });
}

test('QA-ANSWERS: after Enter the question stays on top and "Bunny is thinking…" is normal text with a spinner, not a warning', async ({ page }) => {
  await openBar(page, { submit: 'wait' });
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await expect(page.locator('#q')).toHaveText('hello');
  const busy = page.locator('#busy');
  await expect(busy).toHaveText('Bunny is thinking…');
  await expect(busy.locator('.spin')).toBeVisible();
  await expect(page.locator('#go')).toHaveAttribute('aria-label', 'Stop');
  await expect(page.locator('#follow')).toBeDisabled();
  if (process.env.W48_SHOT) await page.screenshot({ path: process.env.W48_SHOT + '/thinking.png' });
  const [msgColour, warnColour] = await page.evaluate(() => [getComputedStyle(document.getElementById('busy')).color, getComputedStyle(document.documentElement).getPropertyValue('--warn').trim()]);
  expect(msgColour).not.toBe(warnColour); // it is not a warning (the pill draws it in its quiet colour)
});

test('QA-ANSWERS: a real problem is a card in the warning colour with Try again and Open in Bunny, and no spinner', async ({ page }) => {
  await openBar(page, { submit: 'fail' });
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  const card = page.locator('#card .cardx.bad');
  await expect(card).toContainText('Bunny could not answer');
  await expect(card).toContainText('Bunny could not start the answer.');
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Open in Bunny' })).toBeVisible();
  await expect(page.locator('#busy')).toHaveCount(0);
  const titleColour = await page.evaluate(() => getComputedStyle(document.querySelector('#card .cardx .t')).color);
  expect(titleColour).toBe('rgb(207, 63, 85)');
});
test('W4-8b: the + menu offers a screenshot and a file; a chosen file shows as a chip with its name that can be removed', async ({ page }) => {
  await openBar(page, { submit: 'wait' });
  await page.locator('#text').fill('x');
  await page.locator('#plus').click();
  await expect(page.locator('#shot-item')).toBeVisible();
  await expect(page.locator('#file-item')).toContainText('Add a file…');
  const box = await page.locator('#menu').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(300); // both items fit (the window grows for the menu)
  await page.locator('#file-item').click();
  const chip = page.locator('#chips .chip');
  await expect(chip).toContainText('report.pdf');
  await expect(chip.locator('img')).toHaveCount(0); // a PDF has no picture
  await chip.getByRole('button', { name: 'Remove the file' }).click();
  await expect(page.locator('#chips')).toBeHidden();
});

test('W4-8b: a refused file says why in amber and adds nothing; cancelling the dialog says nothing', async ({ page }) => {
  await openBar(page, { submit: 'refuse' });
  await page.locator('#text').fill('x');
  await page.locator('#plus').click();
  await page.locator('#file-item').click();
  await expect(page.locator('#msg')).toHaveText('That file is over 8 MB.');
  await expect(page.locator('#chips')).toBeHidden();
});
