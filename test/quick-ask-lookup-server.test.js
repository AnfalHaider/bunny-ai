import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pcWorld } from './support/pc-world.mjs';

// v0.1.14.1, QUICK ASK (server side): the bar's system text names the tools it really got, and lookupFirst (the main process's own retry) runs one web_search before the model is asked.
const json = { 'content-type': 'application/json' };

async function barAsk(w, content, extra = {}, { admin = true } = {}) {
  const made = await (await fetch(`${w.base}/api/sessions`, { method: 'POST', headers: json, body: JSON.stringify({ title: 'bar', origin: 'quick-ask', workMode: 'chat' }) })).json();
  const init = { method: 'POST', headers: json, body: JSON.stringify({ content, providerId: 'openai', model: 'm1', workMode: 'chat', textOnly: true, ...extra }) };
  const res = admin ? await w.app.adminFetch(`/api/sessions/${made.id}/messages`, init) : await fetch(`${w.base}/api/sessions/${made.id}/messages`, init);
  return res.text();
}
const systemOf = (req) => req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

test('the bar\'s system text names the tools it got: the two web tools only, or the two web tools and the two file tools when Search this PC is on', async (t) => {
  const off = await pcWorld(t, { files: {}, settings: {}, calls: [] });
  await barAsk(off, 'what is 429?', { pcSearch: true });
  assert.match(systemOf(off.requests[0]), /only tools you have are web_search and read_url:/);
  assert.doesNotMatch(systemOf(off.requests[0]), /search_pc|read_pc_file/);
  assert.match(systemOf(off.requests[0]), /\(files, commands, the browser, the screen, a connector\)/, 'with the switch off, files are for the window');
  const on = await pcWorld(t, { files: {}, settings: { pcSearchEnabled: true }, calls: [] });
  await barAsk(on, 'what is 429?', { pcSearch: true });
  const text = systemOf(on.requests[0]);
  assert.match(text, /only tools you have are web_search, read_url, search_pc and read_pc_file:/);
  assert.doesNotMatch(text, /\(files, commands/, 'with the switch on, files are not a reason to send the person to the window');
  assert.deepEqual(on.toolNames(on.requests[0]).sort(), ['read_pc_file', 'read_url', 'search_pc', 'web_search']);
  assert.match(text, /call web_search: never say you cannot/);
});

test('lookupFirst from the main process runs one web_search before the model is asked and hands the model the outcome; a failed search is said plainly; a page or device cannot ask for it', async (t) => {
  const w = await pcWorld(t, { files: {}, settings: {}, calls: [] });
  await barAsk(w, 'what is the weather like in islamabad today? search the internet', { lookupFirst: true, lookupQuery: 'what is the weather like in islamabad today?' });
  const text = systemOf(w.requests[0]);
  // a unit test never reaches the network, so the search fails here: the model is told so and must not make an answer up
  assert.match(text, /Bunny tried to search the web for this question and it failed/);
  assert.match(text, /do not make up an answer/);
  const page = await pcWorld(t, { files: {}, settings: {}, calls: [] });
  await barAsk(page, 'weather in islamabad? search the internet', { lookupFirst: true }, { admin: false });
  assert.doesNotMatch(systemOf(page.requests[0]), /Bunny searched the web|Bunny tried to search the web/);
});
