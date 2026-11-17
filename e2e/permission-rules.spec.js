import { test, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

import { resetProfile } from './helpers.js';

// W2-7: Settings, Code, "Permission rules". A rule added here changes what the next tool call does (proved on the server in
// test/permission-rules-app.test.js); this walks the screen: tabs, lists, adding, removing, the warnings and "Try a command".

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.put('/api/permission-rules', { data: { global: [], folders: {} } });
});
test.afterAll(async ({ request }) => {
  await request.put('/api/permission-rules', { data: { global: [], folders: {} } });
});

const open = async (page) => {
  await page.goto('/src/ui/settings.html');
  await expect(page.locator('#perm-rules')).toBeVisible();
};
const add = async (page, kind, pattern, effect) => {
  await page.locator('#rules-kind').selectOption(kind);
  await page.locator('#rules-pattern').fill(pattern);
  await page.locator('#rules-effect').selectOption(effect);
  await page.locator('#rules-add-btn').click();
};

test('an empty profile shows three empty lists and the starting points; a starter adds a rule', async ({ page }) => {
  await open(page);
  await expect(page.locator('#perm-rules h3')).toHaveText('Permission rules');
  await expect(page.locator('#rules-lists .rl')).toHaveCount(3);
  await expect(page.locator('#rules-lists .rl.deny .rr.empty')).toHaveText('No rules.');
  await page.getByRole('button', { name: 'Ask before git push*' }).click();
  await expect(page.locator('#rules-lists .rl.ask .pat')).toHaveText('git push*');
  await expect(page.locator('#rules-lists .rl.deny .rr.empty')).toBeVisible();
});

test('adding and removing a rule is saved on the server and survives a reload', async ({ page, request }) => {
  await open(page);
  await add(page, 'command', 'npm run lint*', 'allow');
  await expect(page.locator('#rules-lists .rl.allow .pat')).toHaveText('npm run lint*');
  expect((await (await request.get('/api/permission-rules')).json()).global[0].pattern).toBe('npm run lint*');
  await page.reload();
  await expect(page.locator('#rules-lists .rl.allow .pat')).toHaveText('npm run lint*');
  await page.getByRole('button', { name: 'Remove rule npm run lint*' }).click();
  await expect(page.locator('#rules-lists .rl.allow .rr.empty')).toBeVisible();
  expect((await (await request.get('/api/permission-rules')).json()).global).toEqual([]);
});

test('a path pattern that leaves the folder is refused on the line, and nothing is saved', async ({ page, request }) => {
  await open(page);
  await add(page, 'path:edits', '..\\secrets\\**', 'deny');
  await expect(page.locator('#rules-line')).toContainText('cannot leave the folder');
  await expect(page.locator('#rules-lists .rl.deny .rr.empty')).toBeVisible();
  expect((await (await request.get('/api/permission-rules')).json()).global).toEqual([]);
});

test('an Allow that a Deny already covers is added with a warning, not blocked', async ({ page }) => {
  await open(page);
  await add(page, 'command', 'Remove-Item -Recurse*', 'deny');
  await add(page, 'command', 'Remove-Item -Recurse build', 'allow');
  await expect(page.locator('#rules-line')).toContainText('A Deny rule already covers this: Remove-Item -Recurse*');
  await expect(page.locator('#rules-lists .rl.allow .pat')).toHaveText('Remove-Item -Recurse build');
});

test('Try a command shows the outcome and the rule behind it, without running anything', async ({ page }) => {
  await open(page);
  await add(page, 'command', 'git push*', 'ask');
  await add(page, 'command', 'Remove-Item -Recurse*', 'deny');
  await add(page, 'command', 'npm test*', 'allow');
  const out = page.locator('#rules-try-out');
  await page.locator('#rules-try').fill('git push origin main');
  await expect(out).toContainText('Ask');
  await expect(out).toContainText('git push*');
  await page.locator('#rules-try').fill('Remove-Item -Recurse build');
  await expect(out).toContainText('Denied');
  await page.locator('#rules-try').fill('npm test --watch');
  await expect(out).toContainText('Allowed');
  await page.locator('#rules-try').fill('node scripts/tidy.js');
  await expect(out).toContainText('No rule');
  await expect(out).toContainText('The mode decides.');
});

test('the folder tab: its own rules, with the global ones shown beside them tagged "All folders"', async ({ page, request }) => {
  const folder = mkdtempSync(join(tmpdir(), 'bunny-rules-ui-'));
  await request.put('/api/permission-rules', { data: { global: [{ kind: 'command', effect: 'deny', pattern: 'rm *' }], folders: { [folder]: [{ kind: 'command', effect: 'allow', pattern: 'npm test*' }] } } });
  await open(page);
  await page.locator('#rules-tab-folder').click();
  await expect(page.locator('#rules-folder-wrap')).toBeVisible();
  await expect(page.locator('#rules-lists .rl.allow .pat')).toHaveText('npm test*');
  await expect(page.locator('#rules-lists .rl.deny .rr', { hasText: 'rm *' }).locator('.chip')).toHaveText('All folders');
  await expect(page.locator('#rules-lists .rl.deny .rr', { hasText: 'rm *' }).getByRole('button')).toHaveCount(0); // global rules are removed on their own tab
  await page.locator('#rules-tab-all').click();
  await expect(page.locator('#rules-lists .rl.allow .rr.empty')).toBeVisible();
});

test('the screen is readable on a phone: no sideways scroll, and every control reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(wide).toBe(false);
  await expect(page.locator('#rules-add-btn')).toBeVisible();
});
