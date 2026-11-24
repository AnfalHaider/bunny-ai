import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetProfile } from './helpers.js';

// REWIND (v0.1.15): go back further than one reply, from the chat and from the Changes pane. Invented profile and folders only.

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
function script(body) {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/write note/.test(asked)) return tools === 0 ? call('write_file', { path: 'note.txt', content: 'carrots\nand more\n' }) : frame({ content: 'Wrote note.txt.' });
  if (/edit greet/.test(asked)) return tools === 0 ? call('write_file', { path: 'src/greet.js', content: 'export const greet = (n) => `hi ${n}`;\nexport const bye = () => 1;\n' }) : frame({ content: 'Edited.' });
  if (/multi edit/.test(asked)) return tools === 0 ? call('multi_edit', { path: 'src/greet.js', edits: [{ old_text: 'hi', new_text: 'hello' }, { old_text: 'greet', new_text: 'greeting' }, { old_text: 'export', new_text: 'export' }] }) : frame({ content: 'Edited.' });
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


const goBack = (page) => page.locator('.rewind-modal').getByRole('button', { name: 'Go back', exact: true });

test('Rewind: "Go back further…" opens the panel, the preview names the files, the confirm puts both replies back, and "Undo the rewind" brings them forward', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir); await pickMode(page, 'Auto');
  await send(page, 'write note');
  await send(page, 'edit greet');
  const edited = 'export const greet = (n) => `hi ${n}`;\nexport const bye = () => 1;\n';
  expect(readFileSync(join(dir, 'src', 'greet.js'), 'utf8')).toBe(edited);
  await page.locator('.msg.assistant').last().getByRole('button', { name: 'Go back further…' }).click();
  const panel = page.locator('.rewind-modal');
  await expect(panel.locator('.rewind-row')).toHaveCount(2);
  await panel.locator('.rewind-row').nth(1).click(); // the older reply
  await expect(panel.locator('.rewind-result-head')).toContainText('Replies 1 to 2 are rewound together');
  await expect(panel.locator('.rewind-file')).toHaveCount(2);
  await panel.getByRole('button', { name: /Go back to before reply 1/ }).click();
  await expect(panel.locator('.modal-title')).toHaveText('Go back to before reply 1?');
  await expect(panel).toContainText('Bunny puts back 1 file');
  await goBack(page).click();
  await expect(panel.locator('[role="status"]')).toContainText('Put back 1 file, removed 1');
  expect(existsSync(join(dir, 'note.txt'))).toBe(false);
  expect(readFileSync(join(dir, 'src', 'greet.js'), 'utf8')).toBe('export const greet = (n) => `hi ${n}`;\n');
  await panel.getByRole('button', { name: 'Undo the rewind' }).click();
  await expect(panel.locator('[role="status"]')).toContainText('Undone');
  expect(existsSync(join(dir, 'note.txt'))).toBe(true);
  expect(readFileSync(join(dir, 'src', 'greet.js'), 'utf8')).toBe(edited);
});

test('Rewind: from the Changes pane the button opens the same panel; a file changed since is left alone unless ticked; the panel fits a phone', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir); await pickMode(page, 'Auto');
  await send(page, 'write note');
  await send(page, 'edit greet');
  writeFileSync(join(dir, 'note.txt'), 'my own words\n');
  await page.locator('.toolbar [data-view="diff"]').click();
  await page.locator('#diff-content').getByRole('button', { name: 'Rewind', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  const panel = page.locator('.rewind-modal');
  await panel.locator('.rewind-row').nth(1).click();
  await expect(panel.locator('.rewind-changed')).toContainText('note.txt');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await panel.getByRole('button', { name: /Go back to before reply 1/ }).click();
  await goBack(page).click();
  await expect(panel.locator('[role="status"]')).toContainText('Left 1 file');
  expect(readFileSync(join(dir, 'note.txt'), 'utf8')).toBe('my own words\n');
  expect(readFileSync(join(dir, 'src', 'greet.js'), 'utf8')).toBe('export const greet = (n) => `hi ${n}`;\n');
});

test('Rewind: with no changed files the panel says so', async ({ page }) => {
  const dir = project();
  await open(page); await useFolder(page, dir); await pickMode(page, 'Auto');
  await send(page, 'just chat');
  await page.locator('.toolbar [data-view="diff"]').click();
  await expect(page.locator('#diff-content')).toContainText('No changes yet.');
});
