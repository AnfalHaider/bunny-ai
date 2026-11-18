import { test, expect } from '@playwright/test';

// "Use Bunny in a browser" (the Desktop app section) belongs to the Desktop app tab only. Since 0.1.12 it showed under every Settings tab, because the page switched
// it on whatever tab it had been opened for. Each tab is its own page (settings.html?embed=1&section=<tab>).
const DESKTOP_BRIDGE = () => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; };

for (const [label, bridge] of [['a browser tab', false], ["Bunny's own window", true]]) {
  test(`${label}: the Desktop app section ("Use Bunny in a browser") shows in its own tab and in no other Settings tab`, async ({ page }) => {
    if (bridge) await page.addInitScript(DESKTOP_BRIDGE);
    for (const tab of ['appearance', 'notifications', 'connection', 'models', 'about']) {
      await page.goto(`/src/ui/settings.html?embed=1&section=${tab}`);
      await expect(page.locator(`section[data-section="${tab}"]`)).toBeVisible();
      await page.waitForTimeout(500); // the page starts the Desktop app section after it loads: give it the chance to (wrongly) show itself
      await expect(page.locator('#desktop-section'), tab).toBeHidden();
      await expect(page.locator('#browser-section'), tab).toBeHidden();
      await expect(page.getByText('Use Bunny in a browser'), tab).toBeHidden();
      await expect(page.locator('#install-row'), tab).toBeHidden();
    }
    await page.goto('/src/ui/settings.html?embed=1&section=desktop');
    await expect(page.locator('#desktop-section')).toBeVisible();
    await expect(page.locator('#browser-section')).toBeVisible();
    await expect(page.locator(bridge ? '#open-browser-pointer' : '#install-row')).toBeVisible();
  });
}
