import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// THEME-APPLY: the desktop shell follows the theme the page applied (nativeTheme, window colours, browser pane), and only Bunny's own pages may say so.
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('the preload offers setTheme and main answers theme:set only for Bunny pages and only for light, dark or system', async () => {
  const preload = await read('../electron/preload.cjs');
  const main = await read('../electron/main.js');
  assert.match(preload, /setTheme: \(theme\) => ipcRenderer\.invoke\('theme:set', theme\)/);
  const handler = /ipcMain\.handle\('theme:set'[\s\S]*?\n\}\);/.exec(main)?.[0] ?? '';
  assert.match(handler, /isOwn\(event\.senderFrame\?\.url/);
  assert.match(handler, /\['light', 'dark', 'system'\]\.includes\(theme\)/);
  assert.match(handler, /nativeTheme\.themeSource = theme/);
  assert.match(handler, /paintWindows\(\)/);
  assert.match(main, /nativeTheme\.themeSource = \['light', 'dark'\]\.includes\(prefs\.theme\)/, 'the next start opens in the last chosen theme');
  assert.match(main, /backgroundColor: windowColor\(\)/, 'no fixed light window colour is left');
  assert.doesNotMatch(main, /backgroundColor: '#faf9f6'/);
});

test('every Settings page applies the saved appearance and has the boot script that sets the theme before the first paint', async () => {
  for (const page of ['index', 'settings', 'providers', 'automation', 'customize']) {
    const html = await read(`../src/ui/${page}.html`);
    assert.match(html, /<head>\s*<script src="\.\/theme-boot\.js"><\/script>/, `${page}.html loads theme-boot.js first`);
    if (page !== 'index') assert.match(html, /applyAppearance/, `${page}.html applies the saved appearance`); // the chat page does it in chat.js
  }
  assert.match(await read('../src/ui/theme-boot.js'), /bunny\.theme/);
});
