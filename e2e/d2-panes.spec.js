import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetProfile } from './helpers.js';

// D-2 panes: Changes (from the saved copies, any folder), Files (read-only tree and file view), Session (the facts).

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
function script(body) {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/write note/.test(asked)) return tools === 0 ? call('write_file', { path: 'note.txt', content: 'carrots\nand more\n' }) : frame({ content: 'Wrote note.txt.' });
  if (/edit greet/.test(asked)) return tools === 0 ? call('write_file', { path: 'src/greet.js', content: 'export const greet = (n) => `hi ${n}`;\nexport const bye = () => 1;\n' }) : frame({ content: 'Edited.' });
  if (/stop me/.test(asked)) return tools === 0 ? call('write_file', { path: 'stop-note.txt', content: 'x\n' }) : 'SLOW';
  return frame({ content: 'ok' });
}
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method !== 'POST' && !req.url.endsWith('/models')) { res.writeHead(200); res.end('ok'); return; } // a reachability probe
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const out = script(JSON.parse(raw));
      if (out === 'SLOW') { res.write(frame({ content: 'Starting… ' })); setTimeout(() => res.end('data: [DONE]\n\n'), 8000); return; }
      res.end(`${out}data: [DONE]\n\n`);
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
  page.on('dialog', (d) => d.accept());
});
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null } });
});

async function open(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'code'); });
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
  await expect(page.locator('#stop')).toBeVisible().catch(() => {}); // the reply may be too quick to see
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('', { timeout: 10_000 });
}
const project = () => {
  const d = mkdtempSync(join(tmpdir(), 'bunny-d2-panes-'));
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'greet.js'), 'export const greet = (n) => `hi ${n}`;\n');
  writeFileSync(join(d, 'README.md'), '# demo\n');
  return d;
};

test('Changes: a new file and an edited file show with +/- counts, the diff opens, and Undo to here puts it back', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir); await pickMode(page, 'Auto');
  await send(page, 'write note');
  await send(page, 'edit greet');
  await page.locator('.toolbar [data-view="diff"]').click();
  const pane = page.locator('#diff-content');
  await expect(pane.locator('.changes-head .badge')).toHaveText('2 files');
  await expect(pane.locator('.changes-banner')).toContainText('with or without git');
  await expect(pane.locator('.checkpoint-card')).toHaveCount(2);
  const newest = pane.locator('.checkpoint-card').first();
  await expect(newest.locator('.change-row .path')).toHaveText('src/greet.js');
  await expect(newest.locator('.change-row .badge')).toHaveText('edited');
  await newest.locator('.change-row').click();
  await expect(newest.locator('.diff-line.add')).not.toHaveCount(0);
  const note = pane.locator('.checkpoint-card').nth(1);
  await expect(note.locator('.change-row .badge')).toHaveText('new');
  await note.getByRole('button', { name: 'Undo to here' }).click(); // the dialog is accepted by the beforeEach handler
  await expect(note.locator('.checkpoint-done')).toHaveText('Undone');
  expect(existsSync(join(dir, 'note.txt'))).toBe(false);
});

test('Changes: empty chat says "No changes yet."', async ({ page }) => {
  await open(page);
  await page.locator('.toolbar [data-view="diff"]').click();
  await expect(page.locator('#diff-content .diff-empty')).toHaveText('No changes yet.');
});

test('Files: the tree lists the folder, a file opens with line numbers, and a file Bunny changed is tinted with its lines marked', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir); await pickMode(page, 'Auto');
  // before any message the chosen folder can already be browsed
  await page.locator('.toolbar [data-view="file"]').click();
  await expect(page.locator('#file-content .tree-row[data-path="README.md"]')).toBeVisible();
  await send(page, 'write note'); // the pane is open: it refreshes by itself when the reply is saved
  const tree = page.locator('#file-content');
  await expect(tree.locator('.tree-row[data-path="note.txt"].is-new')).toContainText('new');
  await tree.locator('.tree-row[data-path="src"]').click();
  await tree.locator('.tree-row[data-path="src/greet.js"]').click();
  await expect(tree.locator('.file-head .file-name')).toHaveText('src/greet.js');
  await expect(tree.locator('.file-line .ln').first()).toHaveText('1');
  await tree.locator('.tree-row[data-path="note.txt"]').click();
  await expect(tree.locator('.file-line.is-changed')).toHaveCount(2);
  await expect(tree.getByRole('button', { name: 'Copy path' })).toBeVisible();
});

