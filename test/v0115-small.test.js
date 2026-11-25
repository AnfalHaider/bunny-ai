import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// v0.1.15 small items (Builder B).
const engines = readFileSync(new URL('../src/ui/engines.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/ui/chat.js', import.meta.url), 'utf8');

test("the engine floor list: Bunny's own tools are not an item under the file-tools heading, but their own line under the list", () => {
  const list = engines.slice(engines.indexOf('const FLOOR_LIST'), engines.indexOf('const rulesLines'));
  const items = [...list.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 3, 'three folders are listed');
  assert.ok(!items.some((t) => /own tools/i.test(t)), "no list item says Bunny's own tools");
  assert.match(list, /<\/ul><div class="d" id="engine-floor-tools">Also: the model may never use Bunny&#39;s own tools\.<\/div>/);
});

test('the command palette is redrawn when the chat list loads late', () => {
  const load = chat.slice(chat.indexOf('async function loadSessions()'), chat.indexOf('/**\n * Background chats'));
  assert.match(load, /state\.sessions = rows;[\s\S]*refreshPalette\(\)/);
  const fn = chat.slice(chat.indexOf('function refreshPalette()'), chat.indexOf('function closePalette()'));
  assert.match(fn, /backdrop\.hidden/, 'nothing happens while the palette is closed');
  assert.match(fn, /renderPalette\(input\.value\)/, 'it redraws from the typed query');
});
