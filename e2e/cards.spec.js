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
  if (/pick a colour/.test(asked)) {
    const told = body.messages.filter((m) => m.role === 'tool').at(-1)?.content;
    return told ? frame({ content: `Painting it. (${told})` }) : call('ask_user', { question: 'Which colour?', choices: [{ label: 'Blue', reason: 'Calm, like the current header' }, { label: 'Green', reason: 'Matches the carrot leaves in the logo', recommended: true }] });
  }
  if (/use a helper/.test(asked)) return tools === 0 ? call('run_subagent', { title: 'Carrot counter', task: 'Count carrots' }) : frame({ content: 'The helper reported.' });
  if (/long code/.test(asked)) return frame({ content: `Here:\n\n\`\`\`python\n${LONG}\n\`\`\`\n` });
  return frame({ content: 'hello' });
}

let server;
let port;
const busyModels = new Set();
const brokenModels = new Set();
const doubleModels = new Set(); // W4-11: refuses tools, and then fails without them too
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
      // PV-1 combined: the first model asked "doubly broken" refuses tools, and the retry without tools fails as well; the next model answers
      const doubleAsk = /doubly broken/.test(JSON.stringify(body.messages));
      if (doubleAsk && (!doubleModels.size || doubleModels.has(body.model))) {
        doubleModels.add(body.model);
        res.writeHead(body.tools ? 400 : 500, { 'content-type': 'application/json' });
        res.end(body.tools ? '{"error":{"message":"This model does not support tool use"}}' : '{"error":{"message":"upstream exploded"}}');
        return;
      }
      // The first model asked "are you broken" refuses with an error that is not about being busy.
      const brokenAsk = /are you broken/.test(JSON.stringify(body.messages));
      if (brokenAsk && !brokenModels.size) {
        brokenModels.add(body.model);
        res.writeHead(400, { 'content-type': 'application/json' });
        // not about tools (PV-1 retries a refusal of tools on the same model without them): this model is simply gone
        res.end('{"error":{"message":"This model has been retired"}}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const answer = brokenAsk || doubleAsk ? frame({ content: `working: ${body.model}` }) : busyAsk ? frame({ content: `not busy: ${body.model}` }) : script(body);
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

test('when the picked model fails for another reason, the next model still answers', async ({ page }) => {
  await send(page, 'are you broken?');
  const reply = page.locator('.msg.assistant .body').last();
  await expect(reply).toContainText('working:');
  const answeredBy = (await reply.textContent()).match(/working: (\S+)/)[1];
  expect([...brokenModels]).not.toContain(answeredBy);
});

test('the model asks a question: one click answers it, and the reply goes on', async ({ page }) => {
  await page.locator('#input').fill('pick a colour for the shop');
  await page.locator('#send').click();
  const card = page.locator('.question-card');
  await expect(card.locator('h4')).toHaveText('Which colour?');
  // While Bunny waits for the answer, the hopping bunny says so, with a timer.
  await expect(page.locator('.bunny-working .bunny-word')).toHaveText('Waiting… (arms crossed)');
  await expect(page.locator('.bunny-working .bunny-time')).toHaveText(/\d+s/);
  await page.screenshot({ path: 'test-results/question-card.png' });
  // The recommended choice comes first, with its reason.
  await expect(card.locator('.question-choice').first()).toContainText('Green');
  await expect(card.locator('.question-choice').first()).toContainText('Recommended');
  await expect(card.locator('.question-choice').first()).toContainText('Matches the carrot leaves in the logo');
  await card.getByRole('button', { name: 'Green' }).click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.msg.assistant .body').last()).toContainText('The person answered: Green');
  await expect(page.locator('.bunny-working')).toHaveCount(0);
  // After the reply, the question stays in the chat with the answer.
  await expect(page.locator('.question-card.is-answered')).toContainText('You answered: Green');
  await expect(page.locator('.question-card.is-answered .is-chosen')).toContainText('Green');
});

test('a question can be answered in your own words', async ({ page }) => {
  await page.locator('#input').fill('pick a colour, any');
  await page.locator('#send').click();
  const card = page.locator('.question-card');
  await card.getByLabel('Your answer').fill('Sunset orange');
  await card.getByLabel('Your answer').press('Enter');
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.msg.assistant .body').last()).toContainText('The person answered: Sunset orange');
  await expect(page.locator('.question-card.is-answered')).toContainText('You answered: Sunset orange');
});

test('a model that refuses tools and then fails without them too: the next model answers', async ({ page }) => {
  await send(page, 'are you doubly broken?');
  const reply = page.locator('.msg.assistant .body').last();
  await expect(reply).toContainText('working:');
  const answeredBy = (await reply.textContent()).match(/working: (\S+)/)[1];
  expect(doubleModels.size).toBe(1);
  expect([...doubleModels]).not.toContain(answeredBy);
});
