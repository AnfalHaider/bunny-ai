import { test, expect } from '@playwright/test';

// BROWSER (Design's drawing): in a browser, where the server keeps window-only changes to Bunny's window, every control that makes one is switched off, greyed, and says
// "Change this in Bunny's window." beside it; a refused write puts the value back; and the page logs no uncaught error. In the plain web build (lock off) nothing is locked.
const SENTENCE = "Change this in Bunny's window.";
const locked = async (page) => page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, fake: true, windowOnlyLock: true }) }));

test('a Settings page in a browser: the window-only controls are disabled, greyed and say why; ordinary ones stay on; no uncaught error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await locked(page);
  await page.goto('/src/ui/settings.html?embed=1&section=permissions');
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
  await page.goto('/src/ui/settings.html?embed=1&section=permissions');
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

// ---- the composer: one short line beside the greyed mode control; a device picks the model of its own chat ----
test('the lock note beside the chat mode control is one short line (the sentence is its tooltip), not a wrapped paragraph', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await locked(page);
  await page.goto('/src/ui/index.html');
  await expect(page.locator('#mode-button')).toBeDisabled();
  const note = page.locator('.window-only-note').first();
  await expect(note).toHaveText('Window only');
  await expect(note).toHaveAttribute('title', SENTENCE);
  const box = await note.boundingBox();
  expect(box.height).toBeLessThan(26); // one line
});

test('a signed-in device that picks a model sets THAT chat\'s model through the chat\'s own routes: no settings write, no red sentence', async ({ page, request }) => {
  const models = [{ providerId: 'harbor', providerName: 'Harbor', id: 'reef-image', displayName: 'Reef Image', freeKind: 'free', free: true, contextLength: 128000 }];
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  const made = await (await request.post('/api/sessions', { data: { title: 'Device chat' } })).json();
  await locked(page);
  await page.route('**/api/models*', (route) => route.fulfill({ json: models }));
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'bunny-csrf'; m.content = 'a'.repeat(48); document.head.append(m); }); });
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\/(settings|sessions\/)/.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.goto('/src/ui/index.html?s=' + made.id);
  await page.waitForTimeout(500);
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-model:not([data-section])').first().click();
  await expect(page.locator('#picker-button')).toContainText('Reef Image');
  await page.waitForTimeout(500);
  expect(writes).toContain(`PATCH /api/sessions/${made.id}/setting/providerId`);
  expect(writes).toContain(`PATCH /api/sessions/${made.id}/setting/model`);
  expect(writes.filter((w) => w === 'PUT /api/settings'), 'no write of the default model').toEqual([]);
  await expect(page.locator('#error')).not.toContainText(SENTENCE);
});

// ---- F-1 and F-2 (QA, from the real page) ----
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectAnthropic, pickFirstModel } from './helpers.js';

/** Connect the fake provider once (the e2e server keeps it between tests). */
async function ensureProvider(page, request) {
  const list = await (await request.get('/api/providers')).json();
  if (!list.some((x) => x.id === 'anthropic' && x.status === 'connected')) await connectAnthropic(page);
}

test('F-2: in a tab on this computer the permission-rules controls are really disabled (the property), stay so after the page redraws them, and typing or clicking does nothing', async ({ page }) => {
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /permission-rules/.test(r.url())) writes.push(r.url()); });
  await locked(page);
  await page.goto('/src/ui/settings.html?embed=1&section=permissions');
  await page.waitForTimeout(800);
  const real = () => page.evaluate(() => [...document.querySelectorAll('#perm-rules input, #perm-rules select, #perm-rules textarea, #perm-rules button')].map((c) => [c.id || c.className || c.tagName, c.disabled]));
  const bad = async () => (await real()).filter(([, d]) => d !== true);
  expect(await bad(), 'every control has disabled === true, not only aria-disabled').toEqual([]);
  // the page draws the list again when the tab changes: the controls must be off again afterwards
  await page.evaluate(() => document.getElementById('rules-tab-folder').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('rules-tab-all').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(500);
  expect(await bad(), 'still off after the page redrew the rules').toEqual([]);
  // typing into the locked Pattern box gets nothing, and "Add rule" does nothing
  await page.evaluate(() => document.getElementById('rules-pattern').focus());
  await page.keyboard.type('npm run lint*');
  expect(await page.evaluate(() => document.getElementById('rules-pattern').value)).toBe('');
  await page.evaluate(() => document.getElementById('rules-add-btn').click());
  await page.waitForTimeout(300);
  expect(writes, 'no rule was sent').toEqual([]);
});

test('F-1: on a signed-in device page, Allow on a permission card sends the answer and the tool runs; the page no longer refuses it first', async ({ page, request }) => {
  const folder = mkdtempSync(join(tmpdir(), 'bunny-device-e2e-'));
  await ensureProvider(page, request);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  const made = await (await request.post('/api/sessions', { data: { title: 'Device chat', workMode: 'code', folder, permissionMode: 'ask' } })).json();
  await locked(page);
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'bunny-csrf'; m.content = 'a'.repeat(48); document.head.append(m); }); });
  const answers = [];
  page.on('request', (r) => { if (/\/permission\//.test(r.url())) answers.push(r.method()); });
  await page.goto('/src/ui/index.html?s=' + made.id);
  await pickFirstModel(page);
  await page.locator('#input').fill('[[call write_file {"path":"note.txt","content":"from a device"}]]');
  await page.locator('#send').click();
  const allow = page.locator('.permission-prompt').getByRole('button', { name: 'Allow' }).first();
  await expect(allow).toBeEnabled({ timeout: 15_000 });
  await allow.click();
  await expect(page.locator('.msg.assistant .body').last()).toContainText('Scripted', { timeout: 20_000 });
  expect(readFileSync(join(folder, 'note.txt'), 'utf8')).toBe('from a device');
  expect(answers).toEqual(['POST']);
  await expect(page.locator('#error')).not.toContainText(SENTENCE);
});

test('F-1 (the other side): in a tab on this computer, Allow on a card still sends nothing and says the sentence', async ({ page, request }) => {
  const folder = mkdtempSync(join(tmpdir(), 'bunny-tab-e2e-'));
  await ensureProvider(page, request);
  const made = await (await request.post('/api/sessions', { data: { title: 'Tab chat', workMode: 'code', folder, permissionMode: 'ask' } })).json();
  await locked(page);
  const answers = [];
  page.on('request', (r) => { if (/\/permission\//.test(r.url())) answers.push(r.method()); });
  await page.goto('/src/ui/index.html?s=' + made.id);
  await pickFirstModel(page);
  await page.locator('#input').fill('[[call write_file {"path":"note.txt","content":"nope"}]]');
  await page.locator('#send').click();
  const card = page.locator('.permission-prompt').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.window-only-note')).toHaveText(SENTENCE);
  for (const b of await card.locator('button').all()) expect(await b.evaluate((e) => e.disabled)).toBe(true);
  expect(answers).toEqual([]);
});
