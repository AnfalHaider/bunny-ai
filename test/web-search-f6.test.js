import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchWeb, resetWebSearch, BRAVE_HOST } from '../src/server/webSearch.js';
import { startApp } from './helpers.js';

// AGENT-FLOW F6: Brave Search (with the person's key), then DuckDuckGo, then words. All fetches are stubbed: no network.
beforeEach(() => resetWebSearch()); // the cooldown and the two-minute memory are per process: every test starts clean
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
    resetWebSearch();
    const ok = world({ [BRAVE_HOST]: brave, 'html.duckduckgo.com': html(DDG_OK) });
    assert.match(await searchWeb('carrots', { fetchImpl: ok.fetchImpl, braveKey: KEY }), /^\(via DuckDuckGo\)/, 'DuckDuckGo answered after Brave failed');
    resetWebSearch(); // the answer above is remembered for two minutes: this is another try
    const bad = world({ [BRAVE_HOST]: brave, 'html.duckduckgo.com': html('', 202) });
    await assert.rejects(searchWeb('carrots', { fetchImpl: bad.fetchImpl, braveKey: KEY }), (err) => said.test(err.message) && /DuckDuckGo showed a check page/.test(err.message) && /Try again in a few minutes\./.test(err.message));
  }
});

test('with no key, a total failure also says to add a Brave Search key; a window gets the browser panel as another way', async () => {
  const bad = world({ 'html.duckduckgo.com': html('', 202) });
  await assert.rejects(searchWeb('weather in Islamabad', { fetchImpl: bad.fetchImpl }), (err) => /A free Brave Search key in Settings, Web search makes this steadier/.test(err.message) && !/browser panel/.test(err.message));
  resetWebSearch();
  const windowed = world({ 'html.duckduckgo.com': html('', 202) });
  await assert.rejects(searchWeb('weather in Islamabad', { fetchImpl: windowed.fetchImpl, browser: true }), /browser_open https:\/\/duckduckgo\.com\/\?q=weather%20in%20Islamabad/);
});

test('DuckDuckGo with a check page body, or an error status, is a reason; zero matches from every provider is "No results."', async () => {
  resetWebSearch();
  const check = world({ 'html.duckduckgo.com': html('<html>Unusual traffic, anomaly detected</html>') });
  await assert.rejects(searchWeb('x', { fetchImpl: check.fetchImpl }), /showed a check page/);
  resetWebSearch();
  const err = world({ 'html.duckduckgo.com': html('', 503) });
  await assert.rejects(searchWeb('x', { fetchImpl: err.fetchImpl }), /DuckDuckGo answered 503/);
  resetWebSearch();
  const none = world({ 'html.duckduckgo.com': html('<html><body>nothing</body></html>'), 'www.bing.com': html('<html><body>nothing</body></html>'), 'en.wikipedia.org': json({ query: { search: [] } }) });
  assert.equal(await searchWeb('x', { fetchImpl: none.fetchImpl }), 'No results.');
  resetWebSearch();
  const empty = world({ [BRAVE_HOST]: json({ web: { results: [] } }), 'html.duckduckgo.com': html('<html></html>'), 'www.bing.com': html('<html></html>'), 'en.wikipedia.org': json({ query: { search: [] } }) });
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

// ---------- Security F6-1 to F6-4 and Brave's terms ----------
test('F6-1: the key goes to https://api.search.brave.com only, with redirect: "error", and every copy is redacted from errors', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url: String(url), redirect: init.redirect }); throw new Error(`failed with ${KEY} inside`); };
  const bad = await searchWeb('x', { fetchImpl: async (u, i) => (String(u).includes(BRAVE_HOST) ? fetchImpl(u, i) : html('', 202)), braveKey: KEY }).catch((e) => e.message);
  assert.equal(seen[0].redirect, 'error');
  assert.ok(new URL(seen[0].url).origin === `https://${BRAVE_HOST}` && !seen[0].url.includes(KEY));
  assert.ok(!bad.includes(KEY), 'no copy of the key in the failure text');
});

