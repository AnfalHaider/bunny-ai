import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resetProfile } from './helpers.js';

/**
 * Q-2 audit (QA, 2026-11-16): what was verified by driving every screen, as regression tests.
 * Plain tests pin behaviour that is correct today. test.fail() marks a defect from docs/plans/audit-q2.md:
 * the test states the correct behaviour and is EXPECTED to fail now; when the Builder fixes the defect the
 * test starts passing, Playwright reports "expected to fail but passed", and the marker is removed.
 */

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Date.now()}_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
function script(body) {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/write one/.test(asked)) return tools === 0 ? call('write_file', { path: 'note.txt', content: 'carrots\n' }) : frame({ content: 'Wrote note.txt.' });
  if (/change readme/.test(asked)) return tools === 0 ? call('write_file', { path: 'README.md', content: '# changed by Bunny\n' }) : frame({ content: 'Changed README.md.' });
  return frame({ content: `Reply to: ${asked.slice(0, 40)}` });
}
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      const body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (/slow/.test(JSON.stringify(body.messages.at(-1)))) { res.write(frame({ content: 'Starting… ' })); setTimeout(() => res.end(frame({ content: 'late' }) + 'data: [DONE]\n\n'), 6000); return; }
      res.end(`${script(body)}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.afterAll(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); });

test.beforeEach(async ({ request, page }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  expect((await request.post('/api/providers/custom', { data: { name: 'Scripted', baseUrl: `http://127.0.0.1:${port}/v1` } })).ok()).toBeTruthy();
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Renamed by QA') : d.accept()));
});
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null } });
});

async function open(page, mode = 'chat') {
  await page.goto('/');
  await page.evaluate((m) => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', m); }, mode);
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
}
async function useFolder(page, dir) {
  await page.locator('#mode-code').click();
  if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click();
  await page.locator('input[aria-label="Folder path"]').fill(dir);
  await page.getByRole('button', { name: 'Use folder' }).click();
  await expect(page.locator('#folder-chip')).toHaveAttribute('title', /Working folder/);
}
const pickMode = async (page, label) => { await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: label }).first().click(); };
async function send(page, text) {
  await page.locator('#input').fill(text); await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeVisible().catch(() => {});
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
}
const gitRepo = () => {
  const d = mkdtempSync(join(tmpdir(), 'bunny-q2-e2e-git-')); const g = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'qa@example.invalid'); g('config', 'user.name', 'QA'); writeFileSync(join(d, 'README.md'), '# demo\n'); g('add', '.'); g('commit', '-q', '-m', 'first');
  return d;
};

// ============================================================ verified today

test('Settings: every section in the window opens its page, and the search narrows the list', async ({ page }) => {
  await open(page);
  await page.locator('#settings-open').click();
  const sections = await page.locator('#settings-nav-list button.nav-row[data-section]:visible').evaluateAll((e) => e.map((x) => x.dataset.section));
  expect(sections.length).toBe(17); // 15 + "Desktop app", which a browser tab now shows too (it holds Install as an app), + "Engines" (the CLI engines page)
  for (const s of sections) {
    await page.locator(`#settings-nav-list button.nav-row[data-section="${s}"]`).click();
    await expect(page.locator('#settings-frame')).toHaveAttribute('src', /settings\.html|providers\.html|customize\.html|automation\.html/);
    await expect.poll(async () => (await page.frameLocator('#settings-frame').locator('body').innerText()).trim().length, { message: s }).toBeGreaterThan(20);
  }
  await page.locator('#settings-search').fill('theme');
  await expect(page.locator('#settings-nav-list button.nav-row:visible')).toHaveText(['Appearance']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-frame')).toBeHidden();
});

test('chat row menu: rename, archive and restore, and an incognito chat is not saved', async ({ page, request }) => {
  await open(page);
  await send(page, 'Plan the carrot garden');
  await expect(page.locator('.session-row').first()).toContainText('carrot garden');
  await page.locator('.session-row').first().hover();
  await page.locator('.session-row .row-menu').first().click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const ask = page.getByRole('dialog', { name: 'Rename chat' }).locator('input');
  await ask.fill('Renamed by QA');
  await ask.press('Enter');
  await expect(page.locator('#chat-title')).toHaveText('Renamed by QA');
  await page.locator('.session-row').first().hover();
  await page.locator('.session-row .row-menu').first().click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.locator('.session-row')).toHaveCount(0);
  await page.locator('#archived-toggle').click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.locator('.session-row').first().hover();
  await page.locator('.session-row .row-menu').first().click();
  await page.getByRole('menuitem', { name: /Unarchive/ }).click();
  await page.locator('#archived-toggle').click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  const before = (await (await request.get('/api/sessions')).json()).length;
  await page.locator('#incognito').click();
  await expect(page.locator('#mode')).toBeVisible();
  await page.locator('#input').fill('secret words'); await page.locator('#send').click();
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('', { timeout: 15_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 15_000 });
  expect((await (await request.get('/api/sessions')).json()).length).toBe(before);
});

