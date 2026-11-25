import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

// QUICK-UI (v0.1.13): the Quick ask bar redesign (Design's page, version 2, option A: a ~92% opaque pill over a transparent window), 13 changes.
// Like quick-ask-bar.spec.js this opens the bar's own page at the real window size with a stand-in for the bridge (the Electron window itself is not run here);
// the stand-in records every call, so the window size, the keys and the buttons can be checked. Invented profile only: nothing here reads a real chat or key.
const ROOT = resolve('.');
let origin = '';
let staticServer;
test.beforeAll(async () => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
  staticServer = createServer(async (req, res) => {
    const target = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    const rel = target.startsWith(ROOT + sep) ? target.slice(ROOT.length + 1).split(sep).join('/') : '';
    if (!/^(electron\/quick-ask|src\/ui)\//.test(rel)) { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' }).end(await readFile(target)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${staticServer.address().port}`;
});
test.afterAll(() => new Promise((r) => staticServer.close(r)));

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Open the bar at its window width, with a recording stand-in for the bridge. `window.__calls` lists what the page asked for; `window.__emit(event)` plays an answer event. */
async function openBar(page, { scheme = 'light', config = {}, ask = 'ok' } = {}) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 640, height: 80 });
  await page.addInitScript(({ pixel, config: cfg, askMode }) => {
    window.__calls = [];
    window.__handler = null;
    const note = (name, ...args) => { window.__calls.push([name, ...args]); };
    window.quickAsk = {
      captureScreenshot: async () => ({ ok: true, data: pixel }),
      pickFile: async () => ({ ok: false, cancelled: true }),
      dropFile: async () => ({ ok: true }),
      submit: async () => ({ ok: false }),
      ask: (text) => { note('ask', text); return askMode === 'wait' ? new Promise(() => {}) : Promise.resolve({ ok: true }); },
      stop: async () => { note('stop'); return { ok: true }; },
      openInBunny: async (target) => { note('open', target ?? null); return { ok: true }; },
      resize: async (h) => { note('resize', h); return { ok: true }; },
      onAnswer: (fn) => { window.__handler = fn; return () => {}; },
      init: async () => window.__cfg ?? cfg,
      onRefresh: (fn) => { window.__refresh = fn; return () => {}; },
      close: async () => { note('close'); return { ok: true }; },
      escHandled: async () => { note('escHandled'); return { ok: true }; },
      onEscape: (fn) => { window.__esc = fn; return () => {}; },
    };
    window.__emit = (event) => window.__handler?.(event);
  }, { pixel: PIXEL, config, askMode: ask });
  await page.goto(`${origin}/electron/quick-ask/bar.html`);
}
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);
const lastResize = async (page) => { const r = await calls(page, 'resize'); return r.length ? r.at(-1)[1] : null; };

for (const scheme of ['light', 'dark']) {
  test(`1: Stop and Copy have real icons that are drawn, not 0 x 0 (${scheme})`, async ({ page }) => {
    await openBar(page, { scheme, ask: 'wait' });
    await page.locator('#text').fill('hello');
    await page.locator('#go').click();
    const stop = page.locator('#go svg');
    await expect(stop).toHaveCount(1);
    const stopBox = await stop.boundingBox();
    expect(stopBox.width).toBeGreaterThan(8);
    expect(stopBox.height).toBeGreaterThan(8);
    expect(await stop.evaluate((n) => n.namespaceURI)).toBe('http://www.w3.org/2000/svg');
    await page.evaluate(() => window.__emit({ type: 'delta', text: 'Here is the answer.' }));
    await page.evaluate(() => window.__emit({ type: 'done', model: 'Auto', finished: true }));
    const copy = page.locator('#go svg, #copy svg').first();
    await expect(copy).toBeVisible();
    const copyBox = await copy.boundingBox();
    expect(copyBox.width).toBeGreaterThan(8);
    expect(copyBox.height).toBeGreaterThan(8);
    // the thinking line has one indent, not two
    await page.evaluate(() => window.__emit({ type: 'start' }));
  });
}

