import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_WINDOW_MARKER, classifyFailure, createAnswerer, parseSse } from '../electron/quick-ask-answer.js';

// QA-ANSWERS (main-process side): text only, plain events to the bar, failures sorted into the three cards, a stop that keeps what arrived.
const ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** A stand-in for Bunny's server: records every request and answers messages with the given events (split into chunks as given). */
function server({ events = [frame('delta', { text: 'Hello' }), frame('done', { model: 'falcon' })], status = 200, errorBody = null, hang = false } = {}) {
  const calls = [];
  const adminFetch = async (path, init = {}) => {
    calls.push({ path, init, body: init.body ? JSON.parse(init.body) : null });
    if (path === '/api/sessions') return new Response(JSON.stringify({ id: ID }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (status !== 200) return new Response(JSON.stringify(errorBody ?? { message: 'no' }), { status, headers: { 'content-type': 'application/json' } });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const e of events) controller.enqueue(enc.encode(e));
        if (hang) { init.signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))); return; }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { adminFetch, calls };
}
const collect = () => { const got = []; return { got, emit: (e) => got.push(e) }; };

test('parseSse reads complete events and keeps the rest', () => {
  const r = parseSse(`${frame('delta', { text: 'a' })}${frame('done', { model: 'm' })}event: delta\ndata: {"te`);
  assert.deepEqual(r.events.map((e) => [e.name, e.data]), [['delta', { text: 'a' }], ['done', { model: 'm' }]]);
  assert.equal(r.rest, 'event: delta\ndata: {"te');
});

test('a question starts a chat tagged quick-ask, is sent text only with no tools, and the reply streams to the bar as plain events', async () => {
  const s = server({ events: [frame('delta', { text: 'A 429 ' }), frame('delta', { text: 'means too many.' }), frame('done', { model: 'falcon-flash' })] });
  const c = collect();
  const a = createAnswerer({ adminFetch: s.adminFetch, emit: c.emit });
  await a.ask({ text: 'What does the 429 status code mean?' });
  assert.deepEqual(s.calls[0].body, { title: 'What does the 429 status code mean?', workMode: 'chat', origin: 'quick-ask' });
  const sent = s.calls[1];
  assert.equal(sent.path, `/api/sessions/${ID}/messages`);
  assert.equal(sent.body.textOnly, true);
  assert.equal(sent.body.workMode, 'chat');
  assert.equal('tools' in sent.body, false);
  assert.deepEqual(c.got.map((e) => e.type), ['start', 'delta', 'delta', 'done']);
  assert.equal(c.got.at(-1).model, 'falcon-flash');
  assert.equal(c.got.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'A 429 means too many.');
  assert.equal(a.sessionId, ID);
  // a follow-up continues the same chat
  await a.ask({ text: 'And 503?' });
  assert.equal(s.calls.filter((x) => x.path === '/api/sessions').length, 1, 'one chat');
  assert.equal(s.calls.at(-1).path, `/api/sessions/${ID}/messages`);
});

test('only plain data reaches the bar: a reply is text, never an object with anything to run', async () => {
  const s = server({ events: [frame('delta', { text: '<img src=x onerror=alert(1)>' }), frame('done', { model: 'm', secret: 'x', tool: { run: 'rm' } })] });
  const c = collect();
  await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text: 'q' });
  for (const e of c.got) assert.ok(['start', 'delta', 'done', 'error', 'needs-window', 'stopped'].includes(e.type));
  assert.deepEqual(Object.keys(c.got.at(-1)).sort(), ['finished', 'model', 'type']);
  assert.equal(c.got[1].text, '<img src=x onerror=alert(1)>', 'kept as text: the bar shows it through the sanitiser');
});

test('a reply that begins with the marker becomes the "needs Bunny\'s window" card, even when the marker arrives in pieces', async () => {
  const s = server({ events: [frame('delta', { text: '[[NEEDS_BUN' }), frame('delta', { text: `NY_WINDOW]]\nI would have to look through your Downloads folder.` }), frame('done', { model: 'm' })] });
  const c = collect();
  await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text: 'rename my invoice' });
  assert.deepEqual(c.got.map((e) => e.type), ['start', 'needs-window']);
  assert.equal(c.got.at(-1).text, 'I would have to look through your Downloads folder.');
  assert.ok(NEEDS_WINDOW_MARKER.startsWith('[[NEEDS'));
});

