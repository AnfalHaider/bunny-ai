import { test, expect } from '@playwright/test';

import {
  resetProfile, connectAnthropic, pickFirstModel, chat, connectAndChat,
} from './helpers.js';

// The features a desktop AI app is known for, checked in the browser rather than
// in the store. Each test states one promise a person would make.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('a reply is rendered as Markdown, with a copyable code block', async ({ page }) => {
  await connectAndChat(page, 'show me some code');
  const body = page.locator('.msg.assistant .body').last();

  // Bold becomes a real element, not asterisks.
  await expect(body.locator('strong').first()).toContainText('You said');
  // A fenced block becomes a pre with the language named.
  await expect(body.locator('pre.code')).toHaveCount(1);
  await expect(body.locator('pre.code .code-lang')).toHaveText('js');
  await expect(body.locator('pre.code code')).toContainText('console.log');

  // And the block has its own copy button.
  await body.locator('.code-copy').click();
  await expect(body.locator('.code-copy')).toHaveText('Copied');
});

test('a message can be copied from its action bar', async ({ page }) => {
  await connectAndChat(page, 'copy me');
  const copy = page.locator('.msg.assistant .msg-actions button[data-act="copy"]').last();
  await copy.click();
  await expect(copy).toHaveText('Copied');
});

test('retrying a reply asks again and keeps one answer', async ({ page }) => {
  await connectAndChat(page, 'first try');
  await expect(page.locator('.msg.assistant')).toHaveCount(1);

  await page.locator('.msg.assistant .msg-actions button[data-act="retry"]').last().click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  // The old answer was replaced, not stacked on top of.
  await expect(page.locator('.msg.assistant')).toHaveCount(1);
  await expect(page.locator('.msg.assistant .body').last()).toContainText('first try');
});

test('editing a message replaces it and asks again', async ({ page }) => {
  await connectAndChat(page, 'typo');
  await page.locator('.msg.user .msg-actions button[data-act="edit"]').last().click();

  const editor = page.locator('.edit-box');
  await expect(editor).toBeVisible();
  await editor.fill('a corrected question');
  await page.getByRole('button', { name: 'Save and resend' }).click();

  await expect(page.locator('.msg.user .body').last()).toHaveText('a corrected question');
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.msg.assistant .body').last()).toContainText('a corrected question');
  // The old turn and its answer are gone, not merely hidden.
  await expect(page.locator('.msg')).toHaveCount(2);
});

test('the context meter reports how full the window is', async ({ page }) => {
  await connectAndChat(page, 'how much context is this');
  await expect(page.locator('#context-text')).toContainText('%');
  await expect(page.locator('#context')).toHaveAttribute('title', /tokens used/);
});

test('/compact summarises the chat and frees context', async ({ page }) => {
  await connectAndChat(page, 'a long question about pricing');
  await page.locator('#input').fill('/compact');
  await page.locator('#input').press('Enter');

  await expect(page.locator('#status')).toContainText('Compacted');
  // The transcript is now one labelled summary.
  await expect(page.locator('.msg')).toHaveCount(1);
  await expect(page.locator('.msg .meta .tag')).toHaveText('summary');
  await expect(page.locator('.msg.assistant .body')).toContainText('Summary of the conversation so far');
});

test('/clear starts a new chat and keeps the old one', async ({ page }) => {
  await connectAndChat(page, 'keep this chat');
  await page.locator('#input').fill('/clear');
  await page.locator('#input').press('Enter');

  // The thread is empty, but the old chat is still in the sidebar.
  await expect(page.locator('.msg')).toHaveCount(0);
  await expect(page.locator('#sessions .session-row')).toHaveCount(1);
});

test('the slash menu lists the commands', async ({ page }) => {
  await page.goto('/');
  await page.locator('#input').fill('/');
  await expect(page.locator('#slash')).toBeVisible();
  await expect(page.locator('#slash .slash-item')).toHaveCount(5);
  await expect(page.locator('#slash')).toContainText('/compact');
});

test('branching a message opens a nested chat', async ({ page }) => {
  await connectAndChat(page, 'a question worth branching from');
  await page.locator('.msg.user .msg-actions button[data-act="branch"]').last().click();

  await page.waitForURL(/s=[0-9a-f-]{36}/);
  // The branch is a child of the chat it came from.
  await expect(page.locator('#sessions .session-row[data-depth="1"]')).toHaveCount(1);
});

test('a chat can be renamed from its row menu', async ({ page }) => {
  await connectAndChat(page, 'a chat to rename');
  page.once('dialog', (d) => d.accept('A better name'));

  await page.locator('#sessions .row-menu').first().click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();

  await expect(page.locator('#sessions')).toContainText('A better name');
});

