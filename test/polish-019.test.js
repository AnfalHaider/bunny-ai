/**
 * v0.1.9 polish (QA's gaps 7 to 9, 11): the picker's group labels and the amber switch line are readable in the light theme, the "no provider
 * has it left" line is plain, and a typed answer that only uses a stop-like word ("yes, no problem") is still a go-ahead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goesThenStops } from '../src/server/chat.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const token = (css, name, from = 0) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css.slice(from))?.[1];

test('gap 7 and 8: the picker group labels and the amber switch line use the readable text colours (4.5 to 1 or better on the light canvas)', () => {
  const system = read('../docs/design/bunny-design-system.css');
  const bindings = read('../docs/design/bunny-app-bindings.css');
  const app = read('../src/ui/app.css');
  for (const css of [bindings, app]) {
    assert.match(css, /\.picker-chip-label \{[^}]*color: var\(--text-dim\)/, 'picker group labels');
    assert.match(css, /\.picker-group \{[^}]*color: var\(--text-dim\)/, 'picker group headings');
    assert.match(css, /\.switch-note \{ color: var\(--warn-text\); \}/, 'the amber model-switch line');
  }
  const bg = token(system, '--bg');
  const surface = token(system, '--surface');
  for (const name of ['--text-dim', '--warn-text']) {
    const colour = token(system, name);
    assert.ok(colour, name);
    for (const ground of [bg, surface]) assert.ok(contrast(colour, ground) >= 4.5, `${name} on ${ground}: ${contrast(colour, ground).toFixed(2)}`);
  }
});

test('gap 9: the "no provider has it left" line has no brackets inside brackets and says how many others failed', () => {
  const words = read('../src/ui/i18n-agent.js');
  const line = /'model\.switchedModel': '([^']*)'/.exec(words)?.[1] ?? '';
  assert.match(line, /^Switched to \{model\}: no provider has \{from\} left\. \{provider\} \{reason\}\{more\}$/);
  const chat = read('../src/ui/chat.js');
  assert.match(chat, /displayName \?\? m\.fellBackFrom/, 'the model the person picked is named by its name, not its id');
  assert.match(chat, /other provider\$\{m\.fellBackTries - 1 === 1 \? '' : 's'\} also failed/);
});

test('gap 11: a go-ahead that only uses a stop-like word goes on; a go-ahead followed by a real stop stops', () => {
  for (const goes of ['yes, no problem', 'continue, don\'t stop', 'carry on, not a problem', 'yes, no worries', 'keep going, do not stop', 'go on, no need to stop', 'yes', 'continue', 'keep going please']) {
    assert.equal(goesThenStops(goes), false, goes);
  }
  for (const stops of ['continue, stop', 'yes, wait', 'carry on, no', 'keep going, don\'t', 'yes, hold on', 'go on, not yet']) {
    assert.equal(goesThenStops(stops), true, stops);
  }
  assert.equal(goesThenStops('stop'), false, 'only a go-ahead word FOLLOWED by a stop counts here (a bare stop is not a go-ahead at all)');
  assert.equal(goesThenStops(''), false);
});