test('2: the window is only as tall as the pill, and grows for the + menu and for an answer', async ({ page }) => {
  await openBar(page);
  await expect.poll(() => lastResize(page)).not.toBeNull();
  const rest = await lastResize(page);
  expect(rest).toBeLessThanOrEqual(76); // the pill alone: about 70, not the 300 of before
  expect(rest).toBeGreaterThanOrEqual(60);
  await page.locator('#text').fill('x'); // + and Send appear with the first keystroke
  await page.locator('#plus').click();
  const withMenu = await lastResize(page);
  expect(withMenu).toBeGreaterThan(rest + 60);
  const menuBottom = await page.locator('#menu').evaluate((m) => m.getBoundingClientRect().bottom);
  expect(withMenu).toBeGreaterThanOrEqual(menuBottom); // the menu is not cut off by the window
  await page.locator('#plus').click(); // closes
  await expect.poll(() => lastResize(page)).toBeLessThanOrEqual(110); // the pill with its keys line
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'delta', text: 'A line of the answer.\n\n'.repeat(12) }));
  await expect.poll(() => lastResize(page)).toBeGreaterThan(rest + 100);
});

test('3: Esc does one thing at a time: closes the + menu first, then stops a running answer, then closes the bar', async ({ page }) => {
  await openBar(page, { ask: 'ok' });
  // the + menu is open: Esc closes the menu, the focus goes back to +, the bar stays
  await page.locator('#text').fill('hi');
  await page.locator('#plus').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.evaluate(() => window.__esc());
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#plus')).toBeFocused();
  expect(await calls(page, 'escHandled')).toHaveLength(1);
  expect(await calls(page, 'close')).toHaveLength(0);
  // an answer is coming: Esc stops it (what arrived stays), and the bar stays
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'delta', text: 'Part of an answer' }));
  await page.evaluate(() => window.__esc());
  expect(await calls(page, 'stop')).toHaveLength(1);
  expect(await calls(page, 'escHandled')).toHaveLength(2);
  expect(await calls(page, 'close')).toHaveLength(0);
  await page.evaluate(() => window.__emit({ type: 'stopped' }));
  // nothing left to handle: Esc closes the bar
  await page.evaluate(() => window.__esc());
  expect(await calls(page, 'close')).toHaveLength(1);
});

/** Ask a question and finish an answer, for the tests that need an answer on screen. */
async function answered(page, answer = 'Here is the answer.') {
  await page.locator('#text').fill('What is a burrow?');
  await page.locator('#go').click();
  await page.evaluate((a) => { window.__emit({ type: 'delta', text: a }); window.__emit({ type: 'done', model: 'Auto', finished: true }); }, answer);
  await expect(page.locator('#follow')).toBeEnabled();
}

test('4: the keys are a quiet line from the first keystroke, stay through the answer, and Ctrl+Enter opens the chat once there is one', async ({ page }) => {
  await openBar(page);
  await expect(page.locator('#hint')).toBeHidden(); // the empty pill shows none
  await page.locator('#text').fill('h');
  await expect(page.locator('#hint')).toBeVisible();
  await expect(page.locator('#keyline')).toContainText('Enter to send');
  await page.locator('#text').press('Control+Enter');
  expect(await calls(page, 'open')).toHaveLength(0); // no chat yet
  expect(await calls(page, 'ask')).toHaveLength(0); // and Ctrl+Enter does not send
  await page.locator('#text').fill('What is a burrow?');
  await page.locator('#go').click();
  await expect(page.locator('#hint')).toBeVisible(); // stays through thinking
  await page.keyboard.press('Control+Enter');
  expect(await calls(page, 'open')).toHaveLength(0); // still no chat to open while it thinks
  await page.evaluate(() => { window.__emit({ type: 'delta', text: 'An answer.' }); window.__emit({ type: 'done', model: 'Auto' }); });
  await expect(page.locator('#hint')).toBeVisible();
  await expect(page.locator('#keyline')).toContainText('Ctrl+Enter');
  await page.keyboard.press('Control+Enter');
  expect(await calls(page, 'open')).toHaveLength(1);
  await expect(page.locator('#open .kb')).toHaveText('Ctrl+Enter');
});

