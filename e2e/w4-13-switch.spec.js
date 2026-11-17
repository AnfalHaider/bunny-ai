import { test, expect } from '@playwright/test';
import { resetProfile, connectAnthropic } from './helpers.js';

// W4-13 slice 3: when the provider of the model you picked fails, the same model is tried on the next provider in the
// person's order before any other model, and one amber line says so. The models are stubbed: Harbor is the connected
// provider, Meadow is invented, and the request for Meadow is sent on to the real (fake-upstream) provider.
const NL = String.fromCharCode(10);

test.beforeEach(async ({ page, request }) => {
  await resetProfile(request);
  if (process.env.W413_WIDTH) await page.setViewportSize({ width: Number(process.env.W413_WIDTH), height: 844 });
  if (process.env.W413_SCHEME) await page.emulateMedia({ colorScheme: process.env.W413_SCHEME });
});

test('the same model on the next provider, before any other model, with one amber line', async ({ page, request }) => {
  await connectAnthropic(page);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  const real = (await (await request.get('/api/models')).json())[0];
  const harbor = { ...real, providerName: 'Harbor', displayName: 'Falcon Flash', freeKind: null };
  const meadow = { ...real, providerId: 'meadow-x', providerName: 'Meadow', displayName: 'Falcon Flash', freeKind: null };
  await page.route('**/api/models*', (route) => route.fulfill({ json: [harbor, meadow] }));
  await page.goto('/');
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-model:not([data-section])').first().click();

  const sent = [];
  await page.route('**/api/sessions/*/messages', async (route) => {
    const body = route.request().postDataJSON();
    sent.push({ providerId: body.providerId, model: body.model, kind: body.fellBackKind, from: body.fellBackFrom });
    if (sent.length === 1) {
      await route.fetch(); // the server saves the turn, as it does when a real provider fails
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: error${NL}data: {"code":"chat.rateLimited","message":"Rate limit","scope":"model","reason":"rate-limit"}${NL}${NL}` });
      return;
    }
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue({ postData: JSON.stringify({ ...body, providerId: real.providerId }) }); // Meadow is invented: the real provider answers
  });
  // The real provider answered for Meadow, and the stubbed first try saved a reply of its own: show the chat as it would be saved for real
  await page.route(/\/api\/sessions\/[^/?]+(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const res = await route.fetch();
    const json = await res.json();
    const lastAnswer = json.messages?.findLastIndex?.((m) => m.role === 'assistant' && m.fellBackKind) ?? -1;
    if (lastAnswer >= 0) {
      json.messages = json.messages.filter((m, i) => m.role !== 'assistant' || i === lastAnswer);
      json.messages[json.messages.findIndex((m) => m.fellBackKind)].providerId = 'meadow-x';
    }
    await route.fulfill({ response: res, json });
  });
  await page.locator('#input').fill('please answer');
  await page.locator('#send').click();
  await expect(page.locator('#status')).toContainText('Trying Falcon Flash on Meadow');
  // Pictures for Design (not part of the gate): W413_SHOT=<folder> W413_SCHEME=dark W413_WIDTH=390 writes two, on invented data.
  const shot = (name) => (process.env.W413_SHOT ? page.screenshot({ path: process.env.W413_SHOT + '/' + name + '.png' }) : null);
  await shot('switching');
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('', { timeout: 15_000 });
  expect(sent.map((s) => [s.providerId, s.model])).toEqual([[real.providerId, real.id], ['meadow-x', real.id]]); // the same model, the next provider
  expect(sent[1]).toMatchObject({ kind: 'provider', from: 'Harbor' });
  const note = page.locator('.msg.assistant .switch-note').last();
  await expect(note).toContainText('Switched to');
  await expect(note).toContainText('Harbor was busy');
  await expect(page.locator('.error-note')).toHaveCount(0);
  await shot('switched');
});
