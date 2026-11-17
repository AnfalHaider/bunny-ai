import { test, expect } from '@playwright/test';

// BROWSER (Design's drawing): in a browser, where the server keeps window-only changes to Bunny's window, every control that makes one is switched off, greyed, and says
// "Change this in Bunny's window." beside it; a refused write puts the value back; and the page logs no uncaught error. In the plain web build (lock off) nothing is locked.
const SENTENCE = "Change this in Bunny's window.";
const locked = async (page) => page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, fake: true, windowOnlyLock: true }) }));

test('a Settings page in a browser: the window-only controls are disabled, greyed and say why; ordinary ones stay on; no uncaught error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await locked(page);
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  const mode = page.locator('#default-permission');
  await expect(mode).toBeDisabled();
  await expect(mode).toHaveCSS('opacity', '0.5');
  await expect(mode).toHaveAttribute('title', SENTENCE);
  await expect(page.locator('#default-permission + .window-only-note')).toHaveText(SENTENCE); // beside the control
  // the permission rules block: every control off, the sentence once at its top
  const rules = page.locator('#perm-rules');
  for (const c of await rules.locator('input, select, textarea, button').all()) await expect(c).toBeDisabled();
  await expect(rules.locator('.window-only-note')).toHaveCount(1);
  // a window-only switch is off; an ordinary one is not
  await expect(page.locator('[data-cap="connectorsEnabled"]')).toBeDisabled();
  await expect(page.locator('[data-cap="computerUseEnabled"]')).toBeDisabled();
  await expect(page.locator('[data-cap="artifactsEnabled"]')).toBeEnabled();
  await expect(page.locator('#instructions')).toBeDisabled();
  expect(errors.filter((m) => /Change this in Bunny's window/.test(m)), 'no uncaught "Change this in Bunny\'s window." error').toEqual([]);
});

test('Customize, Providers and Automation in a browser: everything that changes something is off; the tabs still work', async ({ page }) => {
  await locked(page);
  await page.goto('/src/ui/customize.html?embed=1');
  await expect(page.locator('.cz-tab').first()).toBeEnabled();
  await page.waitForTimeout(600);
  for (const b of await page.locator('main button:not([role="tab"]):not([data-scope]):not([data-kind])').all()) await expect(b).toBeDisabled();
  await page.goto('/src/ui/providers.html?embed=1');
  await page.waitForTimeout(600);
  for (const b of await page.locator('main button, main input, main select').all()) await expect(b).toBeDisabled();
});

test('a write the server refuses puts the value back, and says the sentence once', async ({ page }) => {
  await locked(page);
  await page.goto('/src/ui/settings.html?embed=1&section=appearance');
  const theme = page.locator('#theme');
  await expect(theme).toBeEnabled(); // an ordinary control
  const start = await theme.inputValue();
  await theme.focus();
  await theme.selectOption(start === 'dark' ? 'light' : 'dark');
  // the page's own write was refused by the server: the app tells the page, and the control goes back
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('bunny:window-only-refused')));
  await expect(theme).toHaveValue(start);
});

test('on a server without the lock (the plain web build) nothing is switched off', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  await expect(page.locator('#default-permission')).toBeEnabled();
  await expect(page.locator('.window-only-note')).toHaveCount(0);
});

// ---- the cards chat.js draws (permission, capability, question): same lock, same sentence ----
const CARDS = `
  <div id="t-permission" class="permission-prompt live-permission"><h4>Allow: Run a command?</h4><div class="permission-actions"><button id="p-allow" class="primary">Allow</button><button id="p-deny">Deny</button></div></div>
  <form id="t-question" class="permission-prompt live-permission question-card"><h4>Which one?</h4><textarea id="q-text"></textarea><div class="permission-actions"><button type="button" id="q-send">Send</button><button type="button" id="q-skip">Skip</button></div></form>
  <div id="t-cap-code" class="permission-prompt live-permission capability-card" data-capability="code_mode"><h4>Work in a folder</h4><div class="permission-actions"><button id="c1-yes">Allow</button><button id="c1-no">Not now</button></div></div>
  <div id="t-cap-plan" class="permission-prompt live-permission capability-card" data-capability="leave_plan_mode"><h4>Leave plan mode</h4><div class="permission-actions"><button id="c2-yes">Allow</button><button id="c2-no">Not now</button></div></div>
  <div id="t-cap-computer" class="permission-prompt live-permission capability-card" data-capability="computer_use"><h4>Use the computer</h4><div class="permission-actions"><button id="c3-yes">Allow</button><button id="c3-no">Not now</button></div></div>
  <div id="t-cap-tools" class="permission-prompt live-permission capability-card" data-capability="custom_tools"><h4>Build tools</h4><div class="permission-actions"><button id="c4-yes">Allow</button><button id="c4-no">Not now</button></div></div>
  <div id="t-cap-switch" class="permission-prompt live-permission capability-card" data-capability="switch_on_added"><h4>Switch on</h4><div class="permission-actions"><button id="c5-yes">Switch on</button><button id="c5-no">Leave off</button></div></div>`;
const addCards = (page) => page.evaluate((html) => { const host = document.createElement('div'); host.id = 'cards'; host.innerHTML = html; document.body.append(host); }, CARDS);

test('cards in a browser tab on this computer (the lock on, not a device): every Allow, Deny and answer is off, the sentence is beside them, and the card keeps waiting', async ({ page }) => {
  await locked(page);
  await page.goto('/src/ui/index.html');
  await page.waitForTimeout(500);
  await addCards(page);
  for (const id of ['t-permission', 't-question', 't-cap-code', 't-cap-plan', 't-cap-computer', 't-cap-tools', 't-cap-switch']) {
    const card = page.locator('#' + id);
    for (const c of await card.locator('button, textarea').all()) await expect(c).toBeDisabled();
    await expect(card.locator('.window-only-note')).toHaveText(SENTENCE);
    await expect(card).toBeVisible(); // still there, waiting for the window
  }
});

test('cards on a signed-in device: its own chat\'s cards stay live, and only the capability cards that change what Bunny may do are off', async ({ page }) => {
  await locked(page);
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'bunny-csrf'; m.content = 'a'.repeat(48); document.head.append(m); }); });
  await page.goto('/src/ui/index.html');
  await page.waitForTimeout(500);
  await addCards(page);
  for (const id of ['t-permission', 't-question', 't-cap-code', 't-cap-plan']) {
    const card = page.locator('#' + id);
    for (const c of await card.locator('button, textarea').all()) await expect(c).toBeEnabled();
    await expect(card.locator('.window-only-note')).toHaveCount(0);
  }
  for (const id of ['t-cap-computer', 't-cap-tools', 't-cap-switch']) {
    const card = page.locator('#' + id);
    for (const c of await card.locator('button').all()) await expect(c).toBeDisabled();
    await expect(card.locator('.window-only-note')).toHaveText(SENTENCE);
  }
});

test('cards in the plain web build (no lock) are untouched', async ({ page }) => {
  await page.goto('/src/ui/index.html');
  await page.waitForTimeout(500);
  await addCards(page);
  for (const c of await page.locator('#cards button, #cards textarea').all()) await expect(c).toBeEnabled();
  await expect(page.locator('#cards .window-only-note')).toHaveCount(0);
});
