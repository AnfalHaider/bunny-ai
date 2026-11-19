/** QA v0.1.14: the curated pictures for the phone-layout findings (invented name "Pat"). node e2e/w0114-shots.mjs <outDir> */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, wait } from './w0114-harness.mjs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const h = await startHarness();
const shot = async (name, w, hh, theme, steps) => {
  const ctx = await h.browser.newContext({ viewport: { width: w, height: hh }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: theme, userAgent: UA }); const p = await ctx.newPage();
  await p.goto(h.local + '/src/ui/index.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#input'); await wait(900);
  try { await steps(p); } catch (e) { console.log('step failed', name, String(e.message).slice(0, 80)); }
  await wait(600); await p.screenshot({ path: join(OUT, name + '.png') }); await ctx.close(); console.log('shot', name);
};
const sb = async (p) => { await p.locator('#sidebar-toggle').click(); await wait(800); };
try {
  await shot('F1-topbar-360x640-light', 360, 640, 'light', async () => {});
  await shot('F1-topbar-390x740-light', 390, 740, 'light', async () => {});
  await shot('F1-topbar-412x740-light', 412, 740, 'light', async () => {});
  await shot('F1-topbar-390x740-dark', 390, 740, 'dark', async () => {});
  await shot('F1-ok-720x740-light', 720, 740, 'light', async () => {});
  await shot('F2-jobmenu-412x740-light', 412, 740, 'light', async (p) => { await p.locator('#job-button').click(); });
  await shot('F2-jobmenu-360x640-dark', 360, 640, 'dark', async (p) => { await p.locator('#job-button').click(); });
  await shot('F5-settings-360x640-dark', 360, 640, 'dark', async (p) => { await sb(p); await p.locator('#settings-open').click(); await wait(1500); });
  await shot('F6-sidebar-landscape-640x360-light', 640, 360, 'light', sb);
  await shot('F6-accountmenu-landscape-640x360-light', 640, 360, 'light', async (p) => { await sb(p); await p.locator('#account-button').click(); });
  await shot('F8-chat-landscape-640x360-dark', 640, 360, 'dark', async (p) => { await p.goto(h.local + `/src/ui/index.html?s=${h.chatId}`); await wait(1500); });
  await shot('F9-keyboard-typed-360x340-light', 360, 340, 'light', async (p) => { await p.locator('#input').fill('Typing with the keyboard open, a few words that wrap onto more lines than one.'); });
} finally { await h.close(); process.exit(0); }
