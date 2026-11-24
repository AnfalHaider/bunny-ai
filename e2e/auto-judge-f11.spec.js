import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// AGENT-FLOW F11: the Settings rows for the check on Auto actions: off by default, a switch that saves, a model list with the chat's own model first, and the words that say what it does.
test.afterEach(async ({ request }) => { await request.put('/api/settings', { data: { autoJudgeEnabled: false, autoJudgeModel: '' } }); });

test('Settings, Code: the check on Auto actions is off by default, says what it does, saves its switch, and keeps it after a reload', async ({ page, request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { autoJudgeEnabled: false, autoJudgeModel: '' } });
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  const row = page.locator('#auto-judge-row');
  await expect(row).toContainText('Check Auto actions with a second model');
  await expect(row).toContainText('only your own typed words and the action, never file or page text');
  await expect(row).toContainText('broad Allow rules (such as node*, powershell* or curl*) are not used in Auto');
  const sw = row.locator('input[data-cap="autoJudgeEnabled"]');
  await expect(sw).not.toBeChecked();
  await sw.check();
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).autoJudgeEnabled).toBe(true);
  await page.reload();
  await expect(page.locator('#auto-judge-row input[data-cap="autoJudgeEnabled"]')).toBeChecked();
  await page.locator('#auto-judge-row input[data-cap="autoJudgeEnabled"]').uncheck();
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).autoJudgeEnabled).toBe(false);
});

test('Settings, Code: the model that checks starts as the chat\'s own, names the provider that would receive the checked actions, and saves only a value from the list', async ({ page, request }) => {
  await resetProfile(request);
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  const sel = page.locator('#auto-judge-model');
  await expect(sel).toHaveValue('');
  await expect(page.locator('#auto-judge-model-row')).toContainText('Each checked action is sent to that provider');
  const options = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
  expect(options[0]).toBe('');
  const other = options.find((v) => v !== '');
  if (other) {
    await sel.selectOption(other);
    await expect(page.locator('#auto-judge-note')).toContainText(`Each checked action is sent to ${other.split('/')[0]}`);
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).autoJudgeModel).toBe(other);
  }
  expect((await request.put('/api/settings', { data: { autoJudgeModel: 'not a model' } })).status()).toBe(400);
});