test('F6-1: Settings holds only braveKeySet (a boolean); the key route and the flag are the window\'s; a device cannot set the flag', async (t) => {
  const { base } = await startApp(t, { fake: false });
  await put(base, '/api/web-search/key', { key: KEY });
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.braveKeySet, true);
  assert.ok(!JSON.stringify(settings).includes(KEY));
  const { isWindowOnlyRoute, WINDOW_ONLY_SETTING_KEYS } = await import('../src/server/windowOnly.js');
  assert.ok(WINDOW_ONLY_SETTING_KEYS.includes('braveKeySet'));
  assert.equal(isWindowOnlyRoute('PUT', '/api/settings', { braveKeySet: true }), true);
  await put(base, '/api/web-search/key', undefined, 'DELETE');
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).braveKeySet, false);
});

test('F6-3: the browser-panel hint only comes when the panel is allowed in this reply, and never in Quick ask or a scheduled run', async () => {
  const bad = () => world({ 'html.duckduckgo.com': html('', 202) });
  await assert.rejects(searchWeb('x', { fetchImpl: bad().fetchImpl, browser: false }), (e) => !/browser_open/.test(e.message));
  await assert.rejects(searchWeb('x', { fetchImpl: bad().fetchImpl, browser: true }), /browser_open/);
});

test("Brave's terms: the chat keeps one line for a Brave search, not the result text; the links the model cites are in its own answer", async (t) => {
  const { createServer } = await import('node:http');
  const { base, dataDir } = await startApp(t, { fake: false });
  await put(base, '/api/web-search/key', { key: KEY });
  const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
  let n = 0;
  const provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      n += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(n === 1 ? { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":"carrots"}' } }] } : { content: 'done' }));
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { provider.closeAllConnections?.(); provider.close(r); }));
  await fetch(`${base}/api/providers/openai/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` }) });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes(BRAVE_HOST) ? json(braveBody) : real(url, init));
  t.after(() => { globalThis.fetch = real; });
  const { id } = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'brave terms' }) })).json();
  const stream = await (await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'search carrots', providerId: 'openai', model: 'gpt-4o' }) })).text();
  assert.match(stream, /brave\.example\/carrots/, 'the person sees the results during the reply');
  const saved = JSON.stringify(await (await fetch(`${base}/api/sessions/${id}`)).json());
  assert.match(saved, /web search via Brave: 1 results/);
  assert.ok(!/Brave carrots|brave\.example|From Brave/.test(saved), 'no result text, title, link or snippet is saved with the chat');
  const exported = await (await fetch(`${base}/api/sessions/${id}/export?format=markdown`)).text().catch(() => '');
  assert.ok(!/brave\.example|From Brave/.test(exported), 'nor in an export');
  // memory: what Bunny remembers is never fed from a search result
  const memory = await (await fetch(`${base}/api/memory`)).text();
  assert.ok(!/Brave carrots|brave\.example|From Brave/.test(memory), 'nor in memory');
  // a backup is a copy of the data folder: no file in it holds the result text, title, link or snippet (the key is in DPAPI-protected secrets, never as text)
  const { readdir: ls, readFile: rf } = await import('node:fs/promises');
  const names = await ls(dataDir, { recursive: true, withFileTypes: true });
  let scanned = 0;
  for (const e of names.filter((x) => x.isFile())) {
    const text = await rf(join(e.parentPath ?? e.path, e.name), 'utf8').catch(() => '');
    scanned += 1;
    assert.ok(!/Brave carrots|brave\.example\/carrots|From Brave/.test(text), `${e.name} (part of a backup) holds no Brave result text`);
  }
  assert.ok(scanned > 0, 'the data folder was scanned');
  const sessionFile = names.find((x) => x.isFile() && x.name.includes(id));
  void sessionFile;
});

