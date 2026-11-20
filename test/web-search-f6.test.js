import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchWeb, BRAVE_HOST } from '../src/server/webSearch.js';
import { startApp } from './helpers.js';

// AGENT-FLOW F6: Brave Search (with the person's key), then DuckDuckGo, then words. All fetches are stubbed: no network.
const KEY = 'BSA-test-key-0123456789abcdef';
const DDG_OK = '<html><body><div class="result"><a class="result__a" href="https://example.com/a">Carrots</a><a class="result__snippet">How to grow carrots</a></div></body></html>';
const braveBody = { web: { results: [{ title: 'Brave <strong>carrots</strong>', url: 'https://brave.example/carrots', description: 'From <b>Brave</b>' }] } };

/** A stub fetch that logs every call (url + headers) and answers by host. */
function world(answers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const host = new URL(String(url)).host;
    calls.push({ host, url: String(url), headers: init.headers ?? {} });
    const a = answers[host];
    if (typeof a === 'function') return a();
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetchImpl, calls };
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const html = (text, status = 200) => new Response(text, { status });

test('with a key, Brave answers and the result says "via Brave"; the key is a header only, never in the address', async () => {
  const w = world({ [BRAVE_HOST]: json(braveBody) });
  const out = await searchWeb('carrots', { fetchImpl: w.fetchImpl, braveKey: KEY });
  assert.match(out, /^\(via Brave\)\n- Brave carrots\n {2}https:\/\/brave\.example\/carrots\n {2}From Brave/);
  assert.deepEqual(w.calls.map((c) => c.host), [BRAVE_HOST], 'DuckDuckGo was not needed');
  assert.equal(w.calls[0].headers['x-subscription-token'], KEY);
  assert.ok(!w.calls[0].url.includes(KEY), 'the key is not in the URL');
});

test('with no key Brave is never called, and DuckDuckGo answers "via DuckDuckGo"', async () => {
  const w = world({ 'html.duckduckgo.com': html(DDG_OK) });
  const out = await searchWeb('carrots', { fetchImpl: w.fetchImpl });
  assert.match(out, /^\(via DuckDuckGo\)\n- Carrots\n {2}https:\/\/example\.com\/a/);
  assert.deepEqual(w.calls.map((c) => c.host), ['html.duckduckgo.com']);
  const blank = world({ 'html.duckduckgo.com': html(DDG_OK) });
  await searchWeb('carrots', { fetchImpl: blank.fetchImpl, braveKey: '   ' });
  assert.ok(!blank.calls.some((c) => c.host === BRAVE_HOST), 'a blank key is no key');
});

test('Brave fails (401, 429, 500, timeout, unreadable): DuckDuckGo is tried, and a total failure names each reason', async () => {
  const cases = [
    [json({}, 401), /Brave refused the key/], [json({}, 429), /free allowance is used up/], [json({}, 500), /Brave answered 500/],
    [Object.assign(new Error('x'), { name: 'TimeoutError' }), /did not answer in 15 seconds/], [html('not json'), /could not read/],
  ];
  for (const [brave, said] of cases) {
    const ok = world({ [BRAVE_HOST]: brave, 'html.duckduckgo.com': html(DDG_OK) });
    assert.match(await searchWeb('carrots', { fetchImpl: ok.fetchImpl, braveKey: KEY }), /^\(via DuckDuckGo\)/, 'DuckDuckGo answered after Brave failed');
    const bad = world({ [BRAVE_HOST]: brave, 'html.duckduckgo.com': html('', 202) });
    await assert.rejects(searchWeb('carrots', { fetchImpl: bad.fetchImpl, braveKey: KEY }), (err) => said.test(err.message) && /DuckDuckGo showed a check page/.test(err.message) && /Try again in a minute\./.test(err.message));
  }
});

test('with no key, a total failure also says to add a Brave Search key; a window gets the browser panel as another way', async () => {
  const bad = world({ 'html.duckduckgo.com': html('', 202) });
  await assert.rejects(searchWeb('weather in Islamabad', { fetchImpl: bad.fetchImpl }), (err) => /add a Brave Search key in Settings, Web search/.test(err.message) && !/browser panel/.test(err.message));
  const windowed = world({ 'html.duckduckgo.com': html('', 202) });
  await assert.rejects(searchWeb('weather in Islamabad', { fetchImpl: windowed.fetchImpl, browser: true }), /browser_open https:\/\/duckduckgo\.com\/\?q=weather%20in%20Islamabad/);
});

