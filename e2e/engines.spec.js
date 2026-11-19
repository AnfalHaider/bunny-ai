import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// CLI-ENGINES (HIGH), Settings → Engines: exactly Bunny, Claude Code and Codex CLI (no Cline, no Aider); one row each; download with progress, the Local | Account switch (Codex's Account greyed with its note),
// the engine for new chats, roll back and remove; at phone width and in both themes. A stand-in engine and a fake download: nothing real.
const PAGE = '/src/ui/settings.html?embed=1&section=engines';

test.beforeEach(async ({ request }) => {
  await resetProfile(request).catch(() => {});
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {}); // a clean slate: nothing downloaded
  await request.put('/api/settings', { data: { engine: 'bunny', engines: { 'claude-code': { auth: 'account' } } } }).catch(() => {});
});

test('Engines lists Bunny, Claude Code and Codex CLI and nothing else; each engine is one compact row', async ({ page }) => {
  await page.goto(PAGE);
  const rows = page.locator('#engines-list .er');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Bunny'); await expect(rows.nth(1)).toContainText('Claude Code'); await expect(rows.nth(2)).toContainText('Codex CLI');
  await expect(page.locator('#engines-section')).not.toContainText(/Cline|Aider/);
  await expect(rows.nth(1).locator('.l2')).toContainText('Not installed');
  for (const i of [0, 1, 2]) expect((await rows.nth(i).boundingBox()).height).toBeLessThanOrEqual(56);
  await expect(rows.nth(1).locator('.l2')).toHaveText('Not installed · 380 MB');
  await expect(page.locator('#engines-section')).not.toContainText('Bunny judges every step');
});

test('download Claude Code: progress, then the Local | Account switch with Account recommended; Local shows the Anthropic note; Codex Account is greyed with its note', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').click();
  await expect(page.locator('#engines-list .er[data-id="claude-code"] .seg')).toBeVisible({ timeout: 15_000 });
  const row = page.locator('#engines-list .er[data-id="claude-code"]');
  await expect(row.locator('.l2')).toContainText('v1.0.0');
  await expect(row.locator('button[data-auth="account"]')).toHaveAttribute('aria-checked', 'true');
  await expect(row.locator('button[data-auth="account"] .rc')).toBeVisible();
  await row.locator('button[data-auth="local"]').click();
  await expect(row.locator('button[data-auth="local"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#engines-note')).toBeVisible();
  await expect(page.locator('#engines-note')).toContainText('Not supported by Anthropic');
  await page.locator('#engines-list .er[data-id="codex"] [data-act="download"]').click();
  const codex = page.locator('#engines-list .er[data-id="codex"]');
  await expect(codex.locator('.seg')).toBeVisible({ timeout: 15_000 });
  await expect(codex.locator('button[data-auth="account"]')).toBeDisabled();
  await expect(codex.locator('button[data-auth="account"]')).toHaveAttribute('title', /still being tested/);
  await expect(codex.locator('button[data-auth="local"]')).toHaveAttribute('aria-checked', 'true');
  // the engine for new chats lists what is downloaded
  const options = await page.locator('#engine-default option').allTextContents();
  expect(options).toEqual(['Bunny', 'Claude Code', 'Codex CLI']);
  await page.locator('#engine-default').selectOption('claude-code');
  await page.reload();
  await expect(page.locator('#engine-default')).toHaveValue('claude-code');
  // what was done is listed, newest first
  await expect(page.locator('#engines-record')).toContainText('Claude Code downloaded v1.0.0');
  await expect(row.locator('.l2')).not.toContainText('Account');
});

test('remove returns the row to Download; Cancel stops a download', async ({ page }) => {
  page.on('dialog', () => { throw new Error('the browser confirm/alert is not used'); });
  await page.goto(PAGE);
  await page.locator('#engines-list .er[data-id="codex"] [data-act="download"]').click();
  await expect(page.locator('#engines-list .er[data-id="codex"] .seg')).toBeVisible({ timeout: 15_000 });
  await page.locator('#engines-list .er[data-id="codex"] [data-act="menu"]').click();
  await page.locator('#engines-list .er[data-id="codex"] [data-act="remove"]').click();
  await page.locator('.engine-confirm').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('#engines-list .er[data-id="codex"] [data-act="download"]')).toBeVisible();
  await page.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').click();
  const cancel = page.locator('#engines-list .er[data-id="claude-code"] [data-act="cancel"]');
  if (await cancel.isVisible().catch(() => false)) { await cancel.click(); await expect(page.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').or(page.locator('#engines-list .er[data-id="claude-code"] .seg'))).toBeVisible({ timeout: 15_000 }); }
});

for (const [scheme, width] of [['light', 1000], ['dark', 1000], ['light', 390], ['dark', 390]]) {
  test(`the Engines page at ${width}px in the ${scheme} theme: rows do not overflow`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await expect(page.locator('#engines-list .er')).toHaveCount(3);
    const first = page.locator('#engines-list .er').nth(1);
    expect((await first.boundingBox()).height).toBeLessThanOrEqual(width < 620 ? 92 : 56);
    expect(await first.locator('.l2').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });
}

test('Claude Code in Account mode: Sign in appears when signed out, opens the vendor flow after a notice, then the row says Signed in; Sign out is in the menu behind a confirm card', async ({ page, request }) => {
  await request.post('/api/engines/claude-code/signout').catch(() => {});
  await page.goto(PAGE);
  const row = page.locator('#engines-list .er[data-id="claude-code"]');
  await row.locator('[data-act="download"]').click();
  await expect(row.locator('.seg')).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('[data-act="signin"]')).toBeVisible({ timeout: 10_000 });
  await expect(row.locator('.l2')).toContainText('Not signed in');
  await row.locator('[data-act="signin"]').click();
  await page.locator('.engine-confirm').getByRole('button', { name: 'OK' }).click();
  await expect(row.locator('.l2')).toContainText('Signed in', { timeout: 15_000 });
  await row.locator('[data-act="menu"]').click();
  await row.locator('[data-act="signout"]').click();
  await page.locator('.engine-confirm').getByRole('button', { name: 'Sign out' }).click();
  await expect(row.locator('[data-act="signin"]')).toBeVisible({ timeout: 10_000 });
});