test('5: Copy says "Copied", and each code block has its own Copy', async ({ page }) => {
  await page.addInitScript(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__clip.push(t); } }, configurable: true }); });
  await openBar(page);
  await answered(page, 'Run this:\n\n```js\nconsole.log("hi");\n```\n\nand that:\n\n```sh\nls\n```\n');
  await page.locator('#copy').click();
  await expect(page.locator('.copied')).toHaveText('Copied');
  expect((await page.evaluate(() => window.__clip))[0]).toContain('Run this:');
  const blocks = page.locator('#ans pre .cpy');
  await expect(blocks).toHaveCount(2);
  await blocks.nth(1).click();
  await expect(blocks.nth(1)).toHaveText('Copied');
  expect((await page.evaluate(() => window.__clip)).at(-1)).toContain('ls');
});

test('6: a long answer can be read while it streams: it follows the end until the reader scrolls up, then "Latest" brings them back', async ({ page }) => {
  await openBar(page, { ask: 'wait' });
  await page.locator('#text').fill('Tell me a lot');
  await page.locator('#go').click();
  const line = (n) => `Line ${n} of a long answer.\n\n`;
  await page.evaluate((text) => window.__emit({ type: 'delta', text }), Array.from({ length: 40 }, (_, i) => line(i)).join(''));
  const ans = page.locator('#ans');
  const nearEnd = () => ans.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight < 30);
  expect(await nearEnd()).toBe(true); // following
  await ans.evaluate((n) => { n.scrollTop = 0; n.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('#latest')).toBeVisible();
  await page.evaluate((text) => window.__emit({ type: 'delta', text }), Array.from({ length: 10 }, (_, i) => line(100 + i)).join(''));
  expect(await ans.evaluate((n) => n.scrollTop)).toBeLessThan(40); // it did not jump to the end
  await page.locator('#latest').click();
  expect(await nearEnd()).toBe(true);
  await expect(page.locator('#latest')).toBeHidden();
});

test('7: earlier turns stay, folded, and a long question is cut to three lines', async ({ page }) => {
  await openBar(page);
  await answered(page, 'First answer.');
  await expect(page.locator('#earlier')).toBeHidden();
  await page.locator('#follow').fill('And a second question that is quite long '.repeat(14));
  await page.locator('#follow').press('Enter');
  await expect(page.locator('#earlier')).toBeVisible();
  await expect(page.locator('#earlier-toggle')).toContainText('Earlier in this chat (1)');
  await expect(page.locator('#earlier-list')).toBeHidden();
  await page.locator('#earlier-toggle').click();
  await expect(page.locator('#earlier-list')).toContainText('What is a burrow?');
  await expect(page.locator('#earlier-list')).toContainText('First answer.');
  const q = page.locator('#q');
  const lineHeight = await q.evaluate((n) => parseFloat(getComputedStyle(n).lineHeight));
  expect((await q.boundingBox()).height).toBeLessThanOrEqual(lineHeight * 3 + 16 + 1); // three lines and its padding
  expect(await q.getAttribute('title')).toContain('quite long'); // the whole question is in the tooltip
});

test('10: "No model connected" leads with Open Bunny settings and has no Try again', async ({ page }) => {
  await openBar(page);
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'error', kind: 'none', message: 'No model' }));
  const card = page.locator('#card .cardx.bad');
  await expect(card.getByRole('button', { name: 'Open Bunny settings' })).toBeFocused();
  await expect(card.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Open Bunny settings' }).click();
  expect(await calls(page, 'open')).toEqual([['open', 'settings']]);
});

test('11 and 12: at rest the pill is just the mark and the placeholder; the first keystroke brings + and Send; + is reached by Tab even when hidden', async ({ page }) => {
  await openBar(page);
  await expect(page.locator('#text')).toHaveAttribute('placeholder', 'What are we burrowing into?');
  const rest = await page.evaluate(() => {
    const bar = getComputedStyle(document.getElementById('bar'));
    const w = (id) => ({ opacity: getComputedStyle(document.getElementById(id)).opacity });
    return { radius: bar.borderTopLeftRadius, bg: bar.backgroundColor, plus: w('plus'), go: w('go') };
  });
  expect(rest.radius).toBe('20px');
  expect(rest.bg).toMatch(/rgba\(255, 255, 255, 0\.92\)/); // about 92% opaque, over a transparent window
  expect(Number(rest.plus.opacity)).toBe(0);
  expect(Number(rest.go.opacity)).toBe(0);
  await page.locator('#text').fill('x');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('go')).opacity)).toBe('1');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('plus')).opacity)).toBe('1');
  await page.locator('#text').fill('');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('plus')).opacity)).toBe('0');
  await page.locator('#text').focus();
  await page.keyboard.press('Tab'); // the hidden + takes the focus and shows itself
  await expect(page.locator('#plus')).toBeFocused();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('plus')).opacity)).toBe('1');
  expect((await page.locator('#plus').boundingBox()).width).toBeGreaterThan(20);
});

