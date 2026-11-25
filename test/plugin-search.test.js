import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CURATED, curatedLines, searchCurated } from '../src/server/curatedPlugins.js';
import { searchPlugins } from '../src/server/pluginImport.js';

// AGENT-FLOW F4: a curated, pinned list searched first; the person's GitHub sign-in used for the GitHub search only; no dead end for a connector that needs a key; installs unchanged (switched OFF, same cards).

const SECRET = 'ghp_INVENTED_TEST_TOKEN_0123456789abcdef';
function recorder({ githubStatus = 200, registry = { servers: [] } } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...(init.headers ?? {}) }, redirect: init.redirect });
    if (String(url).startsWith('https://api.github.com/')) {
      const withToken = Boolean(init.headers?.authorization);
      const status = withToken ? githubStatus : 200;
      return { status, ok: status < 300, json: async () => (status < 300 ? { items: [{ full_name: 'someone/notes-tool', stargazers_count: 7, description: 'Notes for Bunny' }] } : { message: 'Bad credentials' }) };
    }
    return { status: 200, ok: true, json: async () => registry };
  };
  return { calls, fetchImpl };
}

test('the curated list is pinned and safe: remote https addresses at the vendor\'s own host, nothing that runs a program, no command, unique ids, a reason and a sign-in kind each', () => {
  assert.ok(CURATED.length >= 5 && CURATED.length <= 15, 'short');
  assert.ok(Object.isFrozen(CURATED) && CURATED.every((e) => Object.isFrozen(e)), 'pinned: it cannot change at run time');
  assert.equal(new Set(CURATED.map((e) => e.id)).size, CURATED.length);
  for (const e of CURATED) {
    const u = new URL(e.url);
    assert.equal(u.protocol, 'https:', e.id); assert.equal(u.username + u.password, '', e.id); assert.ok(!u.search, e.id);
    assert.ok(['sign-in', 'key', 'none'].includes(e.needs), e.id); assert.ok(e.why.length > 10 && e.jobs.length > 5, e.id);
    assert.equal('command' in e || 'args' in e || 'env' in e, false, `${e.id} runs nothing on this computer`);
  }
  assert.doesNotMatch(JSON.stringify(CURATED), /claude/i, 'Bunny\'s own words');
});

test('F4-3: every curated entry is https on that vendors own domain', () => {
  const own = { notion: 'notion.com', linear: 'linear.app', sentry: 'sentry.dev', atlassian: 'atlassian.com', stripe: 'stripe.com', context7: 'context7.com', deepwiki: 'deepwiki.com', 'microsoft-learn': 'learn.microsoft.com' };
  assert.deepEqual(CURATED.map((e) => e.id).sort(), Object.keys(own).sort(), 'every entry has a named vendor domain');
  for (const e of CURATED) { const u = new URL(e.url); assert.equal(u.protocol, 'https:', e.id); assert.ok(u.hostname === own[e.id] || u.hostname.endsWith(`.${own[e.id]}`), `${e.id}: ${u.hostname} is not on ${own[e.id]}`); }
  const sources = readFileSync(new URL('../docs/plans/curated-connectors-sources.md', import.meta.url), 'utf8');
  for (const e of CURATED) assert.ok(sources.includes(e.url), `${e.id}: the sources note lists ${e.url}`); // the "checked" claim is backed by a table naming each address
  assert.ok(!sources.includes('huggingface.co/mcp') || /dropped/i.test(sources), 'a dropped entry is said to be dropped');
});

