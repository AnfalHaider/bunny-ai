/**
 * W4-9: the Settings help picture (docs/images/settings-wait.png) and a phone check, from an INVENTED profile.
 *
 *   BUNNY_DATA_DIR=<temp folder> BUNNY_FAKE_UPSTREAM=1 BUNNY_RESET_PROFILE=1 PORT=5461 BUNNY_API_TOKEN=pic node src/server/main.js
 *   BASE=http://127.0.0.1:5461 TOKEN=pic OUT=docs/images node e2e/w4-9-picture.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT ?? 'docs/images', TOKEN = process.env.TOKEN;
if (!(await (await fetch(BASE + '/api/health', { headers: { 'x-bunny-token': TOKEN } })).json()).fake) throw new Error('refusing: not an invented profile');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 860, height: 900 }, colorScheme: 'light', extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
const page = await ctx.newPage();
await page.goto(BASE + '/src/ui/settings.html');
await page.waitForSelector('#wait-select');
const group = page.locator('.group:has(#wait-row)');
await group.scrollIntoViewIfNeeded();
await group.screenshot({ path: `${OUT}/settings-wait.png` });
await page.setViewportSize({ width: 390, height: 900 });
await page.locator('#wait-select').selectOption('custom');
await page.locator('#wait-custom-input').fill('5');
console.log('390px sideways scroll:', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await page.locator('#wait-row').screenshot({ path: process.env.PHONE ?? `${OUT}/../../../tmp-wait-phone.png` });
await browser.close();
