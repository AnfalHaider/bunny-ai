import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// v0.1.14 QA's F3, final walk: in Code mode on a phone the row under the box (folder, branch, permission button, "Window only", effort, job) must not run past the right edge: it wraps to a second
// line, no control is dropped, and each chip keeps a readable label. The same in a browser tab (where the permission button carries "Window only") and in Bunny's own window.
const row = (providerId, providerName, id, displayName, freeKind) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength: 128000 });
const MODELS = [row('nvidia', 'NVIDIA', 'nemotron-3-ultra', 'NVIDIA: Nemotron 3 Ultra (free)', 'free')];

test.beforeEach(async ({ request }) => { await resetProfile(request); });

for (const lock of [true, false]) {
  for (const [w, h] of [[360, 740], [390, 844], [412, 915]]) {
    test(`Code mode at ${w}x${h}${lock ? ' in a browser tab ("Window only")' : ''}: nothing in the row under the box passes the right edge, no control is dropped, the labels are readable`, async ({ page, request }) => {
      const folder = mkdtempSync(join(tmpdir(), 'bunny-e2e-a-long-project-folder-name-for-the-phone-row-'));
      expect((await request.post('/api/folder/check', { data: { folder } })).ok()).toBeTruthy();
      await request.put('/api/settings', { data: { modelFilter: 'all' } });
      await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
      if (lock) await page.route('**/api/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, fake: true, windowOnlyLock: true }) }));
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(() => { localStorage.setItem('bunny.workMode', 'code'); localStorage.setItem('bunny.modelAuto', '1'); });
      const made = await (await request.post('/api/sessions', { data: { title: 'Phone row', workMode: 'code', folder } })).json();
      await page.goto(`/?s=${made.id}`);
      await expect(page.locator('#folder-chip')).toBeVisible();
      await expect(page.locator('#job-button')).toBeVisible();
      if (lock) await expect(page.locator('.composer-under .window-only-note')).toBeVisible();
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const kids = [...document.querySelectorAll('.composer-under > *, .composer-under .job-wrap > *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && !e.classList.contains('menu'); });
        const cut = kids.map((e) => ({ id: e.id || e.className, right: e.getBoundingClientRect().right, left: e.getBoundingClientRect().left }));
        // a chip's label is not shortened: its text is not wider than its box (the folder's own name here is a 56-letter one, which is shortened by design)
        const clipped = [...document.querySelectorAll('.composer-under .ctx-chip span, .composer-under .picker-btn .value')].filter((e) => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1 && e.id !== 'folder-text').map((e) => e.textContent.trim());
        return { vw: window.innerWidth, docW: document.documentElement.scrollWidth, cut, clipped, ids: kids.map((e) => e.id).filter(Boolean) };
      });
      for (const k of m.cut) { expect(k.right, `${k.id} stays inside the right edge`).toBeLessThanOrEqual(m.vw + 0.5); expect(k.left, `${k.id} stays inside the left edge`).toBeGreaterThanOrEqual(-0.5); }
      expect(m.clipped, 'no chip label is shortened').toEqual([]);
      expect(m.docW, 'the page does not scroll sideways').toBeLessThanOrEqual(m.vw);
      for (const id of ['folder-chip', 'branch-chip', 'mode-button', 'effort-level', 'job-button']) expect(m.ids, `${id} is still in the row`).toContain(id);
    });
  }
}