test('13: the buttons fade in over 160 ms and the answer opens over 220 ms; all of it is off with reduced motion', async ({ page }) => {
  await openBar(page);
  const times = () => page.evaluate(() => ({ go: getComputedStyle(document.getElementById('go')).transitionDuration, panel: getComputedStyle(document.getElementById('panel-wrap')).transitionDuration }));
  const normal = await times();
  expect(normal.go).toContain('0.16s');
  expect(normal.panel).toBe('0.22s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await times();
  expect(reduced.go).toBe('0s');
  expect(reduced.panel).toBe('0s');
});

// Pictures of every state, in both themes, on an invented profile: written when QUICKUI_SHOTS names a folder (they are what Design and QA look at; not part of the gate).
for (const scheme of ['light', 'dark']) {
  test(`pictures: every state of the pill (${scheme})`, async ({ page }) => {
    const folder = process.env.QUICKUI_SHOTS;
    test.skip(!folder, 'QUICKUI_SHOTS is not set');
    await openBar(page, { scheme, config: {}, ask: 'ok' });
    // a wallpaper behind the transparent window, like the one in Design's page
    await page.addStyleTag({ content: `html { background: ${scheme === 'dark' ? 'linear-gradient(135deg,#24304a 0%,#3b2f4a 55%,#4a3a3c 100%)' : 'linear-gradient(135deg,#a8c3e6 0%,#e7c8d8 55%,#f3dbb8 100%)'} !important; }` });
    await page.setViewportSize({ width: 640, height: 720 });
    const shoot = async (name) => {
      await page.waitForTimeout(350); // the eased height and the fades settle
      await page.evaluate(() => window.scrollTo(0, 0));
      const bottom = await page.evaluate(() => Math.ceil(Math.max(document.getElementById('bar').getBoundingClientRect().bottom, document.getElementById('menu').hidden ? 0 : document.getElementById('menu').getBoundingClientRect().bottom)) + 8);
      await page.screenshot({ path: `${folder}/${name}-${scheme}.png`, clip: { x: 0, y: 0, width: 640, height: Math.min(bottom, 720) } });
    };
    await shoot('rest');
    await page.locator('#text').fill('How do rabbits dig a burrow?');
    await shoot('typing');
    await page.locator('#plus').click();
    await shoot('menu');
    await page.locator('#plus').click();
    await page.locator('#go').click();
    await shoot('thinking');
    await page.evaluate(() => window.__emit({ type: 'delta', text: 'Rabbits dig with their front paws and push the soil back with their hind legs. A burrow has several rooms.\n\n```text\nentrance -> tunnel -> nest\n```\n' }));
    await page.evaluate(() => window.__emit({ type: 'done', model: 'Auto' }));
    await shoot('answer');
    await page.locator('#follow').fill('And how deep?');
    await page.locator('#follow').press('Enter');
    await page.evaluate(() => window.__emit({ type: 'delta', text: 'Usually one to two metres, deeper in cold places.' }));
    await page.evaluate(() => window.__emit({ type: 'done', model: 'Auto' }));
    await shoot('earlier');
    // the problem states are each a fresh question that ends in the card (the bar is opened again, as it would be)
    const wall = `html { background: ${scheme === 'dark' ? 'linear-gradient(135deg,#24304a 0%,#3b2f4a 55%,#4a3a3c 100%)' : 'linear-gradient(135deg,#a8c3e6 0%,#e7c8d8 55%,#f3dbb8 100%)'} !important; }`;
    for (const [name, event] of [['no-model', { type: 'error', kind: 'none', message: 'No model' }], ['needs-window', { type: 'needs-window', text: 'I would need to read your files for that.' }], ['offline', { type: 'error', kind: 'offline', message: '' }]]) {
      await page.reload();
      await page.addStyleTag({ content: wall });
      await page.locator('#text').fill('How do rabbits dig a burrow?');
      await page.locator('#go').click();
      await page.evaluate((e) => window.__emit(e), event);
      await shoot(name);
    }
  });
}

test('8: the keys line says which model will answer, as text, once you type; nothing when the app could not say', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: '', model: 'llama-3-70b' } });
  await expect(page.locator('#modelline')).toBeHidden(); // the empty pill shows none
  await page.locator('#text').fill('x');
  await expect(page.locator('#modelline')).toHaveText('Answers with llama-3-70b · web search');
});

