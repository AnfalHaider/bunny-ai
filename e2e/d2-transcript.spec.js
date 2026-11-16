import { test, expect } from '@playwright/test';

import { resetProfile } from './helpers.js';

// D-2 transcript: consecutive tool steps are ONE line, collapsed once finished; each step opens to its detail.

let n = 0;
const step = (tool, status = 'done', extra = {}) => ({
  id: `s-${(n += 1)}`, role: 'assistant', kind: 'tool_call', tool, status, content: extra.content ?? '', result: extra.result ?? 'ok', at: new Date().toISOString(), ...extra,
});
const user = (text) => ({ id: `u-${(n += 1)}`, role: 'user', kind: 'text', content: text, at: new Date().toISOString() });
const reply = (text) => ({ id: `a-${(n += 1)}`, role: 'assistant', kind: 'text', content: text, at: new Date().toISOString() });

async function seeded(page, request, messages) {
  const res = await request.post('/api/sessions', { data: { title: 'D-2', messages } });
  const { id } = await res.json();
  await page.goto(`/src/ui/index.html?s=${id}`);
  await expect(page.locator('#messages .msg').first()).toBeVisible();
}

test.beforeEach(async ({ request }) => { await resetProfile(request); });

test('three steps in a row are one collapsed line with a plain summary, and opening it shows one row per step', async ({ page, request }) => {
  await seeded(page, request, [
    user('look around'),
    step('Read src/app.js'), step('Read src/util.js'), step('Run npm test', 'done', { content: 'npm test', result: 'exit code 0' }),
    reply('All good.'),
  ]);
  await expect(page.locator('.tool-group')).toHaveCount(1);
  await expect(page.locator('.tool-group-summary')).toHaveText('Read two files, ran a command');
  await expect(page.locator('.tool-group-meta')).toHaveText('3 steps');
  await expect(page.locator('.tool-group-rows')).toBeHidden();
  await page.locator('.tool-group-line').click();
  await expect(page.locator('.tool-group-rows .tool-call')).toHaveCount(3);
  await expect(page.locator('.tool-group-rows .tool-call-header span').nth(1)).toHaveText('Read src/app.js');
  // each step opens to its own detail
  await expect(page.locator('.tool-call-result').first()).toBeHidden();
  await page.locator('.tool-call-header').nth(2).click();
  await expect(page.locator('.tool-call-result').nth(2)).toContainText('exit code 0');
  await expect(page.locator('.msg.assistant .body').last()).toContainText('All good.');
});

test('narration between steps splits the groups and stays visible', async ({ page, request }) => {
  await seeded(page, request, [
    user('go'),
    step('Read src/a.js'),
    step('Edit src/a.js', 'done', { note: 'Now I will fix the bug.' }), step('Run npm test'),
    reply('Fixed.'),
  ]);
  await expect(page.locator('.tool-group')).toHaveCount(2);
  await expect(page.locator('.tool-group-summary').first()).toHaveText('Read a file');
  await expect(page.locator('.tool-group-summary').nth(1)).toHaveText('Edited a file, ran a command');
  await expect(page.locator('.step-note')).toContainText('Now I will fix the bug.');
  await expect(page.locator('.step-note')).toBeVisible();
});

test('a failed step: red Failed label, "tried to" wording, and a failed group is collapsed unless the reply ended on it', async ({ page, request }) => {
  await seeded(page, request, [
    user('go'),
    step('Read src/ok.js'), step('Read src/missing.js', 'failed', { result: 'The tool failed: no such file' }),
    reply('That file is missing.'),
  ]);
  await expect(page.locator('.tool-group-summary')).toHaveText('Read a file, tried to read another');
  await expect(page.locator('.tool-group-meta.is-failed')).toHaveText('1 failed');
  await expect(page.locator('.tool-group-rows')).toBeHidden();
  await page.locator('.tool-group-line').click();
  await expect(page.locator('.tool-call-header .tag.is-failed')).toHaveText('Failed');
  await expect(page.locator('.tool-call.is-open')).toHaveCount(0);
});

test('a reply that ended on a failed step shows that step open, with the exact command and a Copy button', async ({ page, request }) => {
  await seeded(page, request, [
    user('go'),
    step('Run npm test', 'failed', { content: 'npm test', result: 'The tool failed: exit 1' }),
  ]);
  await expect(page.locator('.tool-group')).toHaveClass(/is-open/);
  await expect(page.locator('.tool-call.is-open .tool-call-body')).toHaveText('npm test');
  await expect(page.locator('.tool-call.is-open .tool-call-result')).toContainText('exit 1');
  await expect(page.locator('.tool-call-copy')).toBeVisible();
  await expect(page.locator('.tool-group-meta')).toHaveText('Failed');
});

test('a stop after steps is a report: how many steps, what was done, and Continue', async ({ page, request }) => {
  await seeded(page, request, [
    user('go'),
    step('Read src/a.js'), step('Edit src/a.js'),
    { id: 'p-1', role: 'assistant', kind: 'partial', content: 'I was in the middle of', at: new Date().toISOString() },
  ]);
  const report = page.locator('.stopped-report');
  await expect(report.locator('h4')).toHaveText('Stopped');
  await expect(report).toContainText('You stopped Bunny after two steps.');
  await expect(report.locator('.stopped-done li')).toHaveText(['Read a file', 'Edited a file']);
  await expect(report.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(report.getByRole('button', { name: 'Undo these changes' })).toHaveCount(0); // nothing was saved to undo
});

test('a stopped plain answer (no steps) gets no report', async ({ page, request }) => {
  await seeded(page, request, [user('hi'), { id: 'p-2', role: 'assistant', kind: 'partial', content: 'Well', at: new Date().toISOString() }]);
  await expect(page.locator('.stopped-report')).toHaveCount(0);
  await expect(page.locator('.msg.assistant .meta .tag')).toHaveText('stopped');
});

test('a reply that failed outright is one "The reply failed" line that opens to the provider error and a way on', async ({ page, request }) => {
  await seeded(page, request, [
    user('go'),
    { id: 'e-1', role: 'assistant', kind: 'error', content: 'model-x could not finish: The provider answered 500', at: new Date().toISOString() },
  ]);
  await expect(page.locator('.error-note .tool-group-summary')).toHaveText('The reply failed');
  await expect(page.locator('.error-note .tool-group-meta.is-failed')).toHaveText('Failed');
  await page.locator('.error-note .tool-group-line').click();
  await expect(page.locator('.error-note-text')).toHaveText('model-x could not finish: The provider answered 500');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose another model' })).toBeVisible();
});

test('a chat saved before D-2 (old message shapes) renders without errors', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const made = await (await request.post('/api/sessions', { data: { title: 'old', messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', kind: 'tool_call', content: 'x' },
    { role: 'assistant', kind: 'tool_call', tool: 'Run npm test', content: 'npm test', result: 'exit code 1' },
    { role: 'assistant', kind: 'error' },
    { role: 'assistant', kind: 'partial', content: 'cut off' },
    { role: 'assistant', content: 'plain reply' },
  ] } })).json();
  await page.goto(`/src/ui/index.html?s=${made.id}`);
  await expect(page.locator('#messages .msg').first()).toBeVisible();
  await expect(page.locator('.msg.assistant .body').last()).toContainText('plain reply');
  expect(errors).toEqual([]);
});
