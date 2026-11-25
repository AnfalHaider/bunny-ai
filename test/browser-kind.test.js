import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';
import { browserKind, browserMatches } from '../src/server/allowKinds.js';

// F9 (QA, real Electron panel): a click or typing in the panel offers the browser kind from the address the MAIN PROCESS reports for the current page (webContents.getURL(), carried in the panel's answer to a read),
// never from the model. The host is exact; an IP literal and localhost count; a second click on the same host shows no card.

test('the host forms the kind accepts: a name, localhost, an IPv4 literal and a bracketed IPv6 literal, exactly; nothing else', () => {
  for (const host of ['example.com', 'shop.example.com', 'localhost', '127.0.0.1', '192.168.1.5', '[::1]']) {
    const k = browserKind(host, { name: 'browser_click' });
    assert.ok(k.kind, host); assert.equal(browserMatches(k.kind, host), true);
  }
  assert.equal(browserMatches(browserKind('127.0.0.1', {}).kind, '127.0.0.2'), false, 'the exact host');
  assert.equal(browserMatches(browserKind('localhost', {}).kind, 'evil.localhost'), false, 'no subdomains');
  for (const bad of ['', 'user:pw@host', 'a b', 'exa mple.com', 'host/path', '[zz]', 'http://x']) assert.equal(browserKind(bad, { name: 'browser_click' }).kind, null, JSON.stringify(bad));
});