test('8: with no model name, no model line is drawn', async ({ page }) => {
  await openBar(page, { config: {} });
  await page.locator('#text').fill('x');
  await expect(page.locator('#hint')).toBeVisible();
  await expect(page.locator('#modelline')).toBeHidden();
});

for (const [theme, scheme, expected] of [['dark', 'light', 'rgba(38, 39, 44, 0.92)'], ['light', 'dark', 'rgba(255, 255, 255, 0.92)'], ['system', 'dark', 'rgba(38, 39, 44, 0.92)'], ['system', 'light', 'rgba(255, 255, 255, 0.92)']]) {
  test(`9: the bar follows Bunny's Theme (${theme}) over the system (${scheme})`, async ({ page }) => {
    await openBar(page, { scheme, config: { theme } });
    await expect(page.locator('html')).not.toHaveAttribute('data-pending', '');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('bar')).backgroundColor)).toBe(expected);
  });
}

test('9: the bar uses Bunny\'s interface font: a bundled one is loaded from the package (and really loads), an unknown key changes nothing', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'lexend' } });
  await expect(page.locator('html')).not.toHaveAttribute('data-pending', '');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Bunny Lexend');
  expect(await page.evaluate(async () => { await document.fonts.load('15px "Bunny Lexend"'); return document.fonts.check('15px "Bunny Lexend"'); })).toBe(true);
  await page.locator('#text').fill('Fonts');
  const sans = await page.evaluate(() => getComputedStyle(document.getElementById('text')).fontFamily);
  expect(sans).toContain('Bunny Lexend'); // the box, the buttons and the answer all follow
  // a key that is not on the list: the system font, and no font style is added
  const other = await page.context().newPage();
  await other.emulateMedia({ colorScheme: 'light' });
  await other.addInitScript(() => { window.quickAsk = { init: async () => ({ theme: 'system', font: 'https://evil.example/x.woff2' }), resize: async () => ({}), onAnswer: () => () => {}, onEscape: () => () => {}, close: async () => ({}), escHandled: async () => ({}), stop: async () => ({}), openInBunny: async () => ({}) }; });
  await other.goto(`${origin}/electron/quick-ask/bar.html`);
  await expect(other.locator('html')).not.toHaveAttribute('data-pending', '');
  expect(await other.evaluate(() => getComputedStyle(document.body).fontFamily)).not.toContain('evil');
  expect(await other.locator('#bar-fonts').count()).toBe(0);
  await other.close();
});

test('9: Bunny\'s reduced motion turns the transitions off, whatever the system says', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: 'reduced' } });
  await expect(page.locator('html')).not.toHaveAttribute('data-pending', '');
  const times = await page.evaluate(() => ({ go: getComputedStyle(document.getElementById('go')).transitionDuration, panel: getComputedStyle(document.getElementById('panel-wrap')).transitionDuration }));
  expect(times).toEqual({ go: '0s', panel: '0s' });
});

test('9: a bridge that never answers does not leave the bar hidden: it shows itself within 300 ms', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => { window.quickAsk = { init: () => new Promise(() => {}), resize: async () => ({}), onAnswer: () => () => {}, onEscape: () => () => {}, close: async () => ({}), escHandled: async () => ({}), stop: async () => ({}), openInBunny: async () => ({}) }; });
  await page.goto(`${origin}/electron/quick-ask/bar.html`);
  await expect(page.locator('html')).not.toHaveAttribute('data-pending', '', { timeout: 1500 });
  await expect(page.locator('#text')).toBeVisible();
});

