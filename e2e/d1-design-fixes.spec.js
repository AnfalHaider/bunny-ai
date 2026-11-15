import { test, expect } from '@playwright/test';

import { resetProfile } from './helpers.js';

// D1 (design review 0.1.4): five small screen fixes the owner approved on 2026-11-16.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('with no model, the empty chat offers one "Add a provider" button', async ({ page }) => {
  await page.goto('/');
  const cta = page.locator('#empty-text a.empty-cta');
  await expect(cta).toHaveText('Add a provider');
  await expect(cta).toHaveAttribute('href', './providers.html');
  await expect(page.locator('#empty-text')).not.toContainText('No models yet');
});

test('the custom provider form comes before Popular providers', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  const order = await page.evaluate(() => [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim()));
  expect(order.findIndex((t) => /custom provider/i.test(t))).toBeGreaterThan(order.findIndex((t) => /Connected/.test(t)));
  expect(order.findIndex((t) => /custom provider/i.test(t))).toBeLessThan(order.findIndex((t) => /Popular/.test(t)));
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Settings section list is one sideways row of pills', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.getElementById('settings-open').click());
    const list = page.locator('#settings-nav-list');
    await expect(list).toBeVisible();
    expect(await list.evaluate((el) => getComputedStyle(el).flexDirection)).toBe('row');
    expect(await page.locator('#settings-search').isVisible()).toBe(false);
    const row = page.locator('#settings-nav-list .nav-row').first();
    expect(await row.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px');
  });

  test('every Add button on Automation is full width', async ({ page }) => {
    await page.goto('/src/ui/automation.html');
    const buttons = page.locator('.automation-page button.primary[type="submit"]');
    const n = await buttons.count();
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < n; i += 1) {
      const [w, parent] = await buttons.nth(i).evaluate((el) => { const cs = getComputedStyle(el.parentElement); return [el.getBoundingClientRect().width, el.parentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)]; });
      expect(Math.abs(w - parent)).toBeLessThan(2);
    }
  });
});

test('the hopping bunny takes its colour from the accent tokens', async ({ page }) => {
  await page.goto('/');
  const fills = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'bunny-working';
    host.innerHTML = '<svg class="bunny-mark"><path class="ear"/><path class="face"/><circle class="eye"/><circle class="nose"/></svg>';
    document.body.append(host);
    const css = (sel, prop) => getComputedStyle(host.querySelector(sel))[prop];
    const probe = document.createElement('i');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    return { face: css('.face', 'fill'), accent: getComputedStyle(probe).color, ear: css('.ear', 'fillOpacity'), eye: css('.eye', 'fill') };
  });
  expect(fills.face).toBe(fills.accent);
  expect(fills.ear).toBe('0.55');
  expect(fills.eye).not.toBe(fills.face);
});