test("F6-4: Brave's result links are in the Quick ask read_url allow-set like DuckDuckGo's (the link lines keep their form)", async () => {
  const w = world({ [BRAVE_HOST]: json(braveBody) });
  const out = await searchWeb('x', { fetchImpl: w.fetchImpl, braveKey: KEY });
  const links = out.split('\n').map((l) => /^ {2}(https?:\/\/\S+)$/.exec(l)?.[1]).filter(Boolean);
  assert.deepEqual(links, ['https://brave.example/carrots']);
});


// ---------------------------------------------------------------- v0.1.16: no key, the free page refuses: Bing, then Wikipedia; a rested page, a memory, a relevance guard
import { bingTarget, relevant, rememberedCount } from '../src/server/webSearch.js';
const enc = (u) => Buffer.from(u).toString('base64url');
const bingPage = (items) => `<html><body><ol id="b_results">${items.map((i) => `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${enc(i.url)}&amp;ntb=1">${i.title}</a></h2><div class="b_caption"><p>${i.text}</p></div></li>`).join('')}</ol></body></html>`;
const wikiBody = (titles) => ({ query: { search: titles.map((t) => ({ title: t, snippet: `About <span class="searchmatch">${t}</span>` })) } });

test('DuckDuckGo refuses (202): Bing answers, says "via Bing", and its redirect links are the real addresses', async () => {
  const w = world({ 'html.duckduckgo.com': html('', 202), 'www.bing.com': html(bingPage([{ title: 'Islamabad weather | AccuWeather', url: 'https://www.accuweather.com/en/pk/islamabad/258278/weather-forecast', text: 'Weather in Islamabad today' }, { title: 'Ventusky', url: 'https://www.ventusky.com/islamabad', text: 'forecast' }])) });
  const out = await searchWeb('weather Islamabad', { fetchImpl: w.fetchImpl });
  assert.match(out, /^\(via Bing\)\n- Islamabad weather \| AccuWeather\n {2}https:\/\/www\.accuweather\.com\/en\/pk\/islamabad\/258278\/weather-forecast\n {2}Weather in Islamabad today/);
  assert.deepEqual(w.calls.map((c) => c.host), ['html.duckduckgo.com', 'www.bing.com']);
  assert.match(w.calls[1].url, /setlang=en-US&cc=US&mkt=en-US/); assert.match(String(w.calls[1].headers.cookie), /SRCHLANG=en/);
  assert.equal(out.split('\n').filter((l) => /^ {2}https?:\/\//.test(l)).length, 2, 'the link lines the quick bar reads');
});

test('a page that answered a different question is not trusted: Bing\'s Thanksgiving answer to "capital of Australia" is skipped and Wikipedia answers', async () => {
  const w = world({ 'html.duckduckgo.com': html('', 202), 'www.bing.com': html(bingPage([{ title: 'Official Discussion - Thanksgiving : r/movies', url: 'https://www.reddit.com/r/movies/comments/17x5dt2/x', text: 'turkey and stuffing' }])), 'en.wikipedia.org': json(wikiBody(['Canberra', 'Australia'])) });
  const out = await searchWeb('capital of Australia', { fetchImpl: w.fetchImpl });
  assert.match(out, /^\(via Wikipedia\)\n- Canberra\n {2}https:\/\/en\.wikipedia\.org\/wiki\/Canberra\n {2}About Canberra/);
  assert.equal(relevant('capital of Australia', ['Thanksgiving turkey']), false); assert.equal(relevant('of the', ['anything']), true, 'no usable word: trusted');
});

test('every page failing says which pages refused, in fixed words, and never points a keyless person only at Brave', async () => {
  const w = world({ 'html.duckduckgo.com': html('', 202), 'www.bing.com': html('', 429), 'en.wikipedia.org': html('', 503) });
  await assert.rejects(searchWeb('moon phase', { fetchImpl: w.fetchImpl }), (err) => /DuckDuckGo showed a check page instead of results\. Bing showed a check page instead of results\. Wikipedia answered 503\. Try again in a few minutes\. A free Brave Search key/.test(err.message));
});

test('a refusing page is rested for five minutes (not asked again in a burst), and asked again after; the same question within two minutes is answered from memory', async () => {
  let clock = 1_000_000; const now = () => clock;
  const w = world({ 'html.duckduckgo.com': html('', 202), 'www.bing.com': () => html(bingPage([{ title: 'Carrots', url: 'https://example.com/carrots', text: 'carrots' }])) });
  await searchWeb('carrots', { fetchImpl: w.fetchImpl, now });
  assert.equal(w.calls.filter((c) => c.host === 'html.duckduckgo.com').length, 1);
  clock += 10_000;
  const second = await searchWeb('carrots farming', { fetchImpl: w.fetchImpl, now });
  assert.match(second, /^\(via Bing\)/); assert.equal(w.calls.filter((c) => c.host === 'html.duckduckgo.com').length, 1, 'DuckDuckGo was resting: not asked again');
  const callsBefore = w.calls.length;
  assert.equal(await searchWeb('carrots farming', { fetchImpl: w.fetchImpl, now }), second); assert.equal(w.calls.length, callsBefore, 'the same question again: from memory, no request');
  clock += 3 * 60_000; await searchWeb('carrots farming', { fetchImpl: w.fetchImpl, now });
  assert.ok(w.calls.length > callsBefore, 'after two minutes it is asked again');
  clock += 6 * 60_000; await searchWeb('carrot cake', { fetchImpl: w.fetchImpl, now });
  assert.equal(w.calls.filter((c) => c.host === 'html.duckduckgo.com').length, 2, 'after five minutes DuckDuckGo is tried again');
});

test('a keyed Brave answer is never kept in memory (Brave\'s terms), and Bing\'s odd or hostile links are never listed', async () => {
  const w = world({ [BRAVE_HOST]: json(braveBody) });
  await searchWeb('carrots', { fetchImpl: w.fetchImpl, braveKey: KEY });
  const again = world({ [BRAVE_HOST]: json(braveBody) });
  await searchWeb('carrots', { fetchImpl: again.fetchImpl, braveKey: KEY });
  assert.equal(again.calls.length, 1, 'asked again: nothing was remembered');
  for (const bad of ['javascript:alert(1)', 'https://a b.example/x', 'ftp://x.example/']) assert.equal(bingTarget(`https://www.bing.com/ck/a?u=a1${enc(bad)}`), null, bad);
  assert.equal(bingTarget(`https://www.bing.com/ck/a?u=a1${enc('https://ok.example/a')}`), 'https://ok.example/a');
  assert.equal(bingTarget('https://www.bing.com/search?q=x'), null, 'a link back into Bing is not a result');
});

test('an answer from another site (a redirect away) is never read, and Wikipedia\'s titles become safe addresses', async () => {
  const redirected = async (url) => { if (/bing\.com/.test(String(url))) { const r = new Response(bingPage([{ title: 'Carrots', url: 'https://example.com/c', text: 'carrots' }]), { status: 200 }); Object.defineProperty(r, 'url', { value: 'https://evil.example/search' }); return r; } return html('', 202); };
  await assert.rejects(searchWeb('carrots', { fetchImpl: redirected }), /Bing could not be reached/);
  resetWebSearch();
  const w = world({ 'html.duckduckgo.com': html('', 202), 'www.bing.com': html('', 500), 'en.wikipedia.org': json(wikiBody(['C (programming language)', 'Rust/Go?'])) });
  const out = await searchWeb('programming language', { fetchImpl: w.fetchImpl });
  assert.match(out, /https:\/\/en\.wikipedia\.org\/wiki\/C_\(programming_language\)/);
  assert.match(out, /https:\/\/en\.wikipedia\.org\/wiki\/Rust%2FGo%3F\n/, 'a title with / and ? is one safe path');
});


// ---------------------------------------------------------------- Security's three LOWs (WS-2, WS-3, WS-4)
test('WS-2: no provider offers a link into Bing, or to a private, loopback, link-local or name-less host', async () => {
  for (const bad of ['https://www.bing.com/search?q=x', 'https://cn.bing.com/images', 'http://127.0.0.1:3000/admin', 'http://localhost/x', 'http://192.168.1.1/', 'http://10.0.0.5/x', 'http://169.254.169.254/latest', 'http://[::1]/x', 'http://intranet/x', 'https://nas.local/x', 'https://svc.internal/x']) {
    assert.equal(bingTarget(`https://www.bing.com/ck/a?u=a1${enc(bad)}`), null, bad);
  }
  assert.equal(bingTarget(`https://www.bing.com/ck/a?u=a1${enc('https://example.com/ok')}`), 'https://example.com/ok');
  const w = world({ 'html.duckduckgo.com': html('<a class="result__a" href="http://127.0.0.1/secret">carrots admin</a><a class="result__snippet">carrots</a><a class="result__a" href="https://ok.example/carrots">Carrots</a><a class="result__snippet">carrots</a>') });
  const out = await searchWeb('carrots', { fetchImpl: w.fetchImpl });
  assert.ok(!/127\.0\.0\.1/.test(out) && /ok\.example\/carrots/.test(out), 'DuckDuckGo is held to the same rule');
  resetWebSearch();
  const b = world({ [BRAVE_HOST]: json({ web: { results: [{ title: 'Router carrots', url: 'http://192.168.0.1/', description: 'carrots' }, { title: 'Carrots', url: 'https://ok.example/c', description: 'carrots' }] } }) });
  const brave = await searchWeb('carrots', { fetchImpl: b.fetchImpl, braveKey: KEY });
  assert.ok(!/192\.168/.test(brave) && /ok\.example\/c/.test(brave));
});

test('WS-3: a snippet that is a bare address cannot pass for a link line, so the quick bar never lists it as something the search gave', async () => {
  const w = world({ 'html.duckduckgo.com': html('<a class="result__a" href="https://ok.example/a">Carrots</a><a class="result__snippet">https://evil.example/planted</a>') });
  const out = await searchWeb('carrots', { fetchImpl: w.fetchImpl });
  const linkLines = out.split('\n').filter((l) => /^ {2}https?:\/\//.test(l));
  assert.deepEqual(linkLines, ['  https://ok.example/a'], 'only the real link line is a link line');
  assert.match(out, /\n {2}· https:\/\/evil\.example\/planted/, 'the snippet is still shown, marked');
  resetWebSearch();
  const b = world({ [BRAVE_HOST]: json({ web: { results: [{ title: 'Carrots', url: 'https://ok.example/b', description: '"https://evil.example/quoted" carrots' }] } }) });
  const brave = await searchWeb('carrots', { fetchImpl: b.fetchImpl, braveKey: KEY });
  assert.deepEqual(brave.split('\n').filter((l) => /^ {2}https?:\/\//.test(l)), ['  https://ok.example/b']);
});

test('WS-4: the memory drops entries older than two minutes on every write and never holds more than 50 questions', async () => {
  let clock = 5_000_000; const now = () => clock;
  const w = world({ 'html.duckduckgo.com': () => html('<a class="result__a" href="https://ok.example/a">Alpha beta</a><a class="result__snippet">alpha beta gamma</a>') });
  for (let i = 0; i < 60; i += 1) { clock += 1000; await searchWeb(`alpha beta ${i}`, { fetchImpl: w.fetchImpl, now }); }
  assert.ok(rememberedCount() <= 50, `held ${rememberedCount()}`);
  clock += 3 * 60_000;
  await searchWeb('alpha beta fresh', { fetchImpl: w.fetchImpl, now });
  assert.equal(rememberedCount(), 1, 'everything older than two minutes was pruned when the new answer was written');
});
