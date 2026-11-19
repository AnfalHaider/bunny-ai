/**
 * Shared steps for the Playwright specs.
 *
 * Everything here goes through the same UI and the same public API a person
 * uses. There is no test-only back door: if a helper can reach it, a person
 * can reach it too.
 */

import { expect } from '@playwright/test';

/**
 * Put the profile back to empty.
 *
 * The whole run shares one server, and BUNNY_RESET_PROFILE=1 only empties the
 * profile at boot. A test that connects a provider would otherwise leak into
 * every later test, so each test cleans up through the same API.
 */
export async function resetProfile(request) {
  const providers = await (await request.get('/api/providers')).json();
  for (const p of providers) {
    if (p.status === 'connected' || p.status === 'error') {
      await request.post(`/api/providers/${p.id}/disconnect`);
    }
  }
  const sessions = await (await request.get('/api/sessions?archived=1')).json();
  for (const s of sessions) await request.delete(`/api/sessions/${s.id}`);
  const artifacts = await (await request.get('/api/artifacts')).json();
  for (const a of artifacts) await request.delete(`/api/artifacts/${a.id}`);
  const projects = await (await request.get('/api/projects')).json();
  for (const p of projects) await request.delete(`/api/projects/${p.id}`);

  // The automation stores live in the same profile.
  const memories = await (await request.get('/api/memory')).json();
  for (const m of memories) await request.delete(`/api/memory/${m.id}`);
  const servers = await (await request.get('/api/mcp')).json();
  for (const s of servers) await request.delete(`/api/mcp/${s.id}`);
  const tasks = await (await request.get('/api/schedules')).json();
  for (const s of tasks) await request.delete(`/api/schedules/${s.id}`);
  const hookRows = await (await request.get('/api/hooks')).json();
  for (const h of hookRows) await request.delete(`/api/hooks/${h.id}`);
  const skillRows = await (await request.get('/api/skills')).json();
  for (const s of skillRows) await request.delete(`/api/skills/${s.id}`);

  // Settings are part of the profile too: a test that changes the language
  // must not change it for the next one.
  await request.put('/api/settings', {
    data: {
      language: 'en', theme: 'system', allowlist: [], aliases: {}, notifications: false,
      // the run limits and the wait are Settings too (0 means Off): back to the defaults, so a chat that runs past its step limit behaves the same in every spec
      autoContinueSteps: 500, autoContinueMinutes: 120, firstReplyWaitSeconds: 30, fallbackWhenBusy: true,
      // The tests chat through a test Anthropic provider, so every model is shown.
      modelFilter: 'all',
    },
  });
}

/** Connect Anthropic through the providers screen, as a person would. */
export async function connectAnthropic(page) {
  await page.goto('/src/ui/providers.html');
  await page.waitForSelector('#available .row');
  await page.getByRole('button', { name: 'Connect Anthropic' }).click();
  await expect(page.locator('#f-anthropic-apiKey')).toBeVisible();
  await page.locator('#f-anthropic-apiKey').fill('sk-test-000000000000');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('#connected')).toContainText('Anthropic');
}

/** Choose the first model in the picker. */
export async function pickFirstModel(page) {
  await page.locator('#picker-button').click();
  const option = page.locator('.picker-panel [role="option"]').first();
  await expect(option).toBeVisible();
  const modelId = await option.getAttribute('data-model');
  await option.click();
  return modelId;
}

/**
 * Open the chat screen, pick a model and send one message.
 * Waits for the stream to finish, not just to start.
 */
export async function chat(page, text) {
  await page.goto('/');
  await pickFirstModel(page);
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
  await expect(page.locator('.msg.user .body').last()).toHaveText(text);
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('…', { timeout: 15_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
}

/** Connect a provider and send one message. */
export async function connectAndChat(page, text) {
  await connectAnthropic(page);
  await chat(page, text);
}
