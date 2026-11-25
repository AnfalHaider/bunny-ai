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

/** The chip that says what needs the person. A connector the person added at their own private or http address also carries its own-address chip (IA-0: "Added by you · may use a private address"), which is not a status, so it is left out here. */
const statusChip = (row) => row.locator('.tr-chip').filter({ hasNotText: 'Added by you' });

/** TIGHT-ROWS: Test, Sign out and the like are in the row's menu. */
async function menu(row, name) {
  await row.getByRole('button', { name: /^More for/ }).click();
  await row.getByRole('menuitem', { name }).click();
}
async function noMenuItem(row, name) {
  await row.getByRole('button', { name: /^More for/ }).click();
  await expect(row.getByRole('menuitem', { name })).toHaveCount(0);
  await row.page().keyboard.press('Escape');
}

async function addFake(request) {
  const added = await (await request.post('/api/mcp', { data: { name: 'Fake docs', url: fake.server.url, enabled: true } })).json();
  return added.id;
}

test('Test shows Sign in, signing in shows "Signed in as", and Sign out says whether the provider revoked', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await expect(statusChip(row)).toHaveCount(0); // nothing needs the person: no status word
  await expect(row.locator('.tr-chip', { hasText: 'Added by you · may use a private address' })).toHaveCount(1); // IA-0: the person's own connector at a private address says so

  await menu(row, 'Test');
  await expect(statusChip(row)).toHaveText('Needs sign-in');
  await expect(row.locator('.tr-l2')).toContainText(/Opens 127\.0\.0\.1:\d+ in your browser/);
  await expect(row.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await noMenuItem(row, 'Sign out');

  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await expect(statusChip(row)).toHaveText('Waiting for your browser');
  await expect(row.locator('.tr-l2')).toContainText('5 minutes to finish');
  const back = await comeBack(baseURL, opened.url());
  expect(back.status).toBe(200);
  expect(await back.text()).toContain('Signed in. You can close this tab and go back to Bunny AI.');
  await opened.close();

  await expect(row.locator('.tr-l2')).toContainText('Signed in as pat@example.test', { timeout: 10_000 });
  await expect(statusChip(row)).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/connectors-signed-in-desktop.png` });

  await menu(row, 'Sign out');
  await expect(page.locator('#cz-note')).toContainText('was told to end the access');
  await noMenuItem(row, 'Sign out');
  expect(fake.revoked.length).toBeGreaterThan(0);
});

test('a provider that cannot revoke says so when the person signs out', async ({ page, request, baseURL }) => {
  await fake.close();
  fake = await startFake({ idToken: true, revocation: false }, baseURL);
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await menu(row, 'Test');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await comeBack(baseURL, opened.url());
  await opened.close();
  await expect(row.locator('.tr-l2')).toContainText('Signed in as', { timeout: 10_000 });
  await menu(row, 'Sign out');
  await expect(page.locator('#cz-note')).toContainText('has no way to revoke the access');
});

test('a sign-in the person cancels says so and can be tried again', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await menu(row, 'Test');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await comeBack(baseURL, opened.url(), { deny: true });
  await opened.close();
  await expect(statusChip(row)).toHaveText('Sign-in cancelled', { timeout: 10_000 });
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
  await menu(row, 'Test');
  await row.getByRole('button', { name: 'Sign in' }).click();
  await expect(row).toContainText('This service does not let apps register themselves. Paste the client ID from its developer settings.');
  await row.getByLabel(/Client ID/).fill('my-client-id');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Continue' }).click();
  const opened = await popup;
  expect(new URL(opened.url()).searchParams.get('client_id')).toBe('my-client-id');
});

test('on a phone a connector is one tight row: a chip says what needs you, the switch is on the row, Sign in is in the menu, and nothing scrolls sideways', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/src/ui/customize.html');
  const row = page.locator('.cz-row', { hasText: 'Fake docs' });
  await menu(row, 'Test');
  await expect(statusChip(row)).toHaveText('Needs sign-in');
  await expect(row.getByRole('switch')).toBeVisible(); // the switch stays on the row
  await expect(row.getByRole('button', { name: 'Sign in' })).toBeHidden(); // the visible action gives way to the menu on a narrow list
  expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(80); // one tight row, not a card
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(sideways).toBe(false);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/connectors-needs-sign-in-phone.png` });

  const popup = page.waitForEvent('popup');
  await menu(row, 'Sign in');
  const opened = await popup;
  await comeBack(baseURL, opened.url());
  await opened.close();
  await expect(row.locator('.tr-l2')).toContainText('Signed in as', { timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test('the Automation page shows the same status words and can start the sign-in', async ({ page, request, baseURL }) => {
  await addFake(request);
  await page.goto('/src/ui/automation.html');
  const row = page.locator('#mcp-list .tr-row', { hasText: 'Fake docs' });
  await expect(statusChip(row)).toHaveCount(0);
  await menu(row, 'Check tools');
  await expect(statusChip(row)).toHaveText('Needs sign-in');
  const popup = page.waitForEvent('popup');
  await row.getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  await expect(statusChip(row)).toHaveText('Waiting for your browser');
  await comeBack(baseURL, opened.url());
  await opened.close();
  await expect(row.locator('.tr-l2')).toContainText('Signed in as pat@example.test', { timeout: 10_000 });
  await menu(row, 'Sign out');
  await noMenuItem(row, 'Sign out');
});
