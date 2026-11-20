import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectAnthropic, pickFirstModel, resetProfile } from './helpers.js';

// ENGINE-SWITCH (drawing v2) and FOLDER-RULES v4 (drawing v4), the screens: the trust card in the chat, the Project instructions block of the Working folder card (in use, changed since it was read, the
// diff in Read again, Keep the old text), the switch menu on the engine chip, its confirm card and the divider "Now on Codex CLI". Invented profile, stand-in engines, invented folder.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {});
  await request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true, folderRulesEnabled: true, folderRulesTrusted: [] } }).catch(() => {});
});
test.afterEach(async ({ request }) => {
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {});
  await request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true, folderRulesTrusted: [] } }).catch(() => {});
});

async function codeChat(request, folder) {
  expect((await request.post('/api/folder/check', { data: { folder } })).ok()).toBeTruthy();
  const made = await (await request.post('/api/sessions', { data: { title: 'Instructions', workMode: 'code', folder, permissionMode: 'auto' } })).json();
  return made.id;
}

test('the trust card appears for a folder with instruction files; Read shows the text; Follow them closes it; the Working folder card lists the file as in use, then "changed since it was read" with the diff in Read again', async ({ page, request }) => {
  const folder = mkdtempSync(join(tmpdir(), 'bunny-fr-ui-'));
  writeFileSync(join(folder, 'AGENTS.md'), 'Use tabs.\nSay hello.\n');
  writeFileSync(join(folder, 'CLAUDE.md'), 'A different rule.\n');
  await connectAnthropic(page);
  const id = await codeChat(request, folder);
  await page.goto(`/?s=${id}`);
  const card = page.locator('#fr-trust-card');
  await expect(card).toContainText('This folder has instruction files');
  await expect(card).toContainText('AGENTS.md');
  await card.getByRole('button', { name: 'Follow them' }).click();
  const dlg = page.locator('.folder-rules-modal');
  await expect(dlg).toContainText('Bunny, Claude Code and Codex CLI all get the same text');
  await expect(dlg).toContainText('CLAUDE.md');
  await expect(dlg).toContainText('not used');
  await dlg.getByRole('button', { name: 'Read' }).click();
  await expect(dlg.locator('.fr-view')).toContainText('Use tabs.');
  await dlg.getByRole('button', { name: 'Follow them' }).click();
  await expect(card).toHaveCount(0);

  await page.locator('#folder-chip').click();
  const wf = page.locator('.modal[aria-label="Working folder"]');
  await expect(wf.locator('.fr-block')).toContainText('Project instructions');
  await expect(wf.locator('.fr-row:has(.fr-n:text-is("AGENTS.md"))')).toContainText('in use');
  await expect(wf.locator('.fr-row:has(.fr-n:text-is("CLAUDE.md"))')).toContainText('not used');
  await expect(wf.locator('.fr-note')).toContainText('Followed for this folder');
  await wf.getByRole('button', { name: 'Close' }).click();

  // somebody changes the file: the card says so, every engine keeps the frozen text, and Read again shows the difference first
  writeFileSync(join(folder, 'AGENTS.md'), 'Use tabs.\nSay goodbye.\n');
  await page.locator('#folder-chip').click();
  await expect(page.locator('.modal[aria-label="Working folder"] .fr-row:has(.fr-n:text-is("AGENTS.md"))')).toContainText('changed since it was read');
  await page.locator('.modal[aria-label="Working folder"]').getByRole('button', { name: 'Read again' }).click();
  const diff = page.locator('.folder-rules-modal .fr-diff');
  await expect(diff).toContainText('- Say hello.');
  await expect(diff).toContainText('+ Say goodbye.');
  await page.locator('.folder-rules-modal').getByRole('button', { name: 'Keep the old text' }).click();
  await expect(page.locator('.modal[aria-label="Working folder"] .fr-row:has(.fr-n:text-is("AGENTS.md"))')).toContainText('changed since it was read'); // Keep the old text changes nothing (the Working folder card is still open behind)
});

test('Not now closes the trust card; the engine chip offers "Switch this chat to…" with the reasons, the confirm card says what Codex gets, and the divider "Now on Codex CLI" shows', async ({ page, request }) => {
  const folder = mkdtempSync(join(tmpdir(), 'bunny-sw-ui-'));
  writeFileSync(join(folder, 'AGENTS.md'), 'Keep prices in cents.\n');
  await connectAnthropic(page);
  const id = await codeChat(request, folder);
  await page.goto(`/?s=${id}`);
  await page.locator('#fr-trust-card').getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('#fr-trust-card')).toHaveCount(0);
  await pickFirstModel(page);
  await page.locator('#input').fill('hello there');
  await page.locator('#send').click();
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('…', { timeout: 15_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  // an engine downloaded makes the chip appear; Claude Code is not downloaded: its row says so with the button that fixes it
  expect((await request.post('/api/engines/codex/download', { data: {} })).status()).toBe(202);
  await expect.poll(async () => (await (await request.get('/api/engines')).json()).engines.find((e) => e.id === 'codex').downloaded, { timeout: 15_000 }).toBe(true);
  await page.reload();
  const chip = page.locator('#engine-chip');
  await expect(chip).toBeVisible();
  await chip.click();
  const menu = page.locator('#engine-menu');
  await expect(menu).toContainText('Switch this chat to…');
  await expect(menu.locator('.es-row', { hasText: 'Bunny' })).toContainText('now');
  await expect(menu.locator('.es-row', { hasText: 'Claude Code' })).toContainText('Not downloaded');
  await expect(menu.locator('.es-row', { hasText: 'Claude Code' }).getByRole('button', { name: 'Download' })).toBeVisible();
  await menu.locator('.es-row', { hasText: 'Codex CLI' }).getByRole('button', { name: 'Switch' }).click();
  const card = page.locator('.engine-switch-card');
  await expect(card).toContainText('Switch this chat to Codex CLI?');
  await expect(card).toContainText("Codex CLI follows Bunny's rules.");
  await expect(card).toContainText("this chat's folder");
  await expect(card).toContainText('Not followed yet'); // the folder's files were answered "Not now": the card never promises them
  await expect(card).not.toContainText('its instruction files');
  await expect(card).toContainText('Your files and Undo stay as they are.');
  await card.getByRole('button', { name: 'Switch to Codex CLI' }).click();
  await expect(page.locator('.es-divider')).toContainText('Now on Codex CLI');
  await expect(page.locator('#engine-chip .engine-text')).toContainText('Codex CLI');
  const chat = await (await request.get(`/api/sessions/${id}`)).json();
  expect(chat.engine.id).toBe('codex');
});
