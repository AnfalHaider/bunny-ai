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
    transcriptSize: 'medium', transcriptWidth: 'narrow', language: 'en', codeThemeLight: 'bunny-light', codeThemeDark: 'bunny-dark', autoContinueSteps: 500, autoContinueMinutes: 120, firstReplyWaitSeconds: 30, fallbackWhenBusy: true,
    // the shipped defaults of what a scene may have changed (resetProfile does not touch settings, so one scene's change would reach the next picture): the Auto check on, instruction files followed and not yet trusted, Bunny's own engine
    autoJudgeEnabled: true, folderRulesEnabled: true, folderRulesTrusted: [], engine: 'bunny', useBunnyEngine: true,
    // the same for the rest a screen can show (the gate runs this after the other specs, on the same server, and they leave settings behind): explicit, because the e2e server's own default for the confine setting is off
    // null is "never set", which is what a fresh install has (a chat made without a mode starts in Manual there; Settings draws that row as Smart): not a value the person chose
    defaultPermissionMode: null, transcriptView: null, statusLabels: null,
    // the e2e profile shows every model (every spec sets this to 'all'; the committed pictures were drawn that way), and no model, allow-list or alias carried over from a spec
    modelFilter: 'all', providerId: null, model: null, allowlist: [], aliases: {},
    confineCommands: 'auto', pcSearchEnabled: true, pcSearchAfter: 'show', pcSearchBarAuto: true, pcSearchExcluded: [], pcSearchNoticeShown: false, autoJudgeModel: '', updateUrl: '',
  } });
  // the folders an earlier spec trusted for Auto are listed in Settings, Permissions: none on a fresh profile
  for (const f of (await (await request.get('/api/folder-trust')).json()).folders ?? []) await request.delete('/api/folder-trust', { data: { folder: f.folder } });
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  // the app's own random picks (the working-line words, greetings) come from a fixed sequence: the same screen every run
  await page.addInitScript(() => { let seed = 20260115; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; });
  await page.addInitScript(() => { try { localStorage.setItem('bunny.workMode', 'chat'); localStorage.setItem('bunny.modelAuto', '1'); localStorage.setItem('bunny.rail', '1'); } catch { /* storage blocked */ } });
}

/**
 * Wait for the real condition before a picture is taken: a font starts loading only when text that uses it is laid out, so `document.fonts.ready` alone can answer before the scene's own text (code in
 * the code font, a late chat) has asked for its font. Force a layout, then wait until no font face is still loading and the layout stopped moving (two frames with the same size) and the working line is not between two words; loop until all of that holds.
 */
async function settle(page) {
  await page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let round = 0; round < 20; round += 1) {
      void document.body.offsetHeight; // a layout pass: it is what starts the font loads for text that was just added
      await document.fonts.ready;
      await frames();
      const h = document.documentElement.scrollHeight;
      await frames();
      const swapping = Boolean(document.querySelector('.bunny-word.is-swapping')); // the working line's word is mid-change for 180 ms each time it changes
      if (!swapping && h === document.documentElement.scrollHeight && ![...document.fonts].some((f) => f.status === 'loading')) return;
    }
    throw new Error('the page never settled: a font is still loading or the layout keeps moving');
  });
}

for (const [name, entry] of entries) {
  test.describe(name, () => {
    test.use({ viewport: { width: entry.viewport[0], height: entry.viewport[1] }, colorScheme: entry.theme, deviceScaleFactor: 1 });
    test(`${name} matches its screen`, async ({ page, request, baseURL }) => {
      test.setTimeout(120_000); // a busy PC (the gate runs this after 590 other tests) can need more than 30 s to start a scene; every wait inside still returns as soon as its condition holds
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
      await settle(page);
      // PIC-OFFSET: a page or panel scrolled to a fraction of a pixel (a scene scrolls an element into view) draws its text on half-pixel lines, so a picture could differ from run to run by that.
      // Every scroll position is made a whole number of pixels before the picture is taken.
      await page.evaluate(() => {
        window.scrollTo(Math.round(window.scrollX), Math.round(window.scrollY));
        for (const el of document.querySelectorAll('*')) { if (el.scrollTop % 1 !== 0) el.scrollTop = Math.round(el.scrollTop); if (el.scrollLeft % 1 !== 0) el.scrollLeft = Math.round(el.scrollLeft); }
      });
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