test('a chat can be pinned and archived from its row menu', async ({ page }) => {
  await connectAndChat(page, 'a chat to file away');
  await page.locator('#sessions .row-menu').first().click();
  await page.getByRole('menuitem', { name: 'Pin' }).click();
  await expect(page.locator('#sessions .pin')).toHaveCount(1);

  await page.locator('#sessions .row-menu').first().click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  // Archived chats leave the normal list.
  await expect(page.locator('#sessions .session-row')).toHaveCount(0);

  await page.locator('#archived-toggle').click();
  await expect(page.locator('#sessions .session-row')).toHaveCount(1);
});

test('search finds a chat by what was said in it', async ({ page }) => {
  await connectAndChat(page, 'my favourite colour is ultramarine');
  await page.locator('#search').fill('ultramarine');
  await expect(page.locator('#sessions .session-row')).toHaveCount(1);

  await page.locator('#search').fill('chartreuse');
  await expect(page.locator('#sessions')).toContainText('No chats match');
});

test('a chat can be exported as Markdown', async ({ page }) => {
  await connectAndChat(page, 'export this conversation');
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.md$/);
});

test('stopping a reply ends the stream', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
  await page.locator('#input').fill('a long answer please');
  await page.locator('#send').click();

  // Stop once something has arrived, so there is a partial reply to keep.
  await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('.msg.assistant .body')).not.toHaveText('', { timeout: 10_000 });
  await page.locator('#stop').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 15_000 });

  // Whatever arrived is kept, and the reply is marked as stopped.
  await expect(page.locator('.msg.assistant .body')).not.toHaveText('');
  const texts = await page.locator('.msg.assistant .body').allTextContents();
  expect(texts.join(' ')).not.toContain('console.log');
});

test('the model picker is driven from the keyboard', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await page.locator('#picker-button').click();

  const search = page.getByRole('searchbox', { name: 'Search models' });
  const options = page.locator('.picker-panel [role="option"]');
  await expect(page.locator('.picker-panel [role="option"][data-model]:not([data-section])')).toHaveCount(3);

  // Arrow keys move the highlight, the focus stays in the search box.
  await search.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowUp');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

  // End jumps to the last one.
  await search.press('End');
  await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  const lastModel = await options.last().getAttribute('data-model');

  // Enter takes the highlighted model.
  await search.press('Enter');
  await expect(page.locator('.picker-panel')).toHaveCount(0);
  await expect(page.locator('#picker-button')).toContainText(lastModel ?? '');
});

test('Escape closes the model picker', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await page.locator('#picker-button').click();
  await expect(page.locator('.picker-panel')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search models' }).press('Escape');
  await expect(page.locator('.picker-panel')).toHaveCount(0);
  // Focus returns to the button that opened it.
  await expect(page.locator('#picker-button')).toBeFocused();
});

test('code in a reply is highlighted', async ({ page }) => {
  await connectAndChat(page, 'show me some code');
  const code = page.locator('.msg.assistant pre.code code').last();

  // The test reply contains a console.log line, which is highlighted.
  await expect(code.locator('.tok-string').first()).toBeVisible();
  await expect(code).toContainText('console.log');
});

test('a file can be attached to a message', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);

  // Attach a text file through the real file input.
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('the answer is 42'),
  });
  await expect(page.locator('#pending-files .file-chip')).toContainText('notes.txt');

  await page.locator('#input').fill('what is in this file?');
  await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  // The attachment is kept with the message, and the model was told its name.
  await expect(page.locator('.msg.user .attachment-file')).toContainText('notes.txt');
  await expect(page.locator('.msg.assistant .body')).toContainText('what is in this file?');
});

test('a picture can be attached to a message', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);

  // One pixel of PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#file-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#pending-files .file-chip')).toContainText('pixel.png');

  await page.locator('#input').fill('what is this?');
  await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  await expect(page.locator('.msg.user .attachment-image')).toBeVisible();
});

test('a reply can be kept as an artifact beside the chat', async ({ page }) => {
  await connectAndChat(page, 'make me something');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();

  await expect(page.locator('#artifacts')).toBeVisible();
  await expect(page.locator('#artifact-count')).toHaveText('1');
  await expect(page.locator('#artifact-list .artifact-row')).toHaveCount(1);
  await expect(page.locator('#artifact-title')).toContainText('This is a local test reply');
});

test('an artifact keeps every version and can restore an older one', async ({ page }) => {
  await connectAndChat(page, 'make me something');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();
  await expect(page.locator('#artifact-view')).toBeVisible();

  // Editing is its own mode, opened from the Edit button.
  await page.locator('#artifact-view').getByRole('button', { name: 'Edit' }).click();
  const editor = page.locator('.artifact-edit');
  await editor.fill('version two');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.locator('#artifact-view .tag')).toContainText('v2');

  // Restore the first version: the old content comes back as a new version.
  await page.locator('#artifact-view select').selectOption('0');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('#artifact-view .tag')).toContainText('v3');
  await page.locator('#artifact-view').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.artifact-edit')).toHaveValue(/This is a local test reply/);
});

