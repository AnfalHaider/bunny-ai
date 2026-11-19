import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resetProfile } from './helpers.js';
import { scenes, FIXED_TIME } from './pictures/scenes.mjs';

// PICTURE-CHECK: every help picture is drawn again, from the invented profile, and must match the committed picture (docs/images/<name>). The committed picture IS the reference.
// `npm run pictures` draws them again into docs/images (only when the server reports an invented profile). See docs/images/pictures.json for what each entry means.
const manifest = JSON.parse(readFileSync(new URL('../docs/images/pictures.json', import.meta.url), 'utf8'));
const entries = Object.entries(manifest).filter(([, e]) => !Object.hasOwn(e, 'exempt'));
const BUDGET_MS = 60_000;
const started = Date.now();

test.afterAll(() => {
  const took = Date.now() - started;
  if (took > BUDGET_MS) throw new Error(`pictures took ${Math.round(took / 1000)}s, over the ${BUDGET_MS / 1000}s budget: make the slow scene faster, never skip it`);
});

test.beforeAll(async ({ request }) => {
  const health = await (await request.get('/api/health')).json();
  if (!health.fake) throw new Error('refusing: this is not an invented profile (the server must run with BUNNY_FAKE_UPSTREAM=1)');
});

/** What every scene starts from: an empty invented profile named Sam, with the fixed fonts, motion and theme. */
async function begin(page, request, entry) {
  await resetProfile(request);
  await request.put('/api/settings', { data: {
    displayName: 'Sam', callName: 'Sam', theme: entry.theme, interfaceFont: 'inter', responseFont: 'inter', codeFont: 'Bunny JetBrains Mono', motion: 'reduced',
    transcriptSize: 'medium', transcriptWidth: 'narrow', language: 'en',
  } });
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  // the app's own random picks (the working-line words, greetings) come from a fixed sequence: the same screen every run
  await page.addInitScript(() => { let seed = 20260115; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; });
  await page.addInitScript(() => { try { localStorage.setItem('bunny.workMode', 'chat'); localStorage.setItem('bunny.modelAuto', '1'); localStorage.setItem('bunny.rail', '1'); } catch { /* storage blocked */ } });
}

for (const [name, entry] of entries) {
  test.describe(name, () => {
    test.use({ viewport: { width: entry.viewport[0], height: entry.viewport[1] }, colorScheme: entry.theme, deviceScaleFactor: 1 });
    test(`${name} matches its screen`, async ({ page, request, baseURL }) => {
      const scene = scenes[entry.scene];
      expect(scene, `${name}: the scene "${entry.scene}" is not in e2e/pictures/scenes.mjs`).toBeTruthy();
      await begin(page, request, entry);
      const cleanups = [];
      const api = {
        request,
        cleanup: (fn) => cleanups.push(fn),
        base: baseURL,
        seed: async (chat) => (await (await request.post('/api/sessions', { data: chat })).json()),
        open: async (url) => { await page.goto(url); await page.evaluate(() => document.fonts?.ready); },
      };
      try { await scene(page, api, entry);
      await page.evaluate(() => document.fonts?.ready);
      const cap = entry.capture ?? 'viewport';
      const target = cap === 'viewport' || cap.clip ? page : page.locator(cap.locator).first();
      const options = { maxDiffPixelRatio: entry.tolerance ?? 0.0001, threshold: 0.2, animations: 'disabled', caret: 'hide', scale: 'css', ...(cap.clip ? { clip: { x: cap.clip[0], y: cap.clip[1], width: cap.clip[2], height: cap.clip[3] } } : {}) };
      await expect(target, `${name}: this picture no longer matches its screen (${entry.alt})`).toHaveScreenshot(name, options);
      } catch (error) {
        await page.screenshot({ path: `test-results/pictures-failed-${name}`, fullPage: false }).catch(() => {}); // what the page showed when the scene failed (never committed)
        throw error;
      } finally { for (const fn of cleanups.reverse()) await fn().catch(() => {}); }
    });
  });
}
