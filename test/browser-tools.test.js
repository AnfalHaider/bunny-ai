import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserToolDefinitions, describeBrowserTool, isBrowserTool, browserResultText, BROWSER_TOOL_RISK } from '../src/server/browserTools.js';

test('plan mode only offers the browser tools that look', () => {
  const names = browserToolDefinitions(['read']).map((d) => d.function.name);
  assert.deepEqual(names.sort(), ['browser_back', 'browser_open', 'browser_read', 'browser_screenshot', 'browser_scroll']);
  assert.equal(browserToolDefinitions().length, Object.keys(BROWSER_TOOL_RISK).length);
});

test('clicking and typing change pages, so they follow the permission mode', () => {
  assert.equal(BROWSER_TOOL_RISK.browser_click, 'edit');
  assert.equal(BROWSER_TOOL_RISK.browser_type, 'edit');
  assert.ok(isBrowserTool('browser_open'));
  assert.ok(!isBrowserTool('read_url'));
  assert.equal(describeBrowserTool('browser_type', { ref: 3, submit: true }), 'Type into element 3 and press Enter');
});

test('a page answer becomes numbered elements and text for the model', () => {
  const text = browserResultText({
    note: 'Clicked element 1.',
    page: { url: 'https://example.com/', title: 'Example', text: 'Hello', scroll: '', elements: [{ ref: 1, kind: 'link', label: 'More', value: '' }] },
  });
  assert.match(text, /Clicked element 1\./);
  assert.match(text, /Page: Example — https:\/\/example\.com\//);
  assert.match(text, /\[1\] link "More"/);
  assert.match(text, /Text:\nHello/);
});

test('a failed browser action is an error, not a quiet success', () => {
  assert.throws(() => browserResultText({ error: 'No page is open' }), /No page is open/);
  assert.equal(browserResultText(null), 'The browser panel did not answer.');
});
