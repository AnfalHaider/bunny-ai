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
