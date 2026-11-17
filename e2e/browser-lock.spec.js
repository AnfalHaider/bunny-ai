import { test, expect } from '@playwright/test';

// BROWSER (Design's drawing): in a browser, where the server keeps window-only changes to Bunny's window, every control that makes one is switched off, greyed, and says
// "Change this in Bunny's window." beside it; a refused write puts the value back; and the page logs no uncaught error. In the plain web build (lock off) nothing is locked.
const SENTENCE = "Change this in Bunny's window.";
const locked = async (page) => page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, fake: true, windowOnlyLock: true }) }));

test('a Settings page in a browser: the window-only controls are disabled, greyed and say why; ordinary ones stay on; no uncaught error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await locked(page);
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  const mode = page.locator('#default-permission');
  await expect(mode).toBeDisabled();
  await expect(mode).toHaveCSS('opacity', '0.5');
  await expect(mode).toHaveAttribute('title', SENTENCE);
  await expect(page.locator('#default-permission').locator('xpath=following-sibling::*[contains(@class,"window-only-note")] | xpath=../following-sibling::*[contains(@class,"window-only-note")] | xpath=../*[contains(@class,"window-only-note")]').first()).toHaveText(SENTENCE);
  // the permission rules block: every control off, the sentence once at its top
  const rules = page.locator('#perm-rules');
  for (const c of await rules.locator('input, select, textarea, button').all()) await expect(c).toBeDisabled();
  await expect(rules.locator('.window-only-note')).toHaveCount(1);
  // a window-only switch is off; an ordinary one is not
  await expect(page.locator('[data-cap="connectorsEnabled"]')).toBeDisabled();
  await expect(page.locator('[data-cap="computerUseEnabled"]')).toBeDisabled();
  await expect(page.locator('[data-cap="artifactsEnabled"]')).toBeEnabled();
  await expect(page.locator('#instructions')).toBeDisabled();
  expect(errors.filter((m) => /Change this in Bunny's window/.test(m)), 'no uncaught "Change this in Bunny\'s window." error').toEqual([]);
});

test('Customize, Providers and Automation in a browser: everything that changes something is off; the tabs still work', async ({ page }) => {
  await locked(page);
  await page.goto('/src/ui/customize.html?embed=1');
  await expect(page.locator('.cz-tab').first()).toBeEnabled();
  await page.waitForTimeout(600);
  for (const b of await page.locator('main button:not([role="tab"]):not([data-scope]):not([data-kind])').all()) await expect(b).toBeDisabled();
  await page.goto('/src/ui/providers.html?embed=1');
  await page.waitForTimeout(600);
  for (const b of await page.locator('main button, main input, main select').all()) await expect(b).toBeDisabled();
});

test('a write the server refuses puts the value back, and says the sentence once', async ({ page }) => {
  await locked(page);
  await page.goto('/src/ui/settings.html?embed=1&section=appearance');
  const theme = page.locator('#theme');
  await expect(theme).toBeEnabled(); // an ordinary control
  const start = await theme.inputValue();
  await theme.focus();
  await theme.selectOption(start === 'dark' ? 'light' : 'dark');
  // the page's own write was refused by the server: the app tells the page, and the control goes back
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('bunny:window-only-refused')));
  await expect(theme).toHaveValue(start);
});

test('on a server without the lock (the plain web build) nothing is switched off', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  await expect(page.locator('#default-permission')).toBeEnabled();
  await expect(page.locator('.window-only-note')).toHaveCount(0);
});