test('a permission or question from the server is never shown or answered: the request is dropped and the person is sent to Bunny\'s window', async () => {
  for (const name of ['permission', 'question', 'capability']) {
    const s = server({ events: [frame(name, { id: 'x', summary: 'Run a command' })] });
    const c = collect();
    await createAnswerer({ adminFetch: s.adminFetch, emit: c.emit }).ask({ text: 'q' });
    assert.deepEqual(c.got.map((e) => e.type), ['start', 'needs-window'], name);
    assert.equal(s.calls.filter((x) => /permission|capability|question/.test(x.path)).length, 0, 'nothing was answered');
  }
});

test('failures: offline, no model, and any other reason in plain words', async () => {
  assert.equal(classifyFailure({ reason: 'unreachable' }), 'offline');
  assert.equal(classifyFailure({ message: 'fetch failed' }), 'offline');
  assert.equal(classifyFailure({ code: 'model.notSelected', status: 400 }), 'none');
  assert.equal(classifyFailure({ code: 'provider.notConnected', status: 400 }), 'none');
  assert.equal(classifyFailure({ code: 'chat.http', message: 'The provider answered 500' }), 'other');
  const none = collect();
  await createAnswerer({ ...server({ status: 400, errorBody: { code: 'model.notSelected', message: 'Choose a provider and model first' } }), emit: none.emit }).ask({ text: 'q' });
  assert.deepEqual([none.got.at(-1).type, none.got.at(-1).kind], ['error', 'none']);
  const off = collect();
  await createAnswerer({ ...server({ events: [frame('error', { code: 'chat.failed', reason: 'unreachable', message: 'Could not reach the provider' })] }), emit: off.emit }).ask({ text: 'q' });
  assert.deepEqual([off.got.at(-1).type, off.got.at(-1).kind], ['error', 'offline']);
  const down = collect();
  await createAnswerer({ adminFetch: async () => { throw new Error('fetch failed'); }, emit: down.emit }).ask({ text: 'q' });
  assert.deepEqual([down.got.at(-1).type, down.got.at(-1).kind], ['error', 'offline']);
});

test('stop: the request is aborted, the bar is told, and a second question is allowed afterwards', async () => {
  const s = server({ events: [frame('delta', { text: 'Part one' })], hang: true });
  const c = collect();
  const a = createAnswerer({ adminFetch: s.adminFetch, emit: c.emit });
  const asked = a.ask({ text: 'long' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(a.answering, true);
  assert.deepEqual((await a.ask({ text: 'again' })).ok, false, 'one answer at a time');
  a.stop();
  await asked;
  assert.equal(c.got.at(-1).type, 'stopped');
  assert.ok(c.got.some((e) => e.type === 'delta' && e.text === 'Part one'), 'what arrived was shown');
  assert.equal(a.answering, false);
});

test('Open in Bunny while answering: the bar hears nothing more, and the window is told when the answer ends', async () => {
  const s = server({ events: [frame('delta', { text: 'later' }), frame('done', { model: 'm' })] });
  const c = collect();
  const finished = [];
  const a = createAnswerer({ adminFetch: s.adminFetch, emit: c.emit, onFinishedDetached: (id) => finished.push(id) });
  a.detach();
  const p = a.ask({ text: 'q' });
  a.detach(); // pressed while it runs
  await p;
  assert.deepEqual(finished, [ID]);
  assert.equal(c.got.filter((e) => e.type === 'delta').length, 0);
});

// structure: what the bar page and the main process promise (read from the files)
import { readFile } from 'node:fs/promises';
test('structure: the bar shows replies only through the sanitising markdown with inert links, has no Allow button, and every new call checks the sender', async () => {
  const js = await readFile(new URL('../electron/quick-ask/bar.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../electron/quick-ask/bar.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../electron/quick-ask.js', import.meta.url), 'utf8');
  assert.match(js, /import \{ renderMarkdown \} from '\.\.\/\.\.\/src\/ui\/markdown\.js'/);
  assert.match(js, /querySelectorAll\('a'\)[\s\S]{0,200}replaceWith/, 'links are made inert');
  assert.match(js, /img, iframe, object, embed, script/, 'pictures and anything active are removed');
  assert.doesNotMatch(html, /allow|permission/i, 'no Allow button or permission prompt in the bar page');
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'[^>]*script-src 'self'/);
  for (const name of ['quickask:ask', 'quickask:stop', 'quickask:open', 'quickask:resize']) {
    const at = main.indexOf(`'${name}'`);
    assert.ok(at > 0, name);
    assert.match(main.slice(at, at + 220), /fromBar\(event\)/, `${name} checks the sender is the bar`);
  }
  assert.match(main, /MAX_BAR_HEIGHT = 560/);
  assert.doesNotMatch(main.slice(0, 700), /never runs tools or shows answers/, 'the old purpose comment is gone');
});
