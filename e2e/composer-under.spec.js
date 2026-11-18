import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// v0.1.11 (owner: "the options under the chat box are not visible anymore"): with the model chip in the button row, the row under
// the box (folder, branch, mode, effort, job) stays fully inside the window in Chat and in Code mode, and the chip's name is readable.
const row = (providerId, providerName, id, displayName, freeKind) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength: 128000 });
const MODELS = [row('nvidia', 'NVIDIA', 'nemotron-3-ultra', 'NVIDIA: Nemotron 3 Ultra (free)', 'free'), row('quill', 'Quill', 'otter', 'Otter 3 Coder', null)];

test.beforeEach(async ({ request }) => { await resetProfile(request); });

for (const mode of ['chat', 'code']) {
  for (const [w, h] of [[1280, 800], [1280, 480], [1050, 600], [1050, 340], [390, 780], [390, 520]]) {
    for (const scheme of ['light', 'dark']) {
      test(`${mode}, ${w}x${h}, ${scheme}: the row under the box is inside the window and the chip name is readable`, async ({ page, request }) => {
        let folder = null;
        if (mode === 'code') {
          folder = mkdtempSync(join(tmpdir(), 'bunny-e2e-a-long-project-folder-name-for-the-under-row-'));
          expect((await request.post('/api/folder/check', { data: { folder } })).ok()).toBeTruthy();
        }
        await request.put('/api/settings', { data: { modelFilter: 'all' } });
        await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: w, height: h });
        await page.addInitScript((m) => { localStorage.setItem('bunny.workMode', m); localStorage.setItem('bunny.modelAuto', m === 'code' ? '1' : '0'); }, mode); // Code mode runs on Auto (the owner's view): the chip reads Auto, then the chosen model
        if (folder) {
          const made = await (await request.post('/api/sessions', { data: { title: 'Under row', workMode: 'code', folder } })).json();
          await page.goto(`/?s=${made.id}`);
          await expect(page.locator('#folder-chip')).toBeVisible();
        } else {
          await page.goto('/');
        }
        await expect(page.locator('#picker-button .label')).toBeVisible();
        const under = page.locator('.composer-under');
        await expect(under).toBeVisible();
        const m = await page.evaluate(() => {
          const u = document.querySelector('.composer-under').getBoundingClientRect();
          const kids = [...document.querySelectorAll('.composer-under > *')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none').map((e) => { const b = e.getBoundingClientRect(); return { id: e.id || e.className, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
          const chip = document.getElementById('picker-button'); const comp = document.querySelector('.composer').getBoundingClientRect();
          const label = chip.querySelector('.label');
          return { comp: { left: comp.left, right: comp.right }, u: { top: u.top, bottom: u.bottom, left: u.left, right: u.right }, kids, vw: window.innerWidth, vh: window.innerHeight, sw: document.documentElement.scrollWidth, label: label.textContent, metaText: chip.querySelector('.meta')?.textContent ?? '', metaVisible: chip.querySelector('.meta')?.getBoundingClientRect().width ?? 0, clipped: label.scrollWidth > label.clientWidth + 1, labelW: label.getBoundingClientRect().width, chipBox: (() => { const b = chip.getBoundingClientRect(); return { left: b.left, right: b.right }; })() };
        });
        expect(m.u.bottom).toBeLessThanOrEqual(m.vh + 0.5); // inside the window, not pushed below or clipped
        expect(m.u.top).toBeGreaterThanOrEqual(0);
        for (const k of m.kids) { expect(k.right, `${k.id} stays inside the composer's width`).toBeLessThanOrEqual(m.comp.right + 1); expect(k.right).toBeLessThanOrEqual(m.vw + 0.5); expect(k.bottom).toBeLessThanOrEqual(m.vh + 0.5); }
        expect(m.sw).toBeLessThanOrEqual(m.vw + 1); // no sideways scroll
        expect(m.chipBox.right).toBeLessThanOrEqual(m.vw + 0.5);
        if (w < 600 && mode === 'chat') expect(m.labelW).toBeGreaterThan(95); // a phone chip shows well over ten characters of a long name
        const row = await page.evaluate(() => { const r = document.querySelector('.composer-row').getBoundingClientRect(); const need = ['attach', 'voice', 'send'].map((id) => document.getElementById(id)?.getBoundingClientRect()).filter(Boolean); return { right: r.right, left: r.left, items: need.map((b) => ({ left: b.left, right: b.right })) }; });
        for (const it of row.items) { expect(it.left).toBeGreaterThanOrEqual(row.left - 1); expect(it.right).toBeLessThanOrEqual(row.right + 1); } // the mic, + and Send still fit
        // the chip name is readable: at least the first part of the name, an ellipsis only at the end
        expect(m.label.length).toBeGreaterThan(3);
        if (w >= 600 || m.label === 'Auto') expect(m.clipped).toBe(false); // the first word of the chip is never cut (Auto, or the model name up to its end)
        expect(m.metaText.length === 0 || m.metaVisible > 30).toBe(true); // what follows Auto is readable: an ellipsis only at its end
        if (mode === 'code') for (const id of ['folder-chip', 'mode-button', 'job-button']) await expect(page.locator('#' + id)).toBeInViewport();
      });
    }
  }
}

