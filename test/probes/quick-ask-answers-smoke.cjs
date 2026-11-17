// QA-ANSWERS probe in the REAL Electron (not run by the unit suite): `npx electron test/probes/quick-ask-answers-smoke.cjs`
// The real bar window (electron/quick-ask.js + quick-ask/bar.html + bar.js + the preload) with a stand-in for Bunny's server that streams a HOSTILE reply.
// Prints what really happened: does the reply stay text, do links and pictures stay inert, does the bar grow and stop, and does Open in Bunny carry the chat over.
// Uses an invented userData folder only; never Bunny's real profile.
const { app, BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'bunny-qa-answers-')));
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 220) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const HOSTILE = 'Here you go:\n\n<img src=x onerror="window.__pwned=1">\n\n[click me](javascript:window.__pwned=2) and [site](https://example.com/)\n\n<script>window.__pwned=3</script>\n\n![remote](https://example.com/pixel.png)\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n';
const LONG = Array.from({ length: 60 }, (_, i) => `Line ${i} of a very long answer.`).join('\n\n');

app.on('window-all-closed', () => {}); // closing the bar must not quit the probe
async function main() {
  await app.whenReady();
  const mod = await import(pathToFileURL(join(__dirname, '..', '..', 'electron', 'quick-ask.js')).href);
  let scenario = 'hostile';
  const requests = [];
  const opened = [];
  const adminFetch = async (path, init = {}) => {
    requests.push({ path, body: init.body ? JSON.parse(init.body) : null });
    if (path === '/api/sessions') return new Response(JSON.stringify({ id: ID }), { status: 200, headers: { 'content-type': 'application/json' } });
    const enc = new TextEncoder();
    const text = scenario === 'long' ? LONG : scenario === 'needs' ? '[[NEEDS_BUNNY_WINDOW]]\nI would have to rename a file on your computer.' : HOSTILE;
    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode(frame('delta', { text: text.slice(0, 20) })));
        await wait(150);
        c.enqueue(enc.encode(frame('delta', { text: text.slice(20) })));
        if (scenario === 'slow') { init.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))); return; }
        c.enqueue(enc.encode(frame('done', { model: 'falcon-flash' })));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const api = mod.createQuickAsk({
    BrowserWindow, globalShortcut, screen, desktopCapturer, ipcMain, onSubmit: async () => true, adminFetch,
    onOpenChat: (id) => opened.push(id),
  });
  const barWindow = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('quick-ask/bar.html'));
  const logs = [];
  const openBar = async () => {
    api.open();
    await wait(1500);
    const w = barWindow();
    w?.webContents.on('console-message', (_e, level, message) => logs.push(`${level}:${message}`));
    return w;
  };
  const js = (w, code) => w.webContents.executeJavaScript(code);
  const askIn = async (w, q) => js(w, `(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(q)}; t.dispatchEvent(new Event('input')); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);

  // 1. a hostile reply is shown as inert text
  let w = await openBar();
  check('the bar opened and its page (with the markdown module) loaded without errors', Boolean(w) && !logs.some((l) => /^3:/.test(l)), logs.join(' | '));
  if (!w) { console.log('no bar window'); app.exit(2); return; }
  await askIn(w, 'Give me the hostile reply');
  await wait(1200);
  const state = await js(w, `({ pwned: window.__pwned ?? null, anchors: document.querySelectorAll('#ans a').length, imgs: document.querySelectorAll('#ans img').length, scripts: document.querySelectorAll('#ans script').length, handlers: [...document.querySelectorAll('#ans *')].some((e) => [...e.attributes].some((a) => /^on/i.test(a.name))), text: document.getElementById('ans').innerText, question: document.getElementById('q')?.textContent, meta: document.getElementById('meta').textContent, followEnabled: !document.getElementById('follow').disabled })`);
  check('the question stays on top', state.question === 'Give me the hostile reply', state.question);
  check('no script of the reply ran', state.pwned === null, state.pwned);
  check('no link, picture, script or event handler survived in the reply', state.anchors === 0 && state.imgs === 0 && state.scripts === 0 && !state.handlers, JSON.stringify(state));
  check('the reply text is there, as text', /Here you go/.test(state.text) && /click me/.test(state.text) && /one/.test(state.text), state.text.slice(0, 80));
  check('the model line is quiet and says text only', /Answered by falcon-flash · text only/.test(state.meta), state.meta);
  check('the follow-up box is on after the answer', state.followEnabled);
  const sent = requests.find((r) => /\/messages$/.test(r.path));
  check('the request was text only, in Chat mode, with no tools', sent?.body?.textOnly === true && sent.body.workMode === 'chat' && !('tools' in sent.body), JSON.stringify(sent?.body));
  check('the chat was made tagged quick-ask', requests[0]?.body?.origin === 'quick-ask', JSON.stringify(requests[0]?.body));
  // a click on a (now inert) link goes nowhere: still the same page
  const urlBefore = w.webContents.getURL();
  await js(w, `document.querySelector('#ans span[title]')?.click(); 0`);
  await wait(300);
  check('the bar never navigates', w.webContents.getURL() === urlBefore);

  // 2. Open in Bunny carries the chat over and closes the bar
  await js(w, `document.getElementById('open').click(); 0`);
  await wait(500);
  check('Open in Bunny handed over the chat id', opened[0] === ID, opened.join(','));
  check('and the bar closed', !barWindow());

  // 3. a long answer grows the bar to about 560 px and scrolls inside
  scenario = 'long';
  w = await openBar();
  await askIn(w, 'Explain it at length');
  await wait(1500);
  const tall = w.getBounds().height;
  const scrolls = await js(w, `(() => { const a = document.getElementById('ans'); return a.scrollHeight > a.clientHeight; })()`);
  check('a long answer grows the bar, but not past about 560 px', tall > 300 && tall <= 560, `height ${tall}`);
  check('and scrolls inside the panel', scrolls);

  // 4. Esc while it is answering stops it and closes the bar; the chat is kept (nothing deletes it)
  scenario = 'slow';
  await js(w, `0`);
  w.webContents.send; // keep the linter quiet
  w.close();
  await wait(300);
  w = await openBar();
  await askIn(w, 'A slow one');
  await wait(500);
  const answeringBefore = await js(w, `document.getElementById('go').getAttribute('aria-label')`);
  check('while it answers, the top button is Stop', answeringBefore === 'Stop', answeringBefore);
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await wait(600);
  check('Esc closed the bar', !barWindow());
  check('and no request deleted the chat', !requests.some((r) => /DELETE/.test(JSON.stringify(r))));

  // 5. "needs a tool": a card, no Allow button anywhere
  scenario = 'needs';
  w = await openBar();
  await askIn(w, 'Rename my invoice');
  await wait(1200);
  const needs = await js(w, `({ card: document.getElementById('card').innerText, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean) })`);
  check('the "needs Bunny\'s window" card is shown with the model\'s sentence', /This needs Bunny's window/.test(needs.card) && /rename a file/.test(await js(w, `document.getElementById('ans').innerText`)), needs.card.slice(0, 120));
  check('there is no Allow button in the bar', !needs.buttons.some((b) => /allow|approve|permit|yes/i.test(b)), needs.buttons.join(','));
  w.close();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  [${r.detail}]`}`);
  console.log(failed.length ? `PROBE FAILED: ${failed.length} of ${results.length}` : `PROBE PASSED: ${results.length} of ${results.length}`);
  app.exit(failed.length ? 1 : 0);
}
main().catch((err) => { console.error('probe crashed:', err); app.exit(2); });
