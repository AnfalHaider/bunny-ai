import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtifact, htmlDocument } from '../src/ui/artifact-content.js';

test('a page inside a ```html reply is rendered as HTML, not shown as code', () => {
  const reply = 'Here is a simple todo app:\n\n```html\n<!DOCTYPE html>\n<html><body><h1>Todo</h1></body></html>\n```\n\nOpen it in a browser.';
  const shown = resolveArtifact(reply, 'code');
  assert.equal(shown.kind, 'html');
  assert.match(shown.body, /^<!DOCTYPE html>/);
  assert.doesNotMatch(shown.body, /```|Here is/);
});

test('bare HTML and SVG are HTML', () => {
  assert.equal(resolveArtifact('<div>hi</div>').kind, 'html');
  assert.equal(resolveArtifact('Logo:\n```svg\n<svg viewBox="0 0 1 1"></svg>\n```').kind, 'html');
});

test('a reply that is mostly one code block is that code, without the fences', () => {
  const shown = resolveArtifact('Sure:\n```python\nprint(1)\nfor i in range(3):\n    print(i)\n```');
  assert.deepEqual([shown.kind, shown.lang], ['code', 'python']);
  assert.doesNotMatch(shown.body, /```/);
});

test('prose with a small snippet stays Markdown', () => {
  assert.equal(resolveArtifact(`${'A long explanation. '.repeat(20)}\n\`\`\`js\nx()\n\`\`\``).kind, 'markdown');
  assert.equal(resolveArtifact('# Notes\nplain text').kind, 'markdown');
});

test('an HTML fragment gets a page around it; a full page is left alone', () => {
  assert.match(htmlDocument('<h1>Hi</h1>'), /^<!doctype html>[\s\S]*<h1>Hi<\/h1>/);
  const full = '<!doctype html><html><body>x</body></html>';
  assert.equal(htmlDocument(full), full);
});