// The drawing's problem states (Design, Quick ask v2) are the card and the keys line: no follow-up row, no second "Open in Bunny", and keys that fit what the card allows.
for (const [name, event, keys, buttons] of [
  ['no model connected', { type: 'error', kind: 'none', message: 'No model' }, 'Esc closes', ['Open Bunny settings']],
  ['offline', { type: 'error', kind: 'offline', message: '' }, 'Ctrl+Enter opens it in Bunny · Esc closes', ['Try again', 'Open in Bunny']],
  ['needs Bunny\'s window', { type: 'needs-window', text: '' }, 'Ctrl+Enter opens it in Bunny · Esc closes', ['Open in Bunny']],
  ['another problem', { type: 'error', kind: 'other', message: 'Something broke' }, 'Ctrl+Enter opens it in Bunny · Esc closes', ['Try again', 'Open in Bunny']],
]) {
  test(`${name}: only the card and its keys line: no follow-up field, no second Open in Bunny, and keys that fit`, async ({ page }) => {
    await openBar(page);
    await page.locator('#text').fill('hello');
    await page.locator('#go').click();
    await page.evaluate((e) => window.__emit(e), event);
    await expect(page.locator('#card .cardx')).toBeVisible();
    await expect(page.locator('#foot')).toBeHidden();
    await expect(page.locator('#follow')).toBeHidden();
    await expect(page.locator('#open')).toBeHidden();
    await expect(page.locator('#keyline')).toHaveText(keys);
    await expect(page.locator('#card .cardx button')).toHaveText(buttons);
    expect(await page.locator('button:visible', { hasText: 'Open in Bunny' }).count()).toBe(buttons.includes('Open in Bunny') ? 1 : 0); // never two
    // Ctrl+Enter does only what the card allows
    await page.keyboard.press('Control+Enter');
    const opened = await calls(page, 'open');
    expect(opened).toHaveLength(keys.includes('Ctrl+Enter') ? 1 : 0);
  });
}

test('a retry after a problem brings the follow-up row back with the answer', async ({ page }) => {
  await openBar(page);
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'error', kind: 'offline', message: '' }));
  await expect(page.locator('#foot')).toBeHidden();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#foot')).toBeVisible();
  await page.evaluate(() => { window.__emit({ type: 'delta', text: 'It worked.' }); window.__emit({ type: 'done', model: 'Auto' }); });
  await expect(page.locator('#follow')).toBeEnabled();
  await expect(page.locator('#keyline')).toContainText('Enter sends a follow-up');
});

// v0.1.13 clip fix (found by QA in the real window): the window is still short when a card opens, and focusing the card's button used to scroll the overflow-hidden page, so the pill's top was cut and the window settled too small.
for (const [name, event] of [['model error', { type: 'error', kind: 'other', message: 'The model answered 500' }], ['offline', { type: 'error', kind: 'offline', message: '' }], ['no model', { type: 'error', kind: 'none', message: 'No model' }], ['needs window', { type: 'needs-window', text: 'I would need to read your files.' }]]) {
  test(`clip: the ${name} card leaves the page unscrolled and the window as tall as the whole pill`, async ({ page }) => {
    await openBar(page); // the viewport stays 80 px high, like the window before main has grown it
    await page.locator('#text').fill('How do rabbits dig a burrow?');
    await page.locator('#go').click();
    await page.evaluate((e) => window.__emit(e), event);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => { const r = document.getElementById('bar').getBoundingClientRect(); return { scrollY: window.scrollY, top: r.top, bottom: r.bottom, resizes: window.__calls.filter((c) => c[0] === 'resize').map((c) => c[1]) }; });
    expect(m.scrollY).toBe(0);
    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.resizes.at(-1)).toBe(Math.ceil(m.bottom) + 8); // the window height asked for is the pill's full height
    expect(m.resizes.at(-1)).toBeGreaterThanOrEqual(Math.ceil(m.top) + 8 + Math.floor(m.bottom - m.top));
  });
}

