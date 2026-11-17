import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

import { resetProfile } from './helpers.js';

// W4-5b: the "Thinking…" row and the hopping bunny are ONE live line, always the last thing in the reply. It opens to the streaming
// thinking, settles into a quiet "Thought for Ns" row when the model moves on, and a saved reply shows the same row.

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method !== 'POST' && !req.url.endsWith('/models')) { res.writeHead(200); res.end('ok'); return; }
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"thinker"}]}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // W4-5c: a reply with a step: it thinks, makes a page (the step), then answers
      const sent = JSON.parse(raw);
      if (/make a page/.test(JSON.stringify(sent.messages))) {
        if (sent.messages.some((m) => m.role === 'tool')) { res.end(`${frame({ content: 'Made it.' })}data: [DONE]\n\n`); return; }
        res.write(frame({ reasoning_content: 'The user wants a page, so I will make one.' }));
        setTimeout(() => { res.write(frame({ tool_calls: [{ index: 0, id: 'c_1', function: { name: 'create_artifact', arguments: JSON.stringify({ title: 'Carrot page', kind: 'html', content: '<h1>Carrots</h1>' }) } }] })); res.end('data: [DONE]\n\n'); }, 700);
        return;
      }
      res.write(frame({ reasoning_content: 'The page has three price cards ' }));
      setTimeout(() => res.write(frame({ reasoning_content: 'and a comparison table. Keep the card order.' })), 500);
      setTimeout(() => { res.write(frame({ content: 'Done: the cards keep their order.' })); res.end('data: [DONE]\n\n'); }, 2600);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.afterAll(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); });

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all', transcriptView: 'normal' } });
  expect((await request.post('/api/providers/custom', { data: { name: 'Thinker', baseUrl: `http://127.0.0.1:${port}/v1` } })).ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null, transcriptView: 'normal' } });
});

async function ask(page, text = 'tidy the pricing page') {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); });
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
}

test('while the model thinks there is ONE line: bunny, word, "thinking", a timer and a chevron; no separate Thinking row', async ({ page }) => {
  await ask(page);
  const line = page.locator('.bunny-working .bunny-line');
  await expect(line).toBeVisible();
  await expect(page.locator('.bunny-working')).toHaveCount(1);
  await expect(page.locator('details.thinking')).toHaveCount(0); // nothing else called Thinking
  await expect(page.locator('.bunny-working .bunny-tail')).toHaveText('thinking');
  await expect(page.locator('.bunny-working .bunny-time')).toHaveText(/^\d+s$/);
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(line).toBeEnabled();
  await expect(page.locator('.bunny-working .bunny-chev')).toBeVisible();
  // the line is the last thing in the reply, and only the word is announced (the timer is hidden from screen readers)
  await expect(page.locator('.bunny-working .bunny-word')).toHaveAttribute('role', 'status');
  await expect(page.locator('.bunny-working .bunny-time')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => document.querySelector('.bunny-working').nextElementSibling === null || !document.querySelector('.bunny-working').nextElementSibling.matches('.msg'))).toBe(true);
});

test('opening the line shows the thinking, streaming under it; opening again hides it', async ({ page }) => {
  await ask(page);
  const line = page.locator('.bunny-working .bunny-line');
  await expect(line).toBeEnabled();
  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.bunny-working .bunny-thinking')).toBeVisible();
  await expect(page.locator('.bunny-working .bunny-thinking')).toContainText('three price cards');
  await expect(page.locator('.bunny-working .bunny-thinking')).toContainText('Keep the card order.');
  await line.press('Enter');
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.bunny-working .bunny-thinking')).toBeHidden();
});

test('when the model moves on the thinking settles into "Thought for Ns", which opens to the text; no bunny once the reply is done', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.msg.assistant .body').last()).toContainText('the cards keep their order', { timeout: 15_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('.bunny-working')).toHaveCount(0);
  const row = page.locator('details.thinking').last();
  await expect(row).toBeVisible();
  await expect(row.locator('summary')).toHaveText(/^Thought for \d+s$/);
  await expect(row).not.toHaveAttribute('open', '');
  await row.locator('summary').click();
  await expect(row.locator('.thinking-text')).toContainText('Keep the card order.');
});

