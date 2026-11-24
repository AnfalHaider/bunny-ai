import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetProfile } from './helpers.js';

// PROJECT-CONTEXT (v0.1.15): a decision kept in one chat reaches the next chat of the project. Invented profile only.

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const sent = [];
function script(body) {
  sent.push(body.messages);
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/we decided on tabs/.test(asked)) return tools === 0 ? call('suggest_project_memory', { items: [{ kind: 'decision', text: 'Use tabs, not spaces.' }, { kind: 'convention', text: 'Prices are stored in cents.' }] }) : frame({ content: 'Noted.' });
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

test('a decision kept in chat 1 reaches chat 2; the chip opens "What this chat was given"; the card stores nothing until Keep', async ({ page, request }) => {
  await open(page);
  const project = await (await request.post('/api/projects', { data: { name: 'Carrot shop', instructions: 'Plain HTML, no framework.' } })).json();
  const one = await (await request.post('/api/sessions', { data: { title: 'Chat one', projectId: project.id } })).json();
  await page.goto(`/?s=${one.id}`);
  await send(page, 'we decided on tabs');
  const card = page.locator('.pm-card');
  await expect(card).toContainText('Remember for Carrot shop?');
  await expect(card).toContainText('Nothing is stored until you press Keep');
  expect((await (await request.get(`/api/projects/${project.id}/memory`)).json()).items).toHaveLength(0);
  await card.locator('.pm-item').first().getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(card.locator('.pm-item').first()).toContainText('Kept');
  const items = (await (await request.get(`/api/projects/${project.id}/memory`)).json()).items;
  expect(items.map((m) => m.text)).toEqual(['Use tabs, not spaces.']);
  await card.locator('.pm-item').nth(1).getByRole('button', { name: 'Discard' }).click();
  expect((await (await request.get(`/api/projects/${project.id}/memory`)).json()).items).toHaveLength(1);

  const two = await (await request.post('/api/sessions', { data: { title: 'Chat two', projectId: project.id } })).json();
  await page.goto(`/?s=${two.id}`);
  await send(page, 'what did we decide last time?');
  const last = JSON.stringify(sent.at(-1));
  expect(last).toContain('Use tabs, not spaces.');
  expect(last).toContain('Project instructions for Carrot shop');
  expect(last).toContain('Chat one');
  const chip = page.locator('#project-context-chip');
  await expect(chip).toContainText('Project context:');
  await chip.click();
  const view = page.locator('.pm-modal');
  await expect(view.locator('.pm-part')).toHaveCount(5);
  await view.locator('.pm-part').nth(2).getByRole('button', { name: 'View' }).click();
  await expect(view.locator('.pm-text-view').nth(2)).toContainText('Use tabs, not spaces.');
  await view.locator('#pc-chat-switch').uncheck();
  await expect(view.locator('.pm-part').nth(2)).toContainText('off (this chat)');
});

test('the project page: memory is listed with Edit and Delete, an item can be added, clearing asks first, and the provider sentence is there', async ({ page, request }) => {
  await open(page);
  const project = await (await request.post('/api/projects', { data: { name: 'Carrot shop' } })).json();
  await request.post(`/api/projects/${project.id}/memory`, { data: { kind: 'fact', text: 'Hosting is a static bucket.' } });
  await page.goto('/');
  await page.locator('#project-filter').selectOption(project.id);
  await page.locator('#edit-project').click();
  const form = page.locator('.project-form');
  await expect(form).toContainText('Hosting is a static bucket.');
  await expect(form).toContainText('go to the provider of the engine each chat runs on');
  await form.locator('.pm-add select').selectOption('decision');
  await form.locator('.pm-add input').fill('Ship as one HTML page.');
  await form.locator('.pm-add').getByRole('button', { name: 'Add' }).click();
  await expect(form).toContainText('Ship as one HTML page.');
  await form.getByRole('button', { name: 'Clear project memory…' }).click();
  await expect(form).toContainText('It cannot be undone');
  await form.getByRole('button', { name: 'Clear 2 items' }).click();
  await expect(form).toContainText('Nothing kept for this project yet');
});