// v0.1.14.1, QUICK ASK: what the bar shows for the owner's two refusals
test('a question about a file that the model sent to the window, while Search this PC is off, gets the "Search this PC is off" card with a way to the switch, not the generic window card', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: '', model: 'm', pcSearch: false } });
  await page.locator('#text').fill('last month PLS file DHA-2'); // no "find" or "search": the old check missed it
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'needs-window', text: 'I would have to look on this computer.' }));
  await expect(page.locator('#card')).toContainText('Search this PC is off');
  await expect(page.locator('#card')).not.toContainText("This needs Bunny's window");
  await page.locator('#card button', { hasText: 'Open Bunny settings' }).click();
  expect(await calls(page, 'open')).toEqual([['open', 'search-settings']]);
});

test('with Search this PC on, a question about a file that still ended in the window card keeps the generic card (the switch is not the reason)', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: '', model: 'm', pcSearch: true } });
  await page.locator('#text').fill('last month PLS file DHA-2');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'needs-window', text: '' }));
  await expect(page.locator('#card')).toContainText("This needs Bunny's window");
});

test('a restart drops the first reply and shows that Bunny is looking it up; the meta line then says web search, and the keys line says web search too', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: '', model: 'ernie', pcSearch: false } });
  await page.locator('#text').fill('what is the weather like in islamabad today? search the internet');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'delta', text: 'I cannot browse the internet.' }));
  await page.evaluate(() => window.__emit({ type: 'restart' }));
  await expect(page.locator('#ans')).not.toContainText('cannot browse');
  await expect(page.locator('#busy')).toContainText('Looking it up on the web');
  await page.evaluate(() => { window.__emit({ type: 'delta', text: 'Islamabad: 24 °C (weather.example).' }); window.__emit({ type: 'done', model: 'ernie', finished: true, lookups: 1 }); });
  await expect(page.locator('#ans')).toContainText('weather.example');
  await expect(page.locator('#meta')).toHaveText('Answered by ernie · web search');
  await expect(page.locator('#card')).toBeHidden();
});

// v0.1.14.2 (QA's audit at e2ec6ec6)
test('Bunny\'s own words when Search this PC is off: the answer is Bunny\'s sentence and the card has the way to the switch; no model line, never "open the full app"', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: '', model: 'm', pcSearch: false } });
  await page.locator('#text').fill('find my tax returns file');
  await page.locator('#go').click();
  await page.evaluate(() => { window.__emit({ type: 'delta', text: 'I cannot see files. Open the full Bunny app.' }); window.__emit({ type: 'restart' }); window.__emit({ type: 'delta', text: 'Search this PC is off. Turn it on in Settings › Capabilities to let Bunny look for files on this computer. Nothing was searched.' }); window.__emit({ type: 'done', model: 'm', finished: true, own: 'pc-off' }); });
  await expect(page.locator('#ans')).not.toContainText('open the full');
  await expect(page.locator('#card')).toContainText('Search this PC is off');
  await expect(page.locator('#meta')).toBeHidden();
  await page.locator('#card button', { hasText: 'Open Bunny settings' }).click();
  expect(await calls(page, 'open')).toEqual([['open', 'search-settings']]);
});

test('a kept bar that is shown again reads Bunny\'s settings again: Search this PC turned on meanwhile appears in the + menu and the model line', async ({ page }) => {
  await openBar(page, { config: { theme: 'system', font: 'system', motion: '', model: 'm', pcSearch: false } });
  await page.locator('#text').fill('x');
  await expect(page.locator('#modelline')).toHaveText('Answers with m · web search');
  await expect(page.locator('#pc-item')).toBeHidden();
  await page.evaluate(() => { window.__cfg = { theme: 'system', font: 'system', motion: '', model: 'm', pcSearch: true }; window.__refresh(); }); // the main process: "the bar was shown again"
  await expect(page.locator('#modelline')).toHaveText('Answers with m · web search and files on this PC');
  await page.locator('#plus').click().catch(() => {});
  await expect(page.locator('#pc-item')).toBeAttached();
  expect(await page.locator('#pc-item').evaluate((e) => e.hidden)).toBe(false);
});