async function modelCalling(t, calls) {
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const done = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const c = calls[done];
      const delta = c ? { tool_calls: [{ index: 0, id: `c${done}`, function: { name: c.name, arguments: JSON.stringify(c.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

/** One reply with the browser panel stood in for: `panel(action, args)` is the window's answer to each browser action; `onCard` answers each permission card. */
async function run(t, calls, panel, onCard) {
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await modelCalling(t, calls) });
  const { body: session } = await post(base, '/api/sessions', { title: 'panel' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'ask' }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'click twice', providerId: 'openai', model: 'gpt-4o', workMode: 'chat', browserControl: true }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const cards = []; const actions = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || !data) continue;
      const d = JSON.parse(data);
      if (event === 'browser') { actions.push(d.action); await fetch(`${base}/api/sessions/${session.id}/browser/${d.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(panel(d.action, d.args)) }); }
      if (event === 'permission') { cards.push(d); await fetch(`${base}/api/sessions/${session.id}/permission/${d.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(onCard(d, cards.length)) }); }
    }
  }
  return { base, session, cards, actions };
}

test('the panel reports the current address (top level, from the main process): the first click offers the kind for that exact host, the second click on it shows no card', async (t) => {
  const r = await run(t, [{ name: 'browser_click', args: { ref: 1 } }, { name: 'browser_click', args: { ref: 2 } }],
    (action) => (action === 'read' ? { url: 'http://127.0.0.1:41234/page', page: { url: 'http://elsewhere.invalid/spoof', title: 'x', text: 'x', elements: [] } } : { page: { url: 'http://127.0.0.1:41234/page', text: 'ok', elements: [] } }),
    (card) => (card.kind ? { allowed: true, kind: true } : { allowed: true }));
  assert.equal(r.cards.length, 1, 'the second click did not ask');
  assert.match(r.cards[0].kind.button, /Allow actions on 127\.0\.0\.1 in this chat/, 'the host is the main process\'s address, not the page\'s own word');
  assert.deepEqual((await json(r.base, `/api/sessions/${r.session.id}/allow-kinds`)).body.kinds.map((k) => k.label), ['Actions on 127.0.0.1']);
});

test('F9-9: the page\'s own claim is never the host: an answer with the address only inside `page` gives no kind (Allow once only); a different top-level host asks again; about:blank gives no kind', async (t) => {
  let n = 0;
  const hosts = ['http://one.example.com/a', 'http://two.example.com/b'];
  const moved = await run(t, [{ name: 'browser_click', args: { ref: 1 } }, { name: 'browser_click', args: { ref: 2 } }],
    (action) => (action === 'read' ? { url: hosts[Math.min(n++, 1)], page: { url: 'http://spoof.example.com/', title: 'x', text: 'x', elements: [] } } : { page: { text: 'ok', elements: [] } }),
    (card) => (card.kind ? { allowed: true, kind: true } : { allowed: true }));
  assert.equal(moved.cards.length, 2, 'a different host asks again');
  assert.match(moved.cards[0].kind.button, /one\.example\.com/); assert.match(moved.cards[1].kind.button, /two\.example\.com/);
  const claimOnly = await run(t, [{ name: 'browser_click', args: { ref: 1 } }],
    (action) => (action === 'read' ? { page: { url: 'http://one.example.com/a', title: 'x', text: 'x', elements: [] } } : { page: { text: 'ok', elements: [] } }),
    () => ({ allowed: true }));
  assert.equal(claimOnly.cards[0].kind ?? null, null, 'no top-level address: no kind'); assert.match(claimOnly.cards[0].reason, /could not tell which site/);
  const none = await run(t, [{ name: 'browser_click', args: { ref: 1 } }],
    (action) => (action === 'read' ? { url: 'about:blank', page: { url: 'about:blank' } } : { page: { text: 'ok', elements: [] } }),
    () => ({ allowed: true }));
  assert.equal(none.cards[0].kind ?? null, null); assert.match(none.cards[0].reason, /could not tell which site/);
});

test('F9-10: the host is checked again at the moment of the action; a page that moved itself between the read and the click means nothing is done and the person is asked once, with no kind to give', async (t) => {
  const seen = [];
  const r = await run(t, [{ name: 'browser_click', args: { ref: 1 } }],
    (action, args) => {
      seen.push([action, args?.expectHost ?? null]);
      if (action === 'read') return { url: 'http://shop.example.com/cart', page: { url: 'http://shop.example.com/cart', text: 'x', elements: [] } };
      if (args?.expectHost === 'shop.example.com') return { moved: true, host: 'evil.example.net', error: 'The page is now on evil.example.net, not shop.example.com, so nothing was done.' };
      return { page: { text: 'clicked there', elements: [] } };
    },
    (card, count) => (count === 1 ? { allowed: true, kind: true } : { allowed: true }));
  assert.equal(r.cards.length, 2, 'the first card gave the kind; the move asks once more');
  assert.equal(r.cards[1].kind ?? null, null, 'the second card offers no kind'); assert.match(r.cards[1].detail, /moved to evil\.example\.net/); assert.match(r.cards[1].reason, /^Asked every time: the page moved to another site/);
  assert.deepEqual(seen.filter(([a]) => a === 'click').map(([, h]) => h), ['shop.example.com', 'evil.example.net'], 'the action carried the host it was allowed for; the retry carries the host the person was shown');
  const denied = await run(t, [{ name: 'browser_click', args: { ref: 1 } }],
    (action, args) => (action === 'read' ? { url: 'http://shop.example.com/cart' } : args?.expectHost ? { moved: true, host: 'evil.example.net', error: 'moved' } : { page: { text: 'SHOULD NOT HAPPEN' } }),
    (card, count) => (count === 1 ? { allowed: true } : { allowed: false }));
  assert.equal(denied.actions.filter((a) => a === 'click').length, 1, 'a no to the move means the click is never retried');
});

// the Electron main process side: controlView's answer to a read carries webContents.getURL() at the TOP level (the page's own location.href is only inside `page`)
import { controlView } from '../electron/browserAgent.js';
test('Electron main: a read answers with the main process\'s own address for the view, whatever the page says about itself', async () => {
  const contents = {
    getZoomFactor: () => 1,
    getURL: () => 'http://127.0.0.1:41234/page',
    executeJavaScript: async () => ({ url: 'http://spoofed.invalid/', title: 'x', text: 'hello', elements: [] }),
  };
  const answer = await controlView(contents, 'bunny-tab-1', 'read', {});
  assert.equal(answer.url, 'http://127.0.0.1:41234/page', 'from webContents.getURL()');
  assert.equal(answer.page.url, 'http://spoofed.invalid/', 'the page\'s own claim stays inside `page`, and is not what the kind uses');
  const other = await controlView({ ...contents, getURL: () => 'https://shop.example.com/cart' }, 'bunny-tab-1', 'read', {});
  assert.equal(other.url, 'https://shop.example.com/cart');
});

test('Electron main (F9-10): a click or typing with an expected host does nothing when the view is on another host now, and acts when it is on that host', async () => {
  let ran = 0; let url = 'https://shop.example.com/cart';
  const contents = { getZoomFactor: () => 1, getURL: () => url, executeJavaScript: async (code) => { ran += 1; return /"click"|"type"/.test(code) ? { ok: true } : { url, title: 'x', text: 'page', elements: [] }; } };
  assert.equal((await controlView(contents, 'bunny-tab-1', 'click', { ref: 1, expectHost: 'shop.example.com' })).moved, undefined, 'same host: it acts');
  url = 'https://evil.example.net/phish'; ran = 0;
  for (const action of ['click', 'type']) {
    const out = await controlView(contents, 'bunny-tab-1', action, { ref: 1, text: 'hi', expectHost: 'shop.example.com' });
    assert.equal(out.moved, true); assert.equal(out.host, 'evil.example.net'); assert.match(out.error, /nothing was done/);
  }
  assert.equal(ran, 0, 'nothing was run in the page');
  assert.equal((await controlView(contents, 'bunny-tab-1', 'click', { ref: 1 })).moved, undefined, 'with no expected host (a person\'s one-off yes) it acts as before');
});

test('F9-10a: the retry carries the host that was shown; a page with no website host gets no retry; a page that moves again stops without a second question', async (t) => {
  // empty shown host (about:blank): refused with the plain line, no card for it
  const blank = await run(t, [{ name: 'browser_click', args: { ref: 1 } }],
    (action, args) => (action === 'read' ? { url: 'http://shop.example.com/cart' } : args?.expectHost ? { moved: true, host: '', error: 'moved' } : { page: { text: 'SHOULD NOT HAPPEN' } }),
    () => ({ allowed: true }));
  assert.equal(blank.cards.length, 1, 'only the first card: no "Do it there?" for a page that is not a website');
  assert.equal(blank.actions.filter((a) => a === 'click').length, 1, 'no retry');
  // moved again on the retry: stop, and do not ask a second time
  let clicks = 0;
  const twice = await run(t, [{ name: 'browser_click', args: { ref: 1 } }],
    (action, args) => { if (action === 'read') return { url: 'http://shop.example.com/cart' }; clicks += 1; return { moved: true, host: clicks === 1 ? 'one.example.net' : 'two.example.net', error: 'moved' }; },
    () => ({ allowed: true }));
  assert.equal(twice.cards.length, 2, 'the first card, and ONE "Do it there?" — never a third');
  assert.equal(clicks, 2);
});

// F9-10b: a browser kind never covers an action that goes through the old frame fallback: its read gives no address from the main process, so no host, so no kind (Allow once only)
import { controlFrame } from '../electron/browserAgent.js';
test('F9-10b: the frame fallback\'s read has no top-level address, so a kind can never cover it', async () => {
  const main = { framesInSubtree: [] }; const frame = { name: 'bunny-tab-1', parent: main, executeJavaScript: async () => ({ url: 'http://one.example.com/', title: 'x', text: 'page', elements: [] }) }; main.framesInSubtree.push(frame);
  const contents = { getZoomFactor: () => 1, getURL: () => 'http://127.0.0.1:1/the-bunny-app-window', mainFrame: main };
  const out = await controlFrame(contents, 'bunny-tab-1', 'read', {});
  assert.equal(out.url, undefined, 'the frame path reports nothing the kind could take a host from (its webContents is the app window)');
  assert.ok(out.page);
});