test('search_plugins shows the curated matches FIRST, then GitHub, then the registry; a query with no curated match goes straight on', async () => {
  const { fetchImpl } = recorder();
  const out = await searchPlugins('notion pages', { fetchImpl });
  const lines = out.split('\n');
  const curated = lines.findIndex((l) => /^Known connectors for common jobs/.test(l)); const github = lines.findIndex((l) => /^GitHub repositories/.test(l)); const registry = lines.findIndex((l) => /^MCP registry connectors/.test(l));
  assert.ok(curated === 0 && curated < github && github < registry, `${curated} ${github} ${registry}`);
  assert.match(out, /- Notion: https:\/\/mcp\.notion\.com\/mcp \(the person signs in on the vendor's own page\)/);
  assert.match(await searchPlugins('library documentation', { fetchImpl }), /Context7.*\(no sign-in needed; an API key is optional, for higher limits\)/);
  assert.match(await searchPlugins('jira', { fetchImpl }), /https:\/\/mcp\.atlassian\.com\/v2\/mcp/);
  assert.doesNotMatch(await searchPlugins('models datasets huggingface', { fetchImpl }), /huggingface\.co\/mcp/);
  assert.match(out, /added switched OFF and the person is asked/);
  assert.deepEqual(searchCurated('zzzz nothing').map((e) => e.id), []);
  assert.doesNotMatch(await searchPlugins('zzzz nothing', { fetchImpl }), /Known connectors/);
  assert.deepEqual(searchCurated('sentry errors', { limit: 1 }).map((e) => e.id), ['sentry']);
  assert.ok(curatedLines([]).length === 0);
});

test('the person\'s GitHub sign-in is sent ONLY to api.github.com, only in the search request, never to the registry, and never appears in the result', async () => {
  const { calls, fetchImpl } = recorder({ registry: { servers: [{ server: { name: 'io.example/thing', description: 'x', remotes: [{ url: 'https://mcp.example.test/mcp' }] } }] } });
  const out = await searchPlugins('thing', { fetchImpl, githubToken: SECRET });
  const gh = calls.filter((c) => new URL(c.url).hostname === 'api.github.com'); const other = calls.filter((c) => new URL(c.url).hostname !== 'api.github.com');
  assert.equal(gh.length, 1); assert.equal(gh[0].headers.authorization, `Bearer ${SECRET}`); assert.equal(gh[0].redirect, 'error', 'F4-1: the request that carries the token never follows a redirect');
  assert.ok(other.length >= 1 && other.every((c) => !JSON.stringify(c).includes(SECRET)), 'no other host sees it');
  assert.ok(!out.includes(SECRET)); assert.match(out, /someone\/notes-tool/);
  // without a sign-in: the same search, no header
  const anon = recorder(); await searchPlugins('thing', { fetchImpl: anon.fetchImpl });
  assert.equal(anon.calls[0].headers.authorization, undefined);
  for (const bad of ['', '   ', null, undefined, 5]) { const r = recorder(); await searchPlugins('thing', { fetchImpl: r.fetchImpl, githubToken: bad }); assert.equal(r.calls.some((c) => c.headers.authorization), false, String(bad)); }
});

test('if GitHub refuses the sign-in the search runs again without it and says so; an error message never carries the token; nothing is logged', async () => {
  const logs = []; const keep = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log; console.error = console.log;
  try {
    const r = recorder({ githubStatus: 401 });
    const out = await searchPlugins('thing', { fetchImpl: r.fetchImpl, githubToken: SECRET });
    const gh = r.calls.filter((c) => c.url.startsWith('https://api.github.com/'));
    assert.equal(gh.length, 2); assert.ok(gh[0].headers.authorization); assert.equal(gh[1].headers.authorization, undefined, 'the retry carries no token');
    assert.match(out, /GitHub sign-in was not accepted for this search/); assert.match(out, /someone\/notes-tool/);
    const boom = async (url) => { if (String(url).startsWith('https://api.github.com/')) throw new Error(`network down while sending ${SECRET}`); return { status: 200, ok: true, json: async () => ({ servers: [] }) }; };
    const twice = async (url) => { if (String(url).startsWith('https://api.github.com/')) throw new Error(`sent ${SECRET} and again ${SECRET} to the wrong place`); return { status: 200, ok: true, json: async () => ({ servers: [] }) }; };
    const failed2 = await searchPlugins('thing', { fetchImpl: twice, githubToken: SECRET });
    assert.ok(!failed2.includes(SECRET) && (failed2.match(/\*\*\*/g) ?? []).length === 2, 'F4-2: every occurrence is blanked');
    const failed = await searchPlugins('thing', { fetchImpl: boom, githubToken: SECRET });
    assert.match(failed, /GitHub search failed/); assert.ok(!failed.includes(SECRET), 'the token is blanked out of an error');
  } finally { Object.assign(console, keep); }
  assert.ok(!logs.join('\n').includes(SECRET), 'nothing was logged with it');
});

test('a connector that needs a key is no dead end: the line names the header and tells the model what to say; "cannot connect it yet" is gone; the rate-limit case points at signing in to GitHub', async () => {
  const registry = { servers: [{ server: { name: 'io.example/keyed', description: 'Needs a key', remotes: [{ url: 'https://mcp.keyed.test/mcp', headers: [{ name: 'X-Api-Key', isRequired: true }, { name: 'X-Optional', isRequired: false }] }] } }] };
  const { fetchImpl } = recorder({ registry });
  const out = await searchPlugins('keyed', { fetchImpl });
  assert.doesNotMatch(out, /cannot connect it yet/i);
  assert.match(out, /io\.example\/keyed: https:\/\/mcp\.keyed\.test\/mcp \(needs a key: X-Api-Key\. Do not ask for the key in chat\./);
  assert.doesNotMatch(out, /X-Optional/);
  assert.match(out, /Do not ask for the key in chat/); assert.match(out, /key_headers/); assert.match(out, /Settings, Customize, on that connector, under Add key/);
  const limited = async (url) => (String(url).startsWith('https://api.github.com/') ? { status: 403, ok: false, json: async () => ({ message: 'API rate limit exceeded for 1.2.3.4' }) } : { status: 200, ok: true, json: async () => ({ servers: [] }) });
  assert.match(await searchPlugins('x', { fetchImpl: limited }), /GitHub is limiting searches for now: sign in to GitHub in Settings/);
});

test('no permission change: the search tool is still a read tool, and adding a connector the model found still arrives switched OFF with the same card', async () => {
  const { APP_TOOL_RISK, createAppTools } = await import('../src/server/appTools.js');
  assert.equal(APP_TOOL_RISK.search_plugins, 'read'); assert.equal(APP_TOOL_RISK.add_connector, 'edit');
  const added = []; const kept = [];
  const tools = createAppTools({ skills: {}, mcp: { list: async () => [], add: async (a) => { added.push(a); return { id: 'c1', name: a.name, url: a.url }; } }, getSettings: () => ({}), saveSettings: async () => ({}), getGithubToken: async () => SECRET, fetchImpl: recorder().fetchImpl });
  const out = await tools.run('add_connector', { name: 'Notion', url: 'https://mcp.notion.com/mcp' }, { keep: (x) => kept.push(x) });
  assert.equal(added[0].enabled, false, 'switched OFF'); assert.match(out, /switched OFF until the person says to switch it on/);
  // the tool passes the stored sign-in to the search and nothing else
  const seen = [];
  const t2 = createAppTools({ skills: {}, mcp: {}, getSettings: () => ({}), saveSettings: async () => ({}), getGithubToken: async () => SECRET, fetchImpl: async (u, i = {}) => { seen.push([String(u), i.headers?.authorization]); return { status: 200, ok: true, json: async () => ({ items: [], servers: [] }) }; } });
  await t2.run('search_plugins', { query: 'notes' });
  assert.deepEqual(seen.filter(([u]) => /api\.github\.com/.test(u)).map(([, a]) => a), [`Bearer ${SECRET}`]);
  assert.deepEqual(seen.filter(([u]) => !/api\.github\.com/.test(u)).map(([, a]) => a), seen.filter(([u]) => !/api\.github\.com/.test(u)).map(() => undefined));
  const t3 = createAppTools({ skills: {}, mcp: {}, getSettings: () => ({}), saveSettings: async () => ({}), getGithubToken: async () => { throw new Error('no store'); }, fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ items: [], servers: [] }) }) });
  assert.match(await t3.run('search_plugins', { query: 'notes' }), /GitHub repositories/, 'a missing sign-in is just an anonymous search');
});