test('a reopened chat shows the same "Thought for Ns" row, and an old chat without the time shows just "Thought"', async ({ page, request }) => {
  await ask(page);
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('details.thinking summary').last()).toHaveText(/^Thought for \d+s$/);
  const id = new URL(page.url()).searchParams.get('s') ?? (await (await request.get('/api/sessions')).json())[0].id;
  await page.goto(`/src/ui/index.html?s=${id}`);
  await expect(page.locator('#messages .msg').first()).toBeVisible();
  await expect(page.locator('details.thinking summary').last()).toHaveText(/^Thought for \d+s$/);
  // a chat saved before the time was kept
  const old = await request.post('/api/sessions', { data: { title: 'Old', messages: [
    { id: 'u1', role: 'user', kind: 'text', content: 'hi', at: new Date().toISOString() },
    { id: 'a1', role: 'assistant', kind: 'text', content: 'hello', thinking: 'Let me think.', at: new Date().toISOString() },
  ] } });
  await page.goto(`/src/ui/index.html?s=${(await old.json()).id}`);
  await expect(page.locator('details.thinking summary').last()).toHaveText('Thought');
});

test('"Show thinking" (transcript view Thinking) opens the line by default', async ({ page, request }) => {
  await request.put('/api/settings', { data: { transcriptView: 'thinking' } });
  await ask(page);
  const line = page.locator('.bunny-working .bunny-line');
  await expect(line).toBeEnabled();
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.bunny-working .bunny-thinking')).toContainText('three price cards');
});

test('a slow model: ears back, a readable "Hmph…", and what it waits on; the line keeps no chevron without thinking', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(async () => {
    const { createWorking } = await import('/src/ui/bunny-working.js');
    const w = createWorking('waiting', { model: 'Claude Sonnet' });
    document.body.append(w.el);
    w.set('slow');
    await new Promise((r) => setTimeout(r, 300));
    const out = {
      word: w.el.querySelector('.bunny-word').textContent,
      tail: w.el.querySelector('.bunny-tail').textContent,
      slow: w.el.classList.contains('is-slow'),
      disabled: w.el.querySelector('.bunny-line').disabled,
      chevHidden: w.el.querySelector('.bunny-chev').hidden,
      tailAfter: getComputedStyle(w.el.querySelector('.bunny-tail'), '::after').content,
    };
    w.stop();
    return out;
  });
  expect(state.word).toBe('Hmph…');
  expect(state.tail).toBe('waiting for Claude Sonnet');
  expect(state.slow).toBe(true);
  expect(state.disabled).toBe(true);
  expect(state.chevHidden).toBe(true);
  expect(state.tailAfter).toContain('·');
});