// "Open to other devices" puts a line across the top of the window: the app below takes the height that is left, so nothing is pushed off the bottom.
for (const [w, h] of [[1280, 800], [390, 780]]) {
  for (const scheme of ['light', 'dark']) {
    test(`with the Open to other devices line shown, ${w}x${h}, ${scheme}: the row under the box and the sidebar's bottom stay inside the window`, async ({ page, request }) => {
      const folder = mkdtempSync(join(tmpdir(), 'bunny-e2e-remote-bar-'));
      expect((await request.post('/api/folder/check', { data: { folder } })).ok()).toBeTruthy();
      await request.put('/api/settings', { data: { modelFilter: 'all' } });
      await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
      await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { enabled: true, signedIn: 2, autoChats: [] } }) : r.continue()));
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(() => { window.bunnyDesktop = {}; /* the line is drawn only in the desktop app */ localStorage.setItem('bunny.workMode', 'code'); localStorage.setItem('bunny.modelAuto', '1'); });
      const made = await (await request.post('/api/sessions', { data: { title: 'Bar row', workMode: 'code', folder } })).json();
      await page.goto(`/?s=${made.id}`);
      await expect(page.locator('#remote-bar')).toBeVisible();
      await expect(page.locator('#folder-chip')).toBeVisible();
      const m = await page.evaluate(() => {
        const box = (el) => { const b = el?.getBoundingClientRect(); return b ? { top: b.top, bottom: b.bottom } : null; };
        return { vh: window.innerHeight, bar: box(document.getElementById('remote-bar')), app: box(document.getElementById('app')), under: box(document.querySelector('.composer-under')), foot: box(document.querySelector('.sidebar-foot')), docH: document.documentElement.scrollHeight };
      });
      expect(m.bar.top).toBeGreaterThanOrEqual(0);
      expect(m.app.top).toBeGreaterThanOrEqual(m.bar.bottom - 1); // the app starts under the line
      expect(m.app.bottom).toBeLessThanOrEqual(m.vh + 0.5);        // and ends inside the window
      expect(m.under.bottom).toBeLessThanOrEqual(m.vh + 0.5);
      if (m.foot && m.foot.bottom > 0 && w >= 600) expect(m.foot.bottom).toBeLessThanOrEqual(m.vh + 0.5); // the sidebar's profile row
      expect(m.docH).toBeLessThanOrEqual(m.vh + 1);                // nothing to scroll to
    });
  }
}

// Design (c1c0e8d): on a narrow phone the chip never touches Send, and Send keeps its width.
for (const w of [390, 360, 320]) {
  for (const scheme of ['light', 'dark']) {
    test(`a long model name at ${w} px: the chip ends before Send and Send keeps its size (${scheme})`, async ({ page, request }) => {
      await request.put('/api/settings', { data: { modelFilter: 'all' } });
      await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: w, height: 700 });
      await page.addInitScript(() => { localStorage.setItem('bunny.workMode', 'chat'); localStorage.setItem('bunny.modelAuto', '0'); });
      await page.goto('/');
      await expect(page.locator('#picker-button .label')).toBeVisible();
      const m = await page.evaluate(() => {
        const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
        return { chip: r('picker-button'), send: r('send'), attach: r('attach'), voice: r('voice') };
      });
      expect(m.chip.right).toBeLessThanOrEqual(m.send.left - 4);
      expect(m.send.width).toBeGreaterThanOrEqual(35);
      expect(m.attach.width).toBeGreaterThanOrEqual(30);
      expect(m.chip.left).toBeGreaterThanOrEqual(m.voice.right);
    });
  }
}
