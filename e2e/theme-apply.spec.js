import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// v0.1.13 THEME-APPLY: switching the theme while Settings is open reaches everything at once, with no reload: the chat page, the Settings frame and the pages
// opened in it afterwards, the browser-bar colour, the code colours, the desktop shell (told once), and another copy of Bunny on its next look.
const DARK = '#141518';
const LIGHT = '#faf9f6';

async function state(target) {
  return target.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      theme: root.dataset.theme ?? '',
      bg: getComputedStyle(document.body).backgroundColor,
      scheme: cs.colorScheme,
      meta: (document.querySelector('meta[name="theme-color"]:not([media])') ?? document.querySelector('meta[name="theme-color"]'))?.content ?? null,
      codeBg: cs.getPropertyValue('--code-bg').trim(),
      keyword: cs.getPropertyValue('--tk-keyword').trim(),
    };
  });
}
// the page background is one of the theme's surface colours: dark ones are dark, light ones are light
const lum = (css) => { const m = css.match(/[0-9]+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; };
const looks = (css, theme) => (theme === 'dark' ? lum(css) < 50 : lum(css) > 225);

for (const [os, from, to] of [['light', 'light', 'dark'], ['dark', 'dark', 'light']]) {
  test.describe(`the PC is ${os}: ${from} -> ${to} with Settings open`, () => {
    test.use({ colorScheme: os });
    test(`everything follows at once`, async ({ page, request, context }) => {
      await resetProfile(request);
      await request.put('/api/settings', { data: { theme: from, codeThemeLight: 'github-light', codeThemeDark: 'dracula' } });
      await page.addInitScript(() => { window.__told = []; window.bunnyDesktop = { platform: 'win32', setTheme: (t) => { window.__told.push(t); return Promise.resolve({ ok: true }); }, getPrefs: async () => ({}), zoom: { get: () => 1, set: () => {} } }; });
      let navigations = 0;
      await page.goto('/');
      await page.evaluate(() => { window.__still = 'same page'; });
      page.on('framenavigated', () => { navigations += 1; });
      await expect(page.locator('html')).toHaveAttribute('data-theme', from);
      await page.keyboard.press('Control+,');
      await page.locator('#settings-nav-list [data-section="appearance"]').click();
      const frame = page.frameLocator('#settings-frame');
      await expect(frame.locator('#theme')).toBeVisible();
      await expect(frame.locator('html')).toHaveAttribute('data-settings-filled', '1'); // the page has filled its controls from the saved settings
      const settingsFrame = page.frames().find((f) => f.url().includes('settings.html'));
      navigations = 0;

      const before = await state(page);
      expect(before.theme).toBe(from);
      await frame.locator('#theme').selectOption(to);

      const want = to === 'dark' ? { color: DARK, scheme: 'dark', keyword: '#ff79c6', codeBg: '#282a36' } : { color: LIGHT, scheme: 'light', keyword: '#cf222e', codeBg: '#f6f8fa' };
      for (const [name, target] of [['the chat page', page], ['the Settings frame', settingsFrame]]) {
        await expect.poll(async () => (await state(target)).theme, { message: `${name}: theme`, timeout: 3000 }).toBe(to);
        const s = await state(target);
        expect(s.scheme, `${name}: colour scheme`).toBe(want.scheme);
        expect(looks(s.bg, to), `${name}: background ${s.bg}`).toBe(true);
        expect(s.meta, `${name}: browser-bar colour`).toBe(want.color);
        expect(s.codeBg, `${name}: code background (a chosen code theme for this look)`).toBe(want.codeBg);
        expect(s.keyword, `${name}: code colours`).toBe(want.keyword);
      }
      expect(await page.evaluate(() => window.__still), 'no reload of the chat page').toBe('same page');
      expect(navigations, 'no navigation while the theme changed').toBe(0);
      const told = (await page.evaluate(() => window.__told)).filter((v, k, a) => k === 0 || v !== a[k - 1]);
      expect(told, 'the desktop shell hears the old theme, then the new one, and nothing else').toEqual([from, to]);

      // the page the person opens in the Settings window next (Providers, Automation, My tools) is already in the new theme
      for (const section of ['providers', 'automation', 'customize']) {
        await page.locator(`#settings-nav-list [data-section="${section}"]`).click();
        await expect.poll(() => page.frames().some((fr) => fr.url().includes(`/${section}.html`)), { timeout: 5000 }).toBe(true);
        const f = page.frames().find((fr) => fr.url().includes(`/${section}.html`));
        await f.waitForLoadState('load');
        await expect.poll(async () => (await state(f)).theme, { message: section, timeout: 5000 }).toBe(to);
        expect(looks((await state(f)).bg, to), `${section}: background`).toBe(true);
      }

      // a reload paints in the chosen theme from the first frame (no flash): the page's own boot script has it before the stylesheet is drawn
      await page.reload();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(to);

      // another copy of Bunny (a browser tab) picks the change up on its next look
      const other = await context.newPage();
      await other.goto('/');
      await expect(other.locator('html')).toHaveAttribute('data-theme', to);
      await request.put('/api/settings', { data: { theme: from } });
      await other.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(other.locator('html')).toHaveAttribute('data-theme', from);
      expect(looks((await state(other)).bg, from)).toBe(true);
      await request.put('/api/settings', { data: { theme: 'system' } });
    });
  });
}

test('System removes the chosen browser-bar colour and the shell is told "system"', async ({ page, request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { theme: 'dark' } });
  await page.addInitScript(() => { window.__told = []; window.bunnyDesktop = { platform: 'win32', setTheme: (t) => { window.__told.push(t); }, getPrefs: async () => ({}), zoom: { get: () => 1, set: () => {} } }; });
  await page.goto('/');
  await page.keyboard.press('Control+,');
  await page.locator('#settings-nav-list [data-section="appearance"]').click();
  // the Settings page fills its controls from the saved settings when it has loaded; choosing before that would be undone by it (a person cannot be that quick)
  await expect(page.frameLocator('#settings-frame').locator('html')).toHaveAttribute('data-settings-filled', '1');
  await expect(page.frameLocator('#settings-frame').locator('#theme')).toHaveValue('dark');
  await page.frameLocator('#settings-frame').locator('#theme').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', '');
  await expect(page.locator('#bunny-theme-color')).toHaveCount(0);
  expect((await page.evaluate(() => window.__told)).at(-1)).toBe('system');
  await request.put('/api/settings', { data: { theme: 'system' } });
});
