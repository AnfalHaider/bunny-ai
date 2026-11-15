import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { resetProfile } from './helpers.js';

// The cards the model's tools draw in the chat, checked in the real window. A small
// scripted model server stands in for a provider, added the way a person adds one:
// as a custom OpenAI-compatible provider.

const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Date.now()}`, function: { name, arguments: JSON.stringify(args) } }] });
const LONG = Array.from({ length: 40 }, (_, i) => `print("line ${i + 1}")`).join('\n');

/** What the scripted model does, by the words in the person's message and how far it got. */
function script(body) {
  const system = String(body.messages[0]?.content ?? '');
  const helper = /You are "([^"]+)", a helper agent/.exec(system);
  if (helper) return frame({ content: `report from ${helper[1]}` });
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  const thinking = frame({ reasoning_content: 'Let me think about carrots first.' });
  if (/make a page/.test(asked)) return tools === 0 ? call('create_artifact', { title: 'Carrot page', kind: 'html', content: '<h1>Carrots</h1>' }) : thinking + frame({ content: 'Made it.' });
  if (/my files/.test(asked)) return tools === 0 ? call('request_capability', { capability: 'code_mode', reason: 'To read your files' }) : frame({ content: 'Without Code mode I cannot read them.' });
  if (/plan it/.test(asked)) {
    if (tools === 0) return call('update_tasks', { tasks: [{ text: 'Look' }, { text: 'Write' }] });
    if (tools === 1) return call('update_tasks', { tasks: [{ text: 'Look', done: true }, { text: 'Write' }] });
    return frame({ content: 'Planned.' });
  }
  if (/use a helper/.test(asked)) return tools === 0 ? call('run_subagent', { title: 'Carrot counter', task: 'Count carrots' }) : frame({ content: 'The helper reported.' });
  if (/long code/.test(asked)) return frame({ content: `Here:\n\n\`\`\`python\n${LONG}\n\`\`\`\n` });
  return frame({ content: 'hello' });
}

let server;
let port;
const busyModels = new Set();
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      const body = JSON.parse(raw);
      const busyAsk = /are you busy/.test(JSON.stringify(body.messages));
      // The first model asked "are you busy" is rate limited; the next one answers.
      if (busyAsk && !busyModels.size) {
        busyModels.add(body.model);
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end('{"error":{"message":"Rate limit exceeded"}}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const answer = busyAsk ? frame({ content: `not busy: ${body.model}` }) : script(body);
      res.end(`${answer}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
// Leave the shared profile as it was found: later specs expect the default model filter.
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null } });
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test.beforeEach(async ({ request, page }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  const added = await request.post('/api/providers/custom', { data: { name: 'Scripted', baseUrl: `http://127.0.0.1:${port}/v1` } });
  expect(added.ok()).toBeTruthy();
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'chat'); });
  await page.goto('/');
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
});

async function send(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
}

test('an artifact the model makes gets a card and opens beside the chat; its thinking is folded', async ({ page }) => {
  await send(page, 'make a page');
  const card = page.locator('.artifact-card', { hasText: 'Carrot page' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Page');
  await expect(page.locator('#artifacts')).toBeVisible();
  const thinking = page.locator('.msg.assistant details.thinking').last();
  await expect(thinking).toBeVisible();
  await expect(thinking).not.toHaveAttribute('open', '');
  await thinking.locator('summary').click();
  await expect(thinking.locator('.thinking-text')).toHaveText('Let me think about carrots first.');
  // The step tells the person what happened, not ids and addresses.
  await expect(page.locator('.tool-call-result').last()).toHaveText('→ Opened in the Artifacts panel.');
});

test('the capability card asks, and "Not now" is an answer the model gets', async ({ page }) => {
  await page.locator('#input').fill('read my files');
  await page.locator('#send').click();
  const card = page.locator('.capability-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Code mode');
  await expect(card).toContainText('To read your files');
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.msg.assistant .body').last()).toHaveText('Without Code mode I cannot read them.');
});

test('the plan shows as a checklist that ticks off, and in the Tasks pane', async ({ page }) => {
  await send(page, 'plan it');
  const items = page.locator('.msg.assistant .task-list .task-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveClass(/is-done/);
  await expect(items.last()).not.toHaveClass(/is-done/);
  await expect(page.locator('#tasks-content')).toContainText('1 of 2 done');
});

test('a helper gets a card that links to its own nested chat', async ({ page }) => {
  await send(page, 'use a helper');
  const card = page.locator('.linked-card', { hasText: 'Carrot counter' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Finished');
  await expect(page.locator('.session-row[data-depth="1"]', { hasText: 'Carrot counter' })).toBeVisible();
  await expect(page.locator('.session-row', { hasText: 'Carrot counter' }).locator('.agent-tag')).toHaveText('helper');
});

test('when the picked model is busy, another answers and the reply says so', async ({ page }) => {
  await send(page, 'are you busy?');
  const reply = page.locator('.msg.assistant .body').last();
  await expect(reply).toContainText('not busy:');
  const answeredBy = (await reply.textContent()).match(/not busy: (\S+)/)[1];
  const meta = await page.locator('.msg.assistant .auto-meta').last().textContent();
  const busy = meta.match(/because (\S+) was busy/)?.[1];
  expect(busy, meta).toBeTruthy();
  expect(busy).not.toBe(answeredBy);
  expect(meta).toContain(answeredBy);
});
