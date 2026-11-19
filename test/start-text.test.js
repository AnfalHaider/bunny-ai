import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TAGLINES } from '../src/ui/greetings.js';
import { t } from '../src/ui/i18n.js';

// An empty chat never tells the person to pick a model: one is always in effect (Auto, or the one chosen), so the line was wrong in the owner's screenshot (Auto was chosen).
test('the empty chat says "Type below to start." (in every language it has), and no line of the greeting asks for a model to be picked', async () => {
  assert.equal(t('chat.startText', 'en'), 'Type below to start.');
  for (const code of ['en', 'es', 'fr', 'ar']) assert.doesNotMatch(t('chat.startText', code), /pick|elige|choisissez|اختر/i, code);
  assert.ok(TAGLINES.every((l) => !/pick a model/i.test(l)), TAGLINES.join(' | '));
  for (const file of ['src/ui/index.html', 'src/ui/chat.js']) assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /Pick a model, then type below/, file);
});
