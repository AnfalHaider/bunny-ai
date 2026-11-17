import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp, post } from './helpers.js';

// Memory guard for request bodies: refused by content-length before reading; one body over 1 MB read at a time (a second gets 429); no endless draining.
const ask = (base, path, { declared, first = 'x'.repeat(10), headers = {} } = {}) => new Promise((resolve) => {
  const url = new URL(base);
  const req = http.request({ host: url.hostname, port: url.port, path, method: 'POST', headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': declared } : {}), ...headers } }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, text, req }));
  });
  req.on('error', () => resolve({ status: 0, text: '', req }));
  if (first) req.write(first);
  resolve.req = req;
  ask.last = req;
  if (!declared) req.end();
});
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('a body declared over the cap is refused at once, before it is read', async (t) => {
  const { base } = await startApp(t);
  const started = Date.now();
  const r = await ask(base, '/api/sessions', { declared: 5 * 1024 * 1024 }); // answers while the sender has sent ten bytes of five million
  ask.last.destroy();
  assert.equal(r.status, 413);
  assert.match(r.text, /request\.tooLarge/);
  assert.ok(Date.now() - started < 3000, 'no waiting for the body');
});

test('only one body over 1 MB is read at a time: a second gets 429 and a plain message; when the first is gone a new one is accepted', async (t) => {
  const { base } = await startApp(t);
  const { body: session } = await post(base, '/api/sessions', { title: 'big' });
  const path = `/api/sessions/${session.id}/messages`;
  // the first: declares 3 MB and has sent only a part, so it holds the one slot
  const holder = http.request({ host: new URL(base).hostname, port: new URL(base).port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 3 * 1024 * 1024 } });
  holder.on('error', () => {});
  holder.write('x'.repeat(10));
  await settle(300);
  const second = await new Promise((resolve) => {
    const req = http.request({ host: new URL(base).hostname, port: new URL(base).port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 * 1024 * 1024 } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { resolve({ status: res.statusCode, text }); });
    });
    req.on('error', () => resolve({ status: 0, text: '' }));
    req.write('y'.repeat(10));
  });
  assert.equal(second.status, 429);
  assert.match(second.text, /Another large message is being sent; try again in a moment\./);
  holder.destroy();
  await settle(300);
  const body = JSON.stringify({ content: 'z'.repeat(1_200_000) });
  const third = await new Promise((resolve) => {
    const req = http.request({ host: new URL(base).hostname, port: new URL(base).port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', () => resolve({ status: 0, text: '' }));
    req.end(body);
  });
  assert.notEqual(third.status, 429, 'the slot was given back: ' + third.text.slice(0, 100));
  assert.doesNotMatch(third.text, /request\.busy/);
});

test('a sender that never stops is cut off at about twice the cap instead of being drained for ever', async (t) => {
  const { base } = await startApp(t);
  const url = new URL(base);
  const result = await new Promise((resolve) => {
    const req = http.request({ host: url.hostname, port: url.port, path: '/api/sessions', method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
    let sent = 0;
    let done = false;
    const finish = (how) => { if (!done) { done = true; resolve({ how, sent }); } };
    req.on('error', () => finish('closed'));
    req.on('close', () => finish('closed'));
    req.on('response', (res) => { res.resume(); });
    const chunk = Buffer.alloc(256 * 1024, 0x61);
    const pump = () => {
      if (done) return;
      if (sent > 40 * 1024 * 1024) { req.destroy(); return finish('never cut off'); }
      sent += chunk.length;
      req.write(chunk, () => setImmediate(pump));
    };
    pump();
  });
  assert.equal(result.how, 'closed');
  assert.ok(result.sent < 12 * 1024 * 1024, `cut off after ${result.sent} bytes`);
});

test('v0.1.10 (QA 4c-8): the slot is per request type: a slow large message does not make a large import wait, a second large message still does', async (t) => {
  const { base } = await startApp(t);
  const url = new URL(base);
  const { body: session } = await post(base, '/api/sessions', { title: 'types' });
  const open = (path, declared) => {
    const out = { status: null, text: '' };
    const req = http.request({ host: url.hostname, port: url.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': declared } }, (res) => {
      out.status = res.statusCode;
      res.on('data', (c) => { out.text += c; });
    });
    req.on('error', () => {});
    req.write('x'.repeat(10));
    out.req = req;
    return out;
  };
  const message = open(`/api/sessions/${session.id}/messages`, 3 * 1024 * 1024); // holds the message slot
  await settle(300);
  const importing = open('/api/import', 2 * 1024 * 1024); // a different type: not told to wait
  const secondMessage = open(`/api/sessions/${session.id}/messages`, 2 * 1024 * 1024);
  await settle(400);
  assert.equal(secondMessage.status, 429, 'the same type waits');
  assert.notEqual(importing.status, 429, 'a different type is not blocked by it');
  assert.doesNotMatch(importing.text, /request\.busy/);
  for (const o of [message, importing, secondMessage]) o.req.destroy();
});
