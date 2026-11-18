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

// Every Settings tab shows its own section and nothing of another one (owner: "only shown in its own category").
const TABS = ['profile', 'usage', 'appearance', 'bunny', 'language', 'notifications', 'privacy', 'capabilities', 'models', 'connection', 'code', 'desktop', 'about'];
for (const [label, bridge] of [['a browser tab', false], ["Bunny's own window", true]]) {
  test(`${label}: every Settings tab shows only its own section, and every visible group, row and note sits inside it`, async ({ page }) => {
    test.setTimeout(120000);
    if (bridge) await page.addInitScript(DESKTOP_BRIDGE);
    for (const tab of TABS) {
      await page.goto(`/src/ui/settings.html?embed=1&section=${tab}`);
      await expect(page.locator(`section[data-section="${tab}"]`)).toBeVisible();
      await page.waitForTimeout(600); // the page's scripts show and hide parts after it loads
      const leaks = await page.evaluate((own) => {
        const shown = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
        const out = [];
        for (const s of document.querySelectorAll('section[data-section]')) if (s.dataset.section !== own && shown(s)) out.push(`section ${s.dataset.section} is visible`);
        // anything visible in the page body that is not inside the tab's own section (the page's title and the browser note are the page's, not a setting)
        for (const el of document.querySelectorAll('main .group, main .row, main h2, main h3, main .kv, main input, main select, main textarea, main button')) {
          if (!shown(el)) continue;
          const owner = el.closest('section[data-section]');
          if (owner?.dataset.section !== own) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || el.value || '').trim().slice(0, 40)}" is in ${owner ? owner.dataset.section : 'no section'}`);
        }
        return out;
      }, tab);
      expect(leaks, `tab ${tab}`).toEqual([]);
    }
  });
}
