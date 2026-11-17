import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// W4-11 S-4: the skills that are on appear in the slash menu as /name, and a message that starts with one carries useSkill.
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.post('/api/skills', { data: { name: 'Carrot Math', description: 'Count carrots the careful way', instructions: 'Count them twice.', enabled: true } });
  await request.post('/api/skills', { data: { name: 'Pear Tips', description: 'About pears', instructions: 'Ripe pears give a little.', enabled: true } });
  await request.post('/api/skills', { data: { name: 'Quiet One', description: 'Switched off', instructions: 'x', enabled: false } });
});

test('typing / lists the commands and the skills that are on, and a skill fills the box', async ({ page }) => {
  await page.goto('/');
  await page.locator('#input').fill('/');
  const menu = page.locator('#slash');
  await expect(menu).toContainText('/carrot-math');
  await expect(menu).toContainText('Count carrots the careful way');
  await expect(menu).toContainText('/pear-tips');
  await expect(menu).toContainText('/compact'); // the commands are still there
  await expect(menu).not.toContainText('/quiet-one'); // a skill that is off is not
  await menu.locator('.slash-item', { hasText: '/carrot-math' }).click();
  await expect(page.locator('#input')).toHaveValue('/carrot-math ');
  await page.locator('#input').pressSequentially('count these');
  await expect(menu).toBeHidden(); // once the request is being typed there is nothing to choose
});

test('a message that starts with a skill name is sent with useSkill, and Enter does not swallow the request', async ({ page }) => {
  const sent = [];
  await page.route('**/api/sessions/*/messages', async (route) => { sent.push(route.request().postDataJSON()); await route.continue(); });
  await page.goto('/');
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel [role="option"][data-model]:not([data-section])').first().click();
  await page.locator('#input').fill('/pear-tips');
  await page.locator('#input').pressSequentially(' what about ripe ones');
  await page.locator('#input').press('Enter');
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent[0].content).toBe('/pear-tips what about ripe ones');
  expect(sent[0].useSkill).toBe('Pear Tips');
});