test('the toolbar opens and closes each pane, and the layout menu docks it', async ({ page }) => {
  await open(page);
  for (const [view, pane] of [['overview', '#rail'], ['terminal', '#side-pane'], ['diff', '#side-pane'], ['browser', '#side-pane'], ['file', '#side-pane'], ['tasks', '#side-pane']]) {
    const btn = page.locator(`.toolbar [data-view="${view}"], #rail-toggle[data-view="${view}"]`).first();
    await btn.click(); await expect(page.locator(pane)).toBeVisible(); await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await btn.click(); await expect(page.locator(pane)).toBeHidden();
  }
  await page.locator('.toolbar [data-view="tasks"]').click();
  const layout = page.locator('#side-pane button[aria-label="Panel layout"]:visible').first();
  await layout.click();
  await page.locator('#pane-layout-menu [aria-label="Dock left"]').click();
  await expect(page.locator('.app')).toHaveClass(/pane-left/);
  await page.locator('#pane-layout-menu [aria-label="Dock bottom"]').click();
  await expect(page.locator('.app')).toHaveClass(/pane-bottom/);
});

test('permission menu and effort are saved to the chat once it exists', async ({ page, request }) => {
  await open(page);
  await send(page, 'hello');
  const sid = new URL(page.url()).searchParams.get('s');
  for (const [label, key] of [['Plan', 'plan'], ['Accept edits', 'accept'], ['Manual', 'ask'], ['Auto', 'auto']]) {
    await pickMode(page, label);
    await expect.poll(async () => (await (await request.get(`/api/sessions/${sid}`)).json()).permissionMode).toBe(key);
  }
  await page.locator('#effort-level').selectOption('high');
  await expect.poll(async () => (await (await request.get(`/api/sessions/${sid}`)).json()).effort).toBe('high');
});

test('Stop ends a reply at once and keeps what had arrived', async ({ page, request }) => {
  await open(page);
  await page.locator('#input').fill('slow please'); await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('.msg.assistant .body').last()).toContainText('Starting');
  await page.locator('#stop').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 5000 });
  const sid = new URL(page.url()).searchParams.get('s');
  await expect.poll(async () => (await (await request.get(`/api/sessions/${sid}`)).json()).messages.some((m) => m.role === 'assistant' && /Starting/.test(m.content))).toBeTruthy();
});

test('Code mode, Manual: a write waits for Allow, Deny stops it, Allow does it, Undo puts it back', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-q2-e2e-'));
  await open(page, 'code'); await useFolder(page, dir); await pickMode(page, 'Manual');
  await page.locator('#input').fill('write one'); await page.locator('#send').click();
  await expect(page.locator('.permission-prompt')).toBeVisible({ timeout: 10_000 });
  expect(existsSync(join(dir, 'note.txt'))).toBe(false);
  await page.locator('.permission-prompt button', { hasText: 'Deny' }).click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 15_000 });
  expect(existsSync(join(dir, 'note.txt'))).toBe(false);
  await page.locator('#input').fill('write one'); await page.locator('#send').click();
  await page.locator('.permission-prompt button', { hasText: 'Allow' }).click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 15_000 });
  expect(readFileSync(join(dir, 'note.txt'), 'utf8')).toBe('carrots\n');
  await page.locator('.undo-bar button', { hasText: 'Undo' }).last().click();
  await expect.poll(() => existsSync(join(dir, 'note.txt'))).toBe(false);
});

test('Code mode in a git repo shows the folder and its branch', async ({ page }) => {
  const dir = gitRepo();
  await open(page, 'code'); await useFolder(page, dir);
  await expect(page.locator('#branch-chip')).toHaveText(/main/);
});

// ============================================================ defects (expected to fail until fixed)

