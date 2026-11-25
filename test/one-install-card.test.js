import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startApp, post, json } from './helpers.js';
import { createAppTools } from '../src/server/appTools.js';
import { remoteToolBlocked, REMOTE_TOOLS_DENIED } from '../src/server/remoteAccess.js';

// AGENT-FLOW F10 (the owner: "Yes, one card"): what the model adds gets ONE card, in every mode. It lists every part; "Install and switch on" switches on exactly the listed parts; too long to list: no switch-on button;
// "Install, keep off" and "Don't install" do what they say; a device never gets the card; Plan refuses. Invented content only.

const J = { 'content-type': 'application/json' };
async function scripted(t, steps) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const done = JSON.parse(raw).messages.filter((m) => m.role === 'tool').length;
      const step = steps[done];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `c${done}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

/** One reply on a fresh chat in `mode`; every card is answered by `answer(card)` (a choice id or false). Reports the cards, the capability cards and the whole stream. */
async function run(t, steps, { mode = 'ask', answer = () => 'on', overrides = {}, rules = null } = {}) {
  const { base } = await startApp(t, { fake: false, ...overrides });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await scripted(t, steps) });
  if (rules) await fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: J, body: JSON.stringify({ global: rules, folders: {} }) });
  const { body: session } = await post(base, '/api/sessions', { title: 'F10' });
  await fetch(`${base}/api/sessions/${session.id}/setting/permissionMode`, { method: 'PATCH', headers: J, body: JSON.stringify({ value: mode }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: J, body: JSON.stringify({ content: 'add it', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let all = ''; const cards = []; const capabilities = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; all += piece;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: capability/m.test(block)) capabilities.push(JSON.parse(/^data: (.*)$/m.exec(block)[1]));
      if (/^event: permission/m.test(block)) {
        const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card);
        const choice = answer(card);
        await fetch(`${base}/api/sessions/${session.id}/permission/${card.id}`, { method: 'POST', headers: J, body: JSON.stringify(choice ? { allowed: choice !== 'no', choice } : { allowed: false }) });
      }
    }
  }
  return { base, cards, capabilities, all, session };
}
const addRemote = (extra = {}) => ({ name: 'add_connector', args: { name: 'Notion', url: 'https://mcp.example-notion.test/mcp', ...extra } });
const mcpList = async (base) => (await json(base, '/api/mcp')).body;

test('Ask mode, a remote connector: ONE card with the address and three buttons; "Install and switch on" leaves it on and there is no second "switch on" card', async (t) => {
  const r = await run(t, [addRemote()], { mode: 'ask', answer: () => 'on' });
  assert.equal(r.cards.length, 1, 'one card, not two'); assert.equal(r.capabilities.filter((c) => c.capability === 'switch_on_added').length, 0);
  assert.equal(r.cards[0].title, 'Install and switch on Notion?'); assert.match(r.cards[0].detail, /Adds a connector at\nhttps:\/\/mcp\.example-notion\.test\/mcp/);
  assert.deepEqual(r.cards[0].choices.map((c) => [c.id, c.label]), [['on', 'Install and switch on'], ['off', 'Install, keep off'], ['no', "Don't install"]]);
  assert.equal(r.cards[0].choices[0].primary, true);
  const [c] = await mcpList(r.base); assert.deepEqual([c.name, c.enabled], ['Notion', true]);
  assert.match(r.all, /The person said yes: it is now switched on/);
});

test('Auto mode, a remote connector: still one card (the same number as before)', async (t) => {
  const r = await run(t, [addRemote()], { mode: 'auto', answer: () => 'on' });
  assert.equal(r.cards.length, 1); assert.equal(r.capabilities.length, 0);
  assert.equal((await mcpList(r.base))[0].enabled, true);
});

test('"Install, keep off" really leaves it off and tells the model; "Don\'t install" installs nothing', async (t) => {
  const keep = await run(t, [addRemote()], { answer: () => 'off' });
  assert.equal(keep.cards.length, 1); assert.equal((await mcpList(keep.base))[0].enabled, false);
  assert.match(keep.all, /chose to keep it off/); assert.doesNotMatch(keep.all, /it is now switched on/);
  const no = await run(t, [addRemote()], { answer: () => 'no' });
  assert.deepEqual(await mcpList(no.base), []); assert.match(no.all, /"status":"denied"/);
  const silent = await run(t, [addRemote()], { answer: () => false });
  assert.deepEqual(await mcpList(silent.base), [], 'no answer is no');
});

test('the answer must be one of THIS card\'s own choices: "on" cannot be forced onto a card, and a plain Allow does nothing', async (t) => {
  const r = await run(t, [addRemote()], { answer: () => 'switch-everything-on' });
  assert.deepEqual(await mcpList(r.base), [], 'an id the card did not offer is a no');
  const plain = await run(t, [addRemote({ name: 'Other', url: 'https://mcp.example-other.test/mcp' })], { answer: (card) => { void card; return false; } });
  assert.deepEqual(await mcpList(plain.base), []);
});

test('a local connector: ONE card even in Auto, showing the exact command and arguments; keep off installs it off, and nothing starts', async (t) => {
  const step = { name: 'add_connector', args: { name: 'Files helper', command: 'npx', args: ['-y', 'some-server', 'C:\\notes'] } };
  for (const mode of ['auto', 'ask']) {
    const r = await run(t, [step], { mode, answer: () => 'off' });
    assert.equal(r.cards.length, 1, mode); assert.equal(r.capabilities.length, 0);
    assert.equal(r.cards[0].title, 'Install and switch on Files helper?'); assert.match(r.cards[0].detail, /This runs on your computer:\nnpx -y some-server/);
    assert.deepEqual((await mcpList(r.base)).map((c) => [c.name, c.enabled, c.type]), [['Files helper', false, 'local']]);
  }
  const no = await run(t, [step], { mode: 'auto', answer: () => 'no' });
  assert.deepEqual(await mcpList(no.base), []);
});

test('Plan mode refuses, with no card', async (t) => {
  const r = await run(t, [addRemote()], { mode: 'plan', answer: () => 'on' });
  assert.equal(r.cards.length, 0); assert.deepEqual(await mcpList(r.base), []);
});

test('F10-3: a device cannot install: the three tools are on the device deny-list and blocked, so the card never exists for it', () => {
  for (const tool of ['install_plugin', 'add_connector', 'install_from_github']) { assert.ok(REMOTE_TOOLS_DENIED.includes(tool), tool); assert.equal(remoteToolBlocked(tool), true, tool); }
});

test('a tool from GitHub keeps its own card (the commit and the "runs code" line) with the same three buttons; keep off installs it off', async (t) => {
  const installed = [];
  const toolInstaller = {
    inspect: async (repo) => ({ repo, sha: 'a'.repeat(40), name: 'notes-mcp', folder: 'notes-mcp', entry: 'index.js', install: ['install'], cardText: `Install ${repo}\nCommit ${'a'.repeat(40)}\nThis runs code from the internet on this computer.` }),
    install: async (args) => { installed.push(args); return `Installed ${args.repo}. ${args.enabled === false ? 'It is switched OFF.' : 'It is switched on.'}`; },
  };
  const r = await run(t, [{ name: 'install_from_github', args: { repo: 'example/notes-mcp' } }], { mode: 'auto', answer: () => 'off', overrides: { toolInstaller } });
  assert.equal(r.cards.length, 1); assert.match(r.cards[0].detail, /This runs code from the internet/);
  assert.deepEqual(r.cards[0].choices.map((c) => c.id), ['on', 'off', 'no']);
  assert.deepEqual([installed[0].expectSha, installed[0].enabled], ['a'.repeat(40), false]);
  const no = await run(t, [{ name: 'install_from_github', args: { repo: 'example/notes-mcp' } }], { answer: () => 'no', overrides: { toolInstaller: { ...toolInstaller, install: async () => { throw new Error('must not run'); } } } });
  assert.match(no.all, /"status":"denied"/);
});

// ---------------------------------------------------------------- a plugin: the card lists every part; what is switched on is what was listed; too long

const REPO = (extra = {}) => ({ 'README.md': '# Notes\n', 'plugin.json': JSON.stringify({ name: 'meeting-notes', description: 'Meeting helpers' }), 'skills/summarise/SKILL.md': '---\nname: summarise\ndescription: Summarise a meeting\n---\nSummarise the meeting.', 'skills/actions/SKILL.md': '---\nname: actions\ndescription: List action items\n---\nList actions.', '.mcp.json': JSON.stringify({ mcpServers: { calendar: { url: 'https://mcp.example-cal.test/mcp' } } }), 'hooks/x.sh': 'echo x', ...extra });
function fakeGithub(files) {
  return async (url) => {
    const u = String(url);
    const raw = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/.exec(u)?.[1];
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+\/git\/trees/.test(u)) return { ok: true, status: 200, json: async () => ({ tree: Object.keys(files).map((path) => ({ path, type: 'blob', size: files[path].length })) }) };
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u)) return { ok: true, status: 200, json: async () => ({ default_branch: 'main' }) };
    if (raw && files[raw] !== undefined) return { ok: true, status: 200, text: async () => files[raw], json: async () => JSON.parse(files[raw]) };
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };
}

test('a plugin card lists EVERY part by name (each skill, each connector with its address, what is not imported); the list is kept as data for the server', async () => {
  const tools = createAppTools({ skills: { list: async () => [] }, mcp: {}, getSettings: () => ({}), saveSettings: async () => ({}), fetchImpl: fakeGithub(REPO()) });
  const card = await tools.previewPluginCard('https://github.com/someone/meeting-notes');
  assert.equal(card.ok, true); assert.equal(card.tooLong, false);
  for (const line of ['Plugin meeting-notes', 'Skill summarise', 'Skill actions', 'Connector calendar: https://mcp.example-cal.test/mcp', "Not imported: hooks and scripts made for other apps"]) assert.ok(card.text.includes(line), line);
  assert.deepEqual(card.listed, { skills: ['summarise', 'actions'], connectors: ['https://mcp.example-cal.test/mcp'] });
});

test('F10-2: "Install and switch on" switches on exactly the parts the card listed: a part that was not on the card stays off', async () => {
  const state = { skills: [{ id: 's1', name: 'summarise', enabled: false }, { id: 's2', name: 'surprise', enabled: false }], mcp: [{ id: 'c1', name: 'calendar', url: 'https://mcp.example-cal.test/mcp/', enabled: false }, { id: 'c2', name: 'sneaky', url: 'https://mcp.sneaky.test/mcp', enabled: false }] };
  const tools = createAppTools({
    skills: { list: async () => state.skills, update: async (id, patch) => Object.assign(state.skills.find((s) => s.id === id), patch) },
    mcp: { get: async (id) => state.mcp.find((s) => s.id === id), update: async (id, patch) => Object.assign(state.mcp.find((s) => s.id === id), patch) },
    getSettings: () => ({}), saveSettings: async () => ({}),
  });
  const out = await tools.switchOn({ skillIds: ['s1', 's2'], connectorIds: ['c1', 'c2'] }, { skills: ['summarise'], connectors: ['https://mcp.example-cal.test/mcp'] });
  assert.deepEqual(state.skills.map((s) => [s.name, s.enabled]), [['summarise', true], ['surprise', false]]);
  assert.deepEqual(state.mcp.map((s) => [s.name, s.enabled]), [['calendar', true], ['sneaky', false]]);
  assert.deepEqual(out.left.sort(), ['sneaky', 'surprise']);
  await tools.switchOn({ skillIds: ['s2'], connectorIds: ['c2'] }); // the older card has no list: everything just added
  assert.ok(state.skills[1].enabled && state.mcp[1].enabled);
});

test('over 1,800 characters the card cannot list it whole: tooLong, so no switch-on button and it installs off', async () => {
  const long = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`skills/skill-number-${i}/SKILL.md`, `---\nname: skill-number-${i}\ndescription: ${'a long description '.repeat(6)}\n---\nDo it.`]));
  const tools = createAppTools({ skills: {}, mcp: {}, getSettings: () => ({}), saveSettings: async () => ({}), fetchImpl: fakeGithub(REPO(long)) });
  const card = await tools.previewPluginCard('https://github.com/someone/meeting-notes');
  assert.equal(card.tooLong, true); assert.ok(card.text.length <= 1805);
  const bad = await createAppTools({ skills: {}, mcp: {}, getSettings: () => ({}), saveSettings: async () => ({}), fetchImpl: async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }) }).previewPluginCard('https://github.com/someone/missing');
  assert.equal(bad.ok, false); assert.match(bad.message, /Could not read that repository yet/);
});

test('adding something that is already there asks nothing: no card for nothing, the install itself says so', async (t) => {
  const r = await run(t, [addRemote(), addRemote()], { mode: 'auto', answer: () => 'on' });
  assert.equal(r.cards.length, 1, 'the second, identical add shows no card');
  assert.equal((await mcpList(r.base)).length, 1);
});

test('PG1 (Security): a connector added and switched on in the same reply is not listed or started when a rule denies its address', async (t) => {
  const r = await run(t, [addRemote()], { mode: 'auto', answer: () => 'on', rules: [{ kind: 'domain', effect: 'deny', pattern: '*.example-notion.test' }] });
  assert.doesNotMatch(r.all, /did not start|You now have its tools|is ready/, 'its tools were not loaded into the reply');
  const open = await run(t, [addRemote()], { mode: 'auto', answer: () => 'on' });
  assert.match(open.all, /did not start|is ready|You now have its tools/, 'control: with no deny rule the same reply tries to start it');
});

