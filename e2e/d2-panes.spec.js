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
  return frame({ content: 'ok' });
}
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`${script(JSON.parse(raw))}data: [DONE]\n\n`);
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
