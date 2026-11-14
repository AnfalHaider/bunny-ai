import { test, expect } from '@playwright/test';

import { resetProfile, connectAnthropic, pickFirstModel } from './helpers.js';

// The automation screen: memory, MCP servers, schedules, hooks and skills.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('a memory can be written and switched off', async ({ page }) => {
  await page.goto('/src/ui/automation.html');

  await page.locator('#memory-text').fill('I prefer short answers');
  await page.getByRole('button', { name: 'Remember' }).click();

  await expect(page.locator('#memory-list')).toContainText('I prefer short answers');
  await expect(page.locator('#memory-list .tag, #memory-list button[aria-pressed="true"]')).toHaveCount(1);

  // Switching it off keeps the memory but stops offering it.
  await page.locator('#memory-list button[aria-pressed="true"]').click();
  await expect(page.locator('#memory-list button[aria-pressed="false"]')).toHaveCount(1);
  await expect(page.locator('#memory-list')).toContainText('I prefer short answers');
});

test('an MCP server is added and refused when it is not an address', async ({ page }) => {
  await page.goto('/src/ui/automation.html');

  await page.locator('#mcp-name').fill('files');
  await page.locator('#mcp-url').fill('not-a-url');
  await page.getByRole('button', { name: 'Add server' }).click();
  await expect(page.locator('#automation-error')).toContainText(/http/i);

  await page.locator('#mcp-url').fill('http://127.0.0.1:9/mcp');
  await page.getByRole('button', { name: 'Add server' }).click();
  await expect(page.locator('#mcp-list')).toContainText('files');
});

test('a schedule is added', async ({ page }) => {
  await page.goto('/src/ui/automation.html');

  await page.locator('#schedule-name').fill('morning digest');
  await page.locator('#schedule-prompt').fill('summarise my day');
  await page.getByRole('button', { name: 'Add schedule' }).click();

  await expect(page.locator('#schedule-list')).toContainText('morning digest');
  await expect(page.locator('#schedule-list')).toContainText('summarise my day');
});

test('a hook is added, and is off until it is switched on', async ({ page }) => {
  await page.goto('/src/ui/automation.html');

  await page.locator('#hook-name').fill('note');
  await page.locator('#hook-command').fill('echo hi');
  await page.getByRole('button', { name: 'Add hook' }).click();

  await expect(page.locator('#hook-list')).toContainText('note');
  // A hook that runs a command is off by default.
  await expect(page.locator('#hook-list button[aria-pressed="false"]')).toHaveCount(1);
});

test('a skill is added and switched on', async ({ page }) => {
  await page.goto('/src/ui/automation.html');

  await page.locator('#skill-name').fill('pirate');
  await page.locator('#skill-description').fill('talk like a pirate');
  await page.locator('#skill-instructions').fill('Answer like a pirate.');
  await page.getByRole('button', { name: 'Add skill' }).click();

  await expect(page.locator('#skill-list')).toContainText('pirate');
  await page.locator('#skill-list button[aria-pressed="false"]').click();
  await expect(page.locator('#skill-list button[aria-pressed="true"]')).toHaveCount(1);
});

test('the automation screen is reachable from the chat screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Automation' })).toBeVisible();
});