test('an artifact can be starred and deleted', async ({ page }) => {
  await connectAndChat(page, 'make me something');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();
  await expect(page.locator('#artifact-view')).toBeVisible();

  await page.getByRole('button', { name: /Star$/ }).click();
  await expect(page.locator('#artifact-list')).toContainText('★');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('#artifact-count')).toHaveText('0');
});

test('an HTML artifact is shown in a sandboxed frame', async ({ page }) => {
  await connectAndChat(page, 'make me a page');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();
  await expect(page.locator('#artifact-view')).toBeVisible();

  // The reply is Markdown, not HTML, so it renders as text. Change the kind to
  // HTML through the API and check the frame is locked down.
  const artifacts = await page.request.get('/api/artifacts').then((r) => r.json());
  const id = artifacts[0].id;
  await page.request.patch(`/api/artifacts/${id}`, {
    data: { kind: 'html', content: '<h1>Hello</h1><script>parent.postMessage("x","*")</script>' },
  });
  await page.reload();
  await page.locator('#artifacts-toggle').click();
  await page.locator('#artifact-list .artifact-row').first().click();

  const frame = page.locator('.artifact-frame');
  await expect(frame).toBeVisible();
  // No allow-same-origin: the frame cannot reach the app or its storage.
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(frame).not.toHaveAttribute('sandbox', /same-origin/);
});

test('an artifact can be opened on its own', async ({ page, context }) => {
  await connectAndChat(page, 'make me a page');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();
  await expect(page.locator('#artifact-view')).toBeVisible();

  const popupPromise = context.waitForEvent('page');
  await page.locator('#artifact-view').getByRole('button', { name: 'Open', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toContain('/raw');
  await expect(popup.locator('body')).toContainText('This is a local test reply');
});

test('an incognito chat leaves nothing behind', async ({ page, request }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);

  await page.locator('#incognito').click();
  await expect(page.locator('#mode')).toBeVisible();
  await page.locator('#input').fill('this must not be saved');
  await page.locator('#send').click();
  await expect(page.locator('.msg.assistant .body').last()).not.toHaveText('…', { timeout: 15_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  // Nothing was written: no chat, no session, no transcript on the server.
  const sessions = await (await request.get('/api/sessions')).json();
  expect(sessions).toHaveLength(0);
});

test('a project groups chats and filters the sidebar', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');

  await page.locator('#new-project').click();
  await page.locator('.project-form input').fill('Contracts');
  await page.locator('.project-form input').press('Enter');
  await expect(page.locator('#project-filter')).toContainText('Contracts');

  await pickFirstModel(page);
  await page.locator('#input').fill('a question about a contract');
  await page.locator('#send').click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  // The chat carries the project tag and the filter keeps showing it.
  await expect(page.locator('#sessions .tag')).toHaveText('Contracts');
  await expect(page.locator('#sessions .session-row')).toHaveCount(1);
});

test('long code in a reply starts folded and opens on request', async ({ page }) => {
  // The test reply repeats the message, so a long block in the message comes back in the reply.
  const lines = Array.from({ length: 30 }, (_, i) => `  <li>Item ${i + 1}</li>`);
  await connectAndChat(page, ['Here is a list:', '```html', '<ul>', ...lines, '</ul>', '```'].join('\n'));
  const body = page.locator('.msg.assistant .body').last();
  const long = body.locator('pre.code.is-foldable');
  await expect(long).toHaveCount(1);
  await expect(long).toHaveClass(/is-folded/);
  // The short block in the same reply is not folded.
  await expect(body.locator('pre.code:not(.is-foldable)')).toHaveCount(1);

  const show = long.locator('.code-foot [data-fold]');
  await expect(show).toHaveText('Show all 32 lines');
  const folded = await long.locator('code').evaluate((el) => el.clientHeight);
  await show.click();
  await expect(long).not.toHaveClass(/is-folded/);
  await expect(show).toHaveText('Show less');
  await expect(long.locator('.code-fold-top')).toHaveText('Collapse');
  expect(await long.locator('code').evaluate((el) => el.clientHeight)).toBeGreaterThan(folded * 2);

  // Collapse folds it again.
  await long.locator('.code-fold-top').click();
  await expect(long).toHaveClass(/is-folded/);

  // An HTML block can become an artifact that opens beside the chat.
  await long.locator('[data-to-artifact]').click();
  await expect(page.locator('#artifacts')).toBeVisible();
  await expect(page.locator('#artifact-count')).toHaveText('1');
});

test('a Markdown table in a reply is drawn as a table', async ({ page }) => {
  await connectAndChat(page, ['Disk space:', '| Drive | Free |', '|---|---:|', '| C: | 185 GB |', '| D: | 107 GB |'].join('\n'));
  const table = page.locator('.msg.assistant .body').last().locator('table.md-table');
  await expect(table.locator('th')).toHaveText(['Drive', 'Free']);
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table.locator('tbody tr').first().locator('td').last()).toHaveText('185 GB');
});
