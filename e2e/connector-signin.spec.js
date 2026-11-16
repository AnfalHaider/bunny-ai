import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resetProfile } from './helpers.js';
import { startFake } from '../test/fake-mcp-oauth.js';

// W3-6: signing in to a connector from the Customize page. A stand-in connector and sign-in server run in this process
// (invented data only); the spec plays the person's browser by calling the return address the sign-in address leads to.

let fake;
test.beforeEach(async ({ request, baseURL }) => {
  await resetProfile(request);
  fake = await startFake({ idToken: true }, baseURL);
});
test.afterEach(async () => { await fake.close(); });

const SHOTS = 'docs/design/review-w36/built';

/** The system browser coming back: no page token, a cross-site navigation. */
async function comeBack(baseURL, authUrl, { deny = false } = {}) {
  const { code, state } = fake.browse(authUrl, { deny });
  const params = new URLSearchParams(deny ? { state, error: 'access_denied' } : { state, code });
  return fetch(`${baseURL}/api/connectors/oauth/callback?${params}`, { headers: { 'sec-fetch-site': 'cross-site' } });
}

async function addFake(request) {
  const added = await (await request.post('/api/mcp', { data: { name: 'Fake docs', url: fake.server.url, enabled: true } })).json();
  return added.id;
}

test('Test shows Sign in, signing in shows "Signed in as", and Sign out says whether the provider revoked', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await expect(row.locator('.cz-status-word')).toHaveText('Not checked');

  await row.getByRole('button', { name: 'Test' }).click();
  await expect(row.locator('.cz-status-word')).toHaveText('Needs sign-in');
  await expect(row.locator('.cz-status-detail')).toHaveText(/^Opens 127\.0\.0\.1:\d+ in your browser$/);
  await expect(row.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await expect(row.locator('.cz-status-word')).toHaveText('Waiting for your browser');
  await expect(row.locator('.cz-status-detail')).toContainText('5 minutes to finish');
  const back = await comeBack(baseURL, opened.url());
  expect(back.status).toBe(200);
  expect(await back.text()).toContain('Signed in. You can close this tab and go back to Bunny AI.');
  await opened.close();

  await expect(row.locator('.cz-status-word')).toHaveText('Signed in', { timeout: 10_000 });
  await expect(row.locator('.cz-status-detail')).toHaveText('pat@example.test');
  await expect(row.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/connectors-signed-in-desktop.png` });

  await row.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#cz-note')).toContainText('was told to end the access');
  await expect(row.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  expect(fake.revoked.length).toBeGreaterThan(0);
});

test('a provider that cannot revoke says so when the person signs out', async ({ page, request, baseURL }) => {
  await fake.close();
  fake = await startFake({ idToken: true, revocation: false }, baseURL);
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await row.getByRole('button', { name: 'Test' }).click();
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await comeBack(baseURL, opened.url());
  await opened.close();
  await expect(row.locator('.cz-status-word')).toHaveText('Signed in', { timeout: 10_000 });
  await row.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#cz-note')).toContainText('has no way to revoke the access');
});

test('a sign-in the person cancels says so and can be tried again', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await row.getByRole('button', { name: 'Test' }).click();
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await comeBack(baseURL, opened.url(), { deny: true });
  await opened.close();
  await expect(row.locator('.cz-status-word')).toHaveText('Sign-in cancelled', { timeout: 10_000 });
  await expect(row).toContainText('cancelled');
  await expect(row.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a service that does not let apps register asks for a client ID, only then', async ({ page, request, baseURL }) => {
  await fake.close();
  fake = await startFake({ idToken: true, registration: false }, baseURL);
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await expect(row.getByLabel(/Client ID/)).toHaveCount(0);
  await row.getByRole('button', { name: 'Test' }).click();
  await row.getByRole('button', { name: 'Sign in' }).click();
  await expect(row).toContainText('This service does not let apps register themselves. Paste the client ID from its developer settings.');
  await row.getByLabel(/Client ID/).fill('my-client-id');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Continue' }).click();
  const opened = await popup;
  expect(new URL(opened.url()).searchParams.get('client_id')).toBe('my-client-id');
});

test('on a phone the connectors are cards, with their status, and nothing scrolls sideways', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await row.getByRole('button', { name: 'Test' }).click();
  await expect(row.locator('.cz-status')).toBeVisible();
  await expect(row.locator('.cz-status-word')).toHaveText('Needs sign-in');
  await expect(row.locator('.cz-type')).toBeHidden();
  await expect(row.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await row.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px'); // a card
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(sideways).toBe(false);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/connectors-needs-sign-in-phone.png` });

  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await comeBack(baseURL, opened.url());
  await opened.close();
  await expect(row.locator('.cz-status-word')).toHaveText('Signed in', { timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test('the Automation page shows the same status words and can start the sign-in', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.goto('/src/ui/automation.html');
  const row = page.locator('#mcp-list .kv', { hasText: 'Fake docs' });
  await expect(row.locator('.cz-status-word')).toHaveText('Not checked');
  await row.getByRole('button', { name: 'Check tools' }).click();
  await expect(row.locator('.cz-status-word')).toHaveText('Needs sign-in');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await expect(row.locator('.cz-status-word')).toHaveText('Waiting for your browser');
  await comeBack(baseURL, opened.url());
  await opened.close();
  await expect(row.locator('.cz-status-word')).toHaveText('Signed in', { timeout: 10_000 });
  await expect(row.locator('.cz-status-detail')).toHaveText('pat@example.test');
  await row.getByRole('button', { name: 'Sign out' }).click();
  await expect(row.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});