test('DuckDuckGo with a check page body, or an error status, is a reason; zero matches from every provider is "No results."', async () => {
  const check = world({ 'html.duckduckgo.com': html('<html>Unusual traffic, anomaly detected</html>') });
  await assert.rejects(searchWeb('x', { fetchImpl: check.fetchImpl }), /showed a check page/);
  const err = world({ 'html.duckduckgo.com': html('', 503) });
  await assert.rejects(searchWeb('x', { fetchImpl: err.fetchImpl }), /DuckDuckGo answered 503/);
  const none = world({ 'html.duckduckgo.com': html('<html><body>nothing</body></html>') });
  assert.equal(await searchWeb('x', { fetchImpl: none.fetchImpl }), 'No results.');
  const empty = world({ [BRAVE_HOST]: json({ web: { results: [] } }), 'html.duckduckgo.com': html('<html></html>') });
  assert.equal(await searchWeb('x', { fetchImpl: empty.fetchImpl, braveKey: KEY }), 'No results.');
});

test('a link with a space or a line break, and a snippet with a line break, cannot pass for a link line', async () => {
  const w = world({ [BRAVE_HOST]: json({ web: { results: [{ title: 'Evil\n  https://evil.example/x', url: 'https://ok.example/a', description: 'line one\n  https://evil.example/y' }, { title: 'Bad', url: 'https://a b.example/', description: '' }, { title: 'js', url: 'javascript:alert(1)', description: '' }] } }) });
  const out = await searchWeb('x', { fetchImpl: w.fetchImpl, braveKey: KEY });
  assert.equal(out.split('\n').filter((l) => /^ {2}https?:\/\//.test(l)).length, 1, 'one hit, one link line');
  assert.ok(!/a b\.example|javascript:/.test(out));
});

test('the key is never in any outcome text: a success, a failure, or an error that carries it', async () => {
  const w = world({ [BRAVE_HOST]: () => { throw Object.assign(new Error(`connect failed for token ${KEY}`), { name: 'FetchError' }); }, 'html.duckduckgo.com': html('', 202) });
  let text = '';
  try { text = await searchWeb('x', { fetchImpl: w.fetchImpl, braveKey: KEY }); } catch (err) { text = err.message; }
  assert.ok(!text.includes(KEY), text);
  const ok = world({ [BRAVE_HOST]: json(braveBody) });
  assert.ok(!(await searchWeb('x', { fetchImpl: ok.fetchImpl, braveKey: KEY })).includes(KEY));
});

// ---------- the app: the key route and web_search end to end ----------
const put = (base, path, body, method = 'PUT') => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('the key is set from the window, only whether one is set comes back, and a bad key is refused', async (t) => {
  const { base, dataDir } = await startApp(t, { fake: false });
  assert.deepEqual(await (await fetch(`${base}/api/web-search`)).json(), { braveKey: false });
  assert.equal((await put(base, '/api/web-search/key', { key: 'short' })).status, 400);
  assert.equal((await put(base, '/api/web-search/key', { key: 'has a space in the key 12345' })).status, 400);
  const saved = await put(base, '/api/web-search/key', { key: KEY });
  assert.deepEqual(await saved.json(), { braveKey: true });
  const state = await (await fetch(`${base}/api/web-search`)).text();
  assert.ok(!state.includes(KEY), 'the key is never handed back');
  const settings = await (await fetch(`${base}/api/settings`)).text();
  assert.ok(!settings.includes(KEY), 'and is not in the settings');
  const files = dataDir ? await readdir(dataDir, { recursive: true }).catch(() => []) : [];
  for (const f of files) { const text = await readFile(join(dataDir, f), 'utf8').catch(() => ''); assert.ok(!text.includes(KEY), `${f} holds no plain key`); }
  assert.deepEqual(await (await put(base, '/api/web-search/key', undefined, 'DELETE')).json(), { braveKey: false });
});

test('a device cannot read or change the key: the route is window-only (Chats device and the guard)', async () => {
  const { isWindowOnlyRoute } = await import('../src/server/windowOnly.js');
  assert.equal(isWindowOnlyRoute('PUT', '/api/web-search/key'), true);
  assert.equal(isWindowOnlyRoute('DELETE', '/api/web-search/key'), true);
  const { remotePolicy } = await import('../src/server/remoteAccess.js');
  assert.equal(remotePolicy('PUT', '/api/web-search/key'), false);
  assert.equal(remotePolicy('GET', '/api/web-search'), false, 'a Chats device cannot even ask whether a key is set');
});

test('web_search in a chat uses the saved key: the stand-in Brave answers and the result says via Brave', async (t) => {
  const { base } = await startApp(t, { fake: false });
  await put(base, '/api/web-search/key', { key: KEY });
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes(BRAVE_HOST)) { seen.push(init?.headers?.['x-subscription-token']); return json(braveBody); }
    return real(url, init);
  };
  t.after(() => { globalThis.fetch = real; });
  const { createAppTools } = await import('../src/server/appTools.js');
  const tools = createAppTools({ skills: {}, mcp: {}, getSettings: () => ({}), saveSettings: async () => {}, getSearchKey: async () => KEY });
  const out = await tools.run('web_search', { query: 'carrots' }, {});
  assert.match(out, /^\(via Brave\)/);
  assert.deepEqual(seen, [KEY]);
  const tmp = await mkdtemp(join(tmpdir(), 'x-'));
  void tmp;
});