test('Q2-2: a permission mode chosen in a new chat is still chosen after the folder or branch chip is touched', async ({ page }) => {
  const dir = gitRepo();
  await open(page, 'code'); await useFolder(page, dir); await pickMode(page, 'Plan');
  await expect(page.locator('#mode-button')).toContainText('Plan');
  await page.locator('#branch-chip').click();
  await expect(page.locator('#branch-chip')).toHaveText(/main/);
  await page.waitForTimeout(800); // the chip re-reads the folder, then redraws the composer
  await expect(page.locator('#mode-button')).toContainText('Plan');
});

test('Q2-3: choosing a permission mode before the first message sends no request for session "null"', async ({ page }) => {
  const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await open(page); await pickMode(page, 'Plan'); await page.waitForTimeout(500);
  expect(bad).toEqual([]); expect(errors).toEqual([]);
});

test('Q2-4: the Changes pane lists a file Bunny changed in a git repo', async ({ page }) => {
  const dir = gitRepo();
  await open(page, 'code'); await useFolder(page, dir); await pickMode(page, 'Auto');
  await send(page, 'change readme');
  await page.locator('.toolbar [data-view="diff"]').click();
  await expect(page.locator('#diff-content')).toContainText('README.md', { timeout: 3000 });
});

test('Q2-4b: the Changes pane lists changes in a folder that is not a git repo too', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-q2-e2e-plain-'));
  await open(page, 'code'); await useFolder(page, dir); await pickMode(page, 'Auto');
  await send(page, 'write one');
  await expect(page.locator('.undo-bar')).toContainText('Files changed');
  await page.locator('.toolbar [data-view="diff"]').click();
  await expect(page.locator('#diff-content')).toContainText('note.txt', { timeout: 3000 });
});

test('Q2-5: the Files pane lists the working folder', async ({ page }) => {
  const dir = gitRepo();
  await open(page, 'code'); await useFolder(page, dir);
  await page.locator('.toolbar [data-view="file"]').click();
  await expect(page.locator('#file-content')).toContainText('README.md', { timeout: 3000 });
});

test('Q2-6: the Session pane shows the folder, the branch, the model and the permission mode', async ({ page }) => {
  const dir = gitRepo();
  await open(page, 'code'); await useFolder(page, dir); await send(page, 'hello');
  await page.locator('#rail-toggle').click();
  const text = await page.locator('#rail').innerText();
  expect(text).toMatch(/bunny-q2-e2e-git/); expect(text).toMatch(/main/); expect(text).toMatch(/bunny-code|Scripted/i); expect(text).toMatch(/Manual|Auto|Plan|Accept/);
});

test('Q2-9: opening a page whose server is not running says so in the pane', async ({ page }) => {
  await open(page); await page.locator('.toolbar [data-view="browser"]').click();
  await page.locator('#browser-url').fill('http://127.0.0.1:9'); await page.locator('#browser-url').press('Enter');
  await expect(page.locator('#browser-tabs-content')).toContainText(/not running|not reachable|could not reach|refused/i, { timeout: 6000 });
});

test('Q2-14: in the command palette, Enter runs the highlighted command', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('toggle artifacts');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#artifacts')).toBeVisible({ timeout: 2000 });
});

test('Q2-15: the palette\'s Settings command opens the Settings window in place', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('settings'); await page.locator('.palette-item').first().click();
  await expect(page.locator('#settings-frame')).toBeVisible({ timeout: 2000 });
  expect(new URL(page.url()).pathname).toMatch(/index\.html$|\/$/);
});

test('Q2-19: after Stop in a chat that already has replies, the stopped reply stays on screen', async ({ page }) => {
  await open(page);
  await send(page, 'hello');
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('slow please'); await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('.msg.assistant .body').last()).toContainText('Starting');
  await page.locator('#stop').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 5000 });
  await page.waitForTimeout(1500);
  expect(((await page.locator('#messages').innerText()).match(/Starting/g) ?? []).length).toBeGreaterThan(0);
});

test('Q2-20: every switch in Settings has an accessible name', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  const bad = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].filter((i) => {
    const label = i.getAttribute('aria-label') || [...(i.labels ?? [])].map((l) => l.textContent).join(' ');
    const name = (label ?? '').trim().toLowerCase();
    return !name || name === 'on' || name === 'off';
  }).map((i) => i.id || i.dataset.cap || i.dataset.key));
  expect(bad).toEqual([]);
});

test('Q2-22: opening /?s=<id> keeps the chat id in the address', async ({ page }) => {
  await page.goto('/?s=abc123');
  expect(new URL(page.url()).searchParams.get('s')).toBe('abc123');
});
