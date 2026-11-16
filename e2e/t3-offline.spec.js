import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

import { resetProfile, connectAnthropic, pickFirstModel } from './helpers.js';

// T-3: a dead network is its own calm state. In this suite "the network is down" means: the browser says offline
// AND this server's probe (test mode) says so, which are the two signals the window needs to agree.

const goOffline = async (page, request) => {
  await request.put('/api/network', { data: { offline: true } });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
};
const goOnline = async (page, request) => {
  await request.put('/api/network', { data: { offline: false } });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
};
const sends = (page) => {
  const posted = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/sessions\/[^/]+\/messages$/.test(r.url())) posted.push(r.postDataJSON()?.content); });
  return posted;
};

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.put('/api/network', { data: { offline: false } });
});
test.afterEach(async ({ request }) => { await request.put('/api/network', { data: { offline: false } }); });

async function ready(page) {
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
}

test('T3-10: offline, no model is tried: the message waits, with a calm line, a waiting bubble and an Offline chip', async ({ page, request }) => {
  await ready(page);
  const posted = sends(page);
  await goOffline(page, request);
  await page.locator('#input').fill('send this later');
  await page.locator('#send').click();
  await expect(page.locator('.offline-line')).toHaveText('You are offline. I will send this when the network is back.');
  await expect(page.locator('#queued-msg .body')).toHaveText('send this later');
  await expect(page.locator('#queued-msg')).toContainText('Waiting to send');
  await expect(page.locator('#offline-chip')).toBeVisible();
  await expect(page.locator('#error')).toHaveText('');
  await expect(page.locator('#input')).toBeEnabled();
  expect(posted).toEqual([]);
});

test('T3-11: back online, the waiting message is sent once and answered, with no duplicate', async ({ page, request }) => {
  await ready(page);
  const posted = sends(page);
  await goOffline(page, request);
  await page.locator('#input').fill('wait for the network');
  await page.locator('#send').click();
  await expect(page.locator('#queued-msg')).toBeVisible();
  await goOnline(page, request);
  await expect(page.locator('#queued-msg')).toHaveCount(0);
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('', { timeout: 15_000 });
  await expect(page.locator('#offline-chip')).toBeHidden();
  expect(posted).toEqual(['wait for the network']);
  await expect(page.locator('.msg.user .body', { hasText: 'wait for the network' })).toHaveCount(1);
});

test('T3-12: Cancel (or typing something new) cancels the waiting message; it is not sent later', async ({ page, request }) => {
  await ready(page);
  const posted = sends(page);
  await goOffline(page, request);
  await page.locator('#input').fill('first');
  await page.locator('#send').click();
  await page.locator('#queued-msg').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#queued-msg')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Cancelled: the waiting message was not sent.');

  await page.locator('#input').fill('second');
  await page.locator('#send').click();
  await expect(page.locator('#queued-msg .body')).toHaveText('second');
  await page.locator('#input').fill('third');
  await page.locator('#send').click(); // typing something new replaces the waiting one
  await expect(page.locator('#queued-msg .body')).toHaveText('third');

  await goOnline(page, request);
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('', { timeout: 15_000 });
  expect(posted).toEqual(['third']);
});

test('T3-15: offline with a model on this computer connected: it answers, and the line says so', async ({ page, request }) => {
  const local = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url.endsWith('/chat/completions')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answered on this computer' } }] })}\n\ndata: [DONE]\n\n`); return; }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  try {
    const added = await request.post('/api/providers/custom', { data: { name: 'Local box', baseUrl: `http://127.0.0.1:${local.address().port}/v1` } });
    expect(added.ok()).toBeTruthy();
    await page.goto('/');
    await expect(page.locator('#picker-button')).toBeVisible();
    await goOffline(page, request);
    await page.locator('#input').fill('hello offline');
    await page.locator('#send').click();
    await expect(page.locator('.msg.assistant .body').last()).toContainText('answered on this computer', { timeout: 15_000 });
    await expect(page.locator('#queued-msg')).toHaveCount(0);
    await expect(page.locator('#offline-chip')).toBeVisible();
  } finally {
    local.closeAllConnections?.();
    await new Promise((r) => local.close(r));
  }
});

test('a model that did not answer: a calm "is slow. Trying ..." line while the next model starts, then one line under the reply', async ({ page }) => {
  await ready(page);
  let hits = 0;
  await page.route('**/api/sessions/*/messages', async (route) => {
    hits += 1;
    if (hits === 1) { await route.fetch(); /* the server saves the turn, as it does when a real model stalls */ await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: error' + String.fromCharCode(10) + 'data: {"code":"chat.stalled","message":"The provider did not answer in time","scope":"model","reason":"timeout"}' + String.fromCharCode(10, 10) }); return; }
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.locator('#input').fill('please answer');
  await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText(/is slow\. Trying /);
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('', { timeout: 15_000 });
  await expect(page.locator('.msg.assistant .auto-meta').last()).toContainText('did not answer in time');
  await expect(page.locator('.error-note')).toHaveCount(0);
});

test('T3-10 (real offline): the browser really cut off, the probe cannot be reached either: still the calm state', async ({ page, context }) => {
  await ready(page);
  const posted = sends(page);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('#input').fill('really offline');
  await page.locator('#send').click();
  await expect(page.locator('.offline-line')).toBeVisible();
  await expect(page.locator('#queued-msg .body')).toHaveText('really offline');
  expect(posted).toEqual([]);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#queued-msg')).toHaveCount(0, { timeout: 15_000 });
});
