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

test('W2-4: a lone search names what it looked for; several searches are still counted', async ({ page, request }) => {
  await seeded(page, request, [
    user('where is it'),
    step('Search /TODO\d+/ in src (*.js)'),
    reply('Found it.'),
    user('and files'),
    step('Find **/*.test.js'),
    reply('Those.'),
    user('again'),
    step('Search "a"'), step('Search "b"'),
    reply('Done.'),
  ]);
  const lines = page.locator('.tool-group-summary');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveText('Searched for /TODO\d+/ in src (*.js)');
  await expect(lines.nth(1)).toHaveText('Searched for files matching **/*.test.js');
  await expect(lines.nth(2)).toHaveText('Searched two times');
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

test('W2-7b (Design): a step stopped by a rule is an amber "Blocked", not a red "Failed", on the group line and on the step', async ({ page, request }) => {
  await seeded(page, request, [
    user('clean up'),
    step('Run Remove-Item -Recurse build', 'denied', { content: 'Remove-Item -Recurse build', result: 'Blocked by your permission rule "Remove-Item*-r*" (All folders).' }),
    reply('I was told no.'),
    user('and again'),
    step('Run a', 'denied'), step('Run b', 'failed'),
    reply('Mixed.'),
  ]);
  const metas = page.locator('.tool-group-meta');
  await expect(metas.nth(0)).toHaveText('Blocked');
  await expect(metas.nth(0)).toHaveClass(/is-blocked/);
  await expect(metas.nth(0)).not.toHaveClass(/is-failed/);
  await expect(metas.nth(1)).toHaveText('1 failed');
  await page.locator('.tool-group-line').first().click();
  const tag = page.locator('.tool-group').first().locator('.tool-call-header .tag');
  await expect(tag).toHaveText('Blocked');
  await expect(tag).toHaveClass(/is-blocked/);
  // amber, the colour of a warning, not the red of a failure
  const color = (loc) => loc.evaluate((e) => getComputedStyle(e).color);
  const failedTag = page.locator('.tool-group').nth(1).locator('.tool-call-header .tag.is-failed');
  await page.locator('.tool-group-line').nth(1).click();
  expect(await color(tag)).not.toBe(await color(failedTag));
});

test('W2-7b (QA): the permission prompt wraps a long rule line instead of cutting it off, on a phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await seeded(page, request, [user('hi'), reply('ok')]);
  const wrap = await page.evaluate(() => {
    const card = document.createElement('div');
    card.className = 'permission-prompt live-permission';
    card.innerHTML = '<h4>Allow: Run git push?</h4><pre class="code"><code>git push origin main --set-upstream --follow-tags --verbose --some-very-long-flag-with-no-break-points-at-all-so-it-must-wrap\n\nAsked because of your rule "git push*" (All folders).</code></pre>';
    document.body.append(card);
    const pre = card.querySelector('pre');
    const out = { white: getComputedStyle(pre).whiteSpace, wrap: getComputedStyle(pre).overflowWrap, fits: pre.scrollWidth <= pre.clientWidth + 1 };
    card.remove();
    return out;
  });
  expect(wrap.white).toBe('pre-wrap');
  expect(wrap.wrap).toBe('anywhere');
  expect(wrap.fits).toBe(true);
});
