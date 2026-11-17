import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// W4-8: the quick-ask bar page, at the real window size (700 x 300), with a stand-in for the two bridge calls.
const BAR = pathToFileURL(resolve('electron/quick-ask/bar.html')).href;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function openBar(page, { submit }) {
  await page.setViewportSize({ width: 700, height: 300 });
  await page.addInitScript(({ pixel, mode }) => {
    window.quickAsk = {
      captureScreenshot: async () => ({ ok: true, data: pixel }),
      pickFile: async () => (mode === 'cancel' ? { ok: false, cancelled: true } : mode === 'refuse' ? { ok: false, message: 'That file is over 8 MB.' } : { ok: true, name: 'report.pdf', mime: 'application/pdf', kind: 'pdf', data: 'data:application/pdf;base64,JVBERi0=' }),
      submit: () => (mode === 'wait' ? new Promise(() => {}) : Promise.resolve({ ok: false })),
    };
  }, { pixel: PIXEL, mode: submit });
  await page.goto(BAR);
}

for (const scheme of ['light', 'dark']) {
  test(`the + menu fits inside the window (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openBar(page, { submit: 'wait' });
    await page.locator('#plus').click();
    const box = await page.locator('#menu').boundingBox();
    const body = await page.evaluate(() => ({ body: document.body.getBoundingClientRect().bottom, inner: window.innerHeight }));
    expect(box.y + box.height).toBeLessThanOrEqual(body.inner); // not cut off by the window
    expect(box.y + box.height).toBeLessThanOrEqual(body.body); // nor by the page's own overflow:hidden
    await expect(page.locator('#shot-item small')).toBeVisible();
    if (process.env.W48_SHOT) await page.screenshot({ path: process.env.W48_SHOT + '/menu-' + scheme + '.png' }); // pictures for Design (not part of the gate)
  });
}

test('"Opening Bunny…" is normal text with a spinner, not a warning', async ({ page }) => {
  await openBar(page, { submit: 'wait' });
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  const msg = page.locator('#msg');
  await expect(msg).toHaveText('Opening Bunny…');
  await expect(msg.locator('.spin')).toBeVisible();
  if (process.env.W48_SHOT) await page.screenshot({ path: process.env.W48_SHOT + '/opening.png' });
  const [msgColour, textColour] = await page.evaluate(() => [getComputedStyle(document.getElementById('msg')).color, getComputedStyle(document.body).color]);
  expect(msgColour).toBe(textColour);
});

test('a real problem stays amber and has no spinner', async ({ page }) => {
  await openBar(page, { submit: 'fail' });
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  const msg = page.locator('#msg');
  await expect(msg).toHaveText('Bunny could not open.');
  await expect(msg.locator('.spin')).toHaveCount(0);
  const [msgColour, textColour] = await page.evaluate(() => [getComputedStyle(document.getElementById('msg')).color, getComputedStyle(document.body).color]);
  expect(msgColour).not.toBe(textColour);
  expect(msgColour).toBe('rgb(180, 83, 9)');
});

test('W4-8b: the + menu offers a screenshot and a file; a chosen file shows as a chip with its name that can be removed', async ({ page }) => {
  await openBar(page, { submit: 'wait' });
  await page.locator('#plus').click();
  await expect(page.locator('#shot-item')).toBeVisible();
  await expect(page.locator('#file-item')).toContainText('Add a file…');
  const box = await page.locator('#menu').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(300); // both items fit in the window
  await page.locator('#file-item').click();
  const chip = page.locator('#chips .chip');
  await expect(chip).toContainText('report.pdf');
  await expect(chip.locator('img')).toHaveCount(0); // a PDF has no picture
  await chip.getByRole('button', { name: 'Remove the file' }).click();
  await expect(page.locator('#chips')).toBeHidden();
});

test('W4-8b: a refused file says why in amber and adds nothing; cancelling the dialog says nothing', async ({ page }) => {
  await openBar(page, { submit: 'refuse' });
  await page.locator('#plus').click();
  await page.locator('#file-item').click();
  await expect(page.locator('#msg')).toHaveText('That file is over 8 MB.');
  await expect(page.locator('#chips')).toBeHidden();
});