test('on a phone the word shortens before the time wraps: one line, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await ask(page);
  await expect(page.locator('.bunny-working .bunny-tail')).toHaveText('thinking');
  const m = await page.evaluate(() => {
    const line = document.querySelector('.bunny-working .bunny-line');
    const time = document.querySelector('.bunny-working .bunny-time');
    return { oneLine: line.getBoundingClientRect().height < 40, timeInside: time.getBoundingClientRect().right <= line.getBoundingClientRect().right + 1, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(m.oneLine).toBe(true);
  expect(m.timeInside).toBe(true);
  expect(m.wide).toBe(false);
});

// W4-5c
test('the "Thought for" row comes BEFORE the step it led to, live and after a reload', async ({ page, request }) => {
  await ask(page, 'make a page about carrots');
  await expect(page.locator('#messages .live-tool, #messages .tool-group, #messages .tool-call').first()).toBeVisible({ timeout: 15_000 });
  const order = () => page.evaluate(() => {
    const kids = [...document.querySelectorAll('#messages > *')];
    const at = (sel) => kids.findIndex((k) => k.matches(sel) || k.querySelector(sel));
    return { thought: at('details.thinking'), step: at('.live-tool, .tool-group, .tool-call') };
  });
  await expect.poll(async () => (await order()).thought, { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  const live = await order();
  expect(live.thought).toBeLessThan(live.step);
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  const done = await order();
  expect(done.thought).toBeLessThan(done.step);
  const id = new URL(page.url()).searchParams.get('s') ?? (await (await request.get('/api/sessions')).json())[0].id;
  await page.goto(`/src/ui/index.html?s=${id}`);
  await expect(page.locator('#messages .msg').first()).toBeVisible();
  await expect(page.locator('details.thinking').first()).toBeVisible();
  const again = await order();
  expect(again.thought).toBeGreaterThanOrEqual(0);
  expect(again.thought).toBeLessThan(again.step);
});

test('the word is never empty, also across two thinkings, and the same word is not swapped', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createWorking } = await import('/src/ui/bunny-working.js');
    const w = createWorking('waiting', { model: 'm' });
    document.body.append(w.el);
    const word = w.el.querySelector('.bunny-word');
    const seen = [];
    const watch = setInterval(() => seen.push(word.textContent), 10);
    const wait = (ms) => new Promise((x) => setTimeout(x, ms));
    w.addThinking('first thought');
    await wait(400);
    w.endThinking();
    w.set('tool', 'Read a.txt');
    w.addThinking('second thought');
    await wait(400);
    w.set('tool', 'Read a.txt'); // same step again: the word may change, but never to nothing
    await wait(400);
    clearInterval(watch);
    const immediate = (() => { const v = createWorking('waiting'); document.body.append(v.el); const t = v.el.querySelector('.bunny-word').textContent; v.stop(); return t; })();
    w.stop();
    return { empties: seen.filter((t) => t === '').length, total: seen.length, immediate };
  });
  expect(r.total).toBeGreaterThan(20);
  expect(r.empties).toBe(0);
  expect(r.immediate).not.toBe('');
});

test('a long step target ends in one ellipsis and the timer stays after it', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createWorking } = await import('/src/ui/bunny-working.js');
    const w = createWorking('waiting');
    document.body.append(w.el);
    w.set('tool', `Run ${'Start-Sleep -Seconds 1; '.repeat(6)}`);
    await new Promise((x) => setTimeout(x, 400));
    const out = { word: w.el.querySelector('.bunny-word').textContent, time: w.el.querySelector('.bunny-time').textContent };
    w.stop();
    return out;
  });
  expect(r.word).not.toContain('……');
  expect(r.word.split('…').length - 1).toBe(1);
  expect(r.word.endsWith('…')).toBe(true);
  expect(r.time).toMatch(/^\d+s$/);
});

test('on a phone a 60-character model name shortens and the timer stays on screen in the slow state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const r = await page.evaluate(async () => {
    const { createWorking } = await import('/src/ui/bunny-working.js');
    const w = createWorking('waiting', { model: `provider/${'very-long-model-name-'.repeat(3)}`.slice(0, 60) });
    document.body.append(w.el);
    w.set('slow');
    await new Promise((x) => setTimeout(x, 400));
    const model = w.el.querySelector('.bunny-model');
    const time = w.el.querySelector('.bunny-time').getBoundingClientRect();
    const out = {
      tail: w.el.querySelector('.bunny-tail').textContent,
      cut: model.scrollWidth > model.clientWidth,
      timeRight: time.right, timeLeft: time.left, view: document.documentElement.clientWidth,
      wide: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      after: w.el.querySelector('.bunny-time').compareDocumentPosition(model) & Node.DOCUMENT_POSITION_PRECEDING,
    };
    w.stop();
    return out;
  });
  expect(r.tail.startsWith('waiting for provider/')).toBe(true);
  expect(r.cut).toBe(true);
  expect(r.timeLeft).toBeGreaterThanOrEqual(0);
  expect(r.timeRight).toBeLessThanOrEqual(r.view);
  expect(r.wide).toBe(false);
  expect(r.after).toBeTruthy(); // the name comes before the timer
});