test('Files: a Read step in the transcript has an Open link that shows that file', async ({ page, request }) => {
  const dir = project();
  const made = await (await request.post('/api/sessions', { data: { title: 'read', folder: dir, messages: [
    { id: 'u1', role: 'user', kind: 'text', content: 'look', at: new Date().toISOString() },
    { id: 's1', role: 'assistant', kind: 'tool_call', tool: 'Read src/greet.js', status: 'done', content: '', result: 'ok', at: new Date().toISOString() },
    { id: 'a1', role: 'assistant', kind: 'text', content: 'Seen.', at: new Date().toISOString() },
  ] } })).json();
  await page.goto(`/src/ui/index.html?s=${made.id}`);
  await page.locator('.tool-group-line').click();
  await page.locator('.tool-call-open').click();
  await expect(page.locator('#file-content .file-head .file-name')).toHaveText('src/greet.js');
});

test('Session: folder, branch, model, permissions, effort, tokens and messages are all shown', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir);
  await send(page, 'hello');
  await page.locator('#rail-toggle').click();
  const rail = page.locator('#rail');
  await expect(rail.locator('#rail-folder')).toHaveText(/bunny-d2-panes/);
  await expect(rail.locator('#rail-branch')).toHaveText('Not a git folder');
  await expect(rail.locator('#rail-model')).toHaveText(/bunny-code|scripted/);
  await expect(rail.locator('#rail-mode')).toHaveText(/Manual|Auto|Plan|Accept/);
  await expect(rail.locator('#rail-effort')).toHaveText(/Medium|Low|High/);
  await expect(rail.locator('#rail-tokens')).toContainText('of');
  await expect(rail.locator('#rail-messages')).not.toHaveText('0');
  await expect(rail.locator('#rail-cost')).toHaveText('not reported');
  await expect(rail.locator('#rail-running')).toContainText('Nothing running.');
  await expect(rail.locator('#rail-project')).toContainText('No project');
});

test.describe('on a 390 px phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Changes and Files buttons are in the top bar with 40 px targets, and open their pane', async ({ page }) => {
    await page.goto('/');
    for (const view of ['diff', 'file']) {
      const button = page.locator(`.toolbar [data-view="${view}"]`);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(39);
      expect(box.height).toBeGreaterThanOrEqual(39);
      await button.click();
      await expect(page.locator(view === 'diff' ? '#pane-diff' : '#pane-file')).toBeVisible();
      await page.locator('#pane [data-close]:visible').first().click(); // the pane replaces the thread; Close returns to it
      await expect(page.locator('#pane')).not.toHaveClass(/is-open/);
    }
  });

  test('Q2-32: every top-bar button, the sidebar toggle and Export included, is at least 40 px tall and wide', async ({ page }) => {
    await page.goto('/');
    for (const selector of ['#sidebar-toggle', '#export', '.toolbar [data-view="diff"]', '.toolbar [data-view="file"]']) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).toBeTruthy();
      expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(39.5);
      expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(39.5);
    }
  });

  test('the status text shows as one dim line above the composer (the top bar hides it at this width)', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('#status')).toBeHidden();
    await page.evaluate(() => { document.getElementById('status').textContent = 'You are offline. Using a model on this computer.'; });
    await expect(page.locator('#status-line')).toHaveText('You are offline. Using a model on this computer.');
    await expect(page.locator('#status-line')).toBeVisible();
    const lineBox = await page.locator('#status-line').boundingBox();
    const composerBox = await page.locator('#composer').boundingBox();
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    expect(request).toBeTruthy();
  });
});

test('Q2-31: after Stop in a chat with steps, the Stopped report is there at once, without a reload', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir); await pickMode(page, 'Auto');
  await page.locator('#input').fill('stop me'); await page.locator('#send').click();
  await expect(page.locator('.msg.assistant .body').last()).toContainText('Starting', { timeout: 15_000 });
  await page.locator('#stop').click();
  await expect(page.locator('.stopped-report')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.stopped-report')).toContainText('You stopped Bunny after one step.');
});

test('Q2-30: offline with a local provider that is not running, the message waits instead of failing in red', async ({ page, request }) => {
  // a provider on this computer whose server is not there (port 9 refuses connections): the only local one
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  const added = await request.post('/api/providers/custom', { data: { name: 'Closed local', baseUrl: 'http://127.0.0.1:9/v1' } });
  expect(added.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('#picker-button')).toBeVisible();
  await request.put('/api/network', { data: { offline: true } });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.locator('#input').fill('hello offline');
  await page.locator('#send').click();
  await expect(page.locator('#queued-msg .body')).toHaveText('hello offline');
  await expect(page.locator('.offline-line')).toBeVisible();
  await expect(page.locator('#error')).toHaveText('');
  await request.put('/api/network', { data: { offline: false } });
});
