import { test, expect } from '@playwright/test';
import { resetProfile, connectAnthropic, pickFirstModel } from './helpers.js';

// AGENT-FLOW F8 and QUICK-ASK-JUST-WORKS: Search this PC is on by default for finding only (the stand-in index over invented files, BUNNY_PCSEARCH_FAKE), the first search says so once,
// and when it is off a card in the chat turns it on, after which the search works in the same reply. (A device being refused is in test/pc-device.test.js over real HTTP.)
const NOTICE = /Search this PC is on, for finding files only/;

async function ask(page, text, searches) {
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
  // the reply has started when the search step is on the page (the stop button is hidden before it starts, so it alone proves nothing)
  await expect(page.locator('.tool-call-header', { hasText: 'Searched this PC' })).toHaveCount(searches, { timeout: 30_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 30_000 });
}

test('default on: a new profile searches with nothing saved, the first search shows one notice, and the second shows none', async ({ page, request }) => {
  await resetProfile(request);
  const settings = await (await request.get('/api/settings')).json();
  expect(settings.pcSearchEnabled, 'nothing saved: the default is not written').toBeUndefined();
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
  // the notice is a live card (it is not saved with the chat): count the times one is put on the page
  await page.evaluate((source) => {
    window.__notices = 0;
    new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && new RegExp(source).test(n.textContent ?? '') && n.querySelector?.('.capability-reason')) window.__notices += 1; }).observe(document.body, { childList: true, subtree: true });
  }, NOTICE.source);
  await ask(page, 'find my tax returns [[call search_pc {"terms":["tax"]}]]', 1);
  expect(await page.evaluate(() => window.__notices), 'one notice in the first search').toBe(1);
  const list = await (await request.get('/api/sessions')).json();
  const chat = JSON.stringify(await (await request.get(`/api/sessions/${list[0].id}`)).json());
  expect(chat).toContain('Searched this PC');
  expect(chat, 'the notice is not saved with the chat').not.toMatch(NOTICE);
  await ask(page, 'and again [[call search_pc {"terms":["return"]}]]', 2);
  expect(await page.evaluate(() => window.__notices), 'a second search: no second notice').toBe(1);
  const after = await (await request.get('/api/settings')).json();
  expect(after.pcSearchNoticeShown).toBe(true);
  expect(after.pcSearchEnabled, 'the notice does not write the switch').toBeUndefined();
});

test('off: the card in the chat turns on finding only, and the search works in the same reply', async ({ page, request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { pcSearchEnabled: false, pcSearchAfter: 'read', pcSearchNoticeShown: true } });
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
  await page.locator('#input').fill('find my tax returns [[call request_capability {"capability":"pc_search","reason":"find your tax return"}]] [[call search_pc {"terms":["tax"]}]]');
  await page.locator('#send').click();
  const card = page.locator('.capability-card', { hasText: 'Search this PC' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('File names and paths it finds, and the text of files it reads, go to the model');
  await expect(card).toContainText('Why it asks: "find your tax return"');
  await expect(card).toContainText('You can turn it off in Settings › Capabilities');
  await card.getByRole('button', { name: 'Turn on Search this PC' }).click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 30_000 });
  const settings = await (await request.get('/api/settings')).json();
  expect(settings.pcSearchEnabled).toBe(true);
  expect(settings.pcSearchAfter, 'finding only: the reading choice is unchanged').toBe('read');
  const list = await (await request.get('/api/sessions')).json();
  const saved = JSON.stringify(await (await request.get(`/api/sessions/${list[0].id}`)).json());
  expect(saved).toContain('Searched this PC');
});
