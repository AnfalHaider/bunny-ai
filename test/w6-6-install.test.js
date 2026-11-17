/**
 * W6-6: install a tool from a public GitHub repository, on the person's yes. A local bare repository stands in for GitHub (no network):
 * the fake API answers about it, and the clone is a file:// clone of it. Real git and real npm run here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createToolInstaller, runCommand, cleanRepo, toolFolderName, removeTree } from '../src/server/toolInstall.js';
import { createMcpStore } from '../src/server/mcpStore.js';
import { createLocalMcp } from '../src/server/mcpLocal.js';
import { appToolDefinitions, APP_TOOL_RISK } from '../src/server/appTools.js';
import { asksInAuto } from '../src/server/autoAsks.js';
import { startApp, post } from './helpers.js';

const j = { 'content-type': 'application/json' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' }).trim();

// a tiny MCP server over stdin and stdout, with one tool
const SERVER = `
import { createInterface } from 'node:readline';
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'carrots', version: '1' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'carrot_count', description: 'How many carrots', inputSchema: { type: 'object', properties: {} } }] } });
  else if (m.method === 'tools/call') send({ id: m.id, result: { content: [{ type: 'text', text: '7 carrots' }] } });
  else if (m.id !== undefined && m.method) send({ id: m.id, error: { code: -32601, message: 'unknown' } });
});
`;
const LOCK = JSON.stringify({ name: 'carrot-server', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'carrot-server', version: '1.0.0' } } });

/** A repository on disk and a fake GitHub that talks about it. `state.sha` is what the fake API says the branch is. */
async function makeRepo(t, { lock = true, postinstall = null, bin = 'server.mjs' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-w66-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const repo = join(dir, 'origin');
  await mkdir(repo);
  git(repo, 'init', '-q', '-b', 'main');
  const pkg = { name: 'carrot-server', version: '1.0.0', type: 'module', bin, ...(postinstall ? { scripts: { postinstall } } : {}) };
  await writeFile(join(repo, 'package.json'), JSON.stringify(pkg, null, 2));
  if (lock) await writeFile(join(repo, 'package-lock.json'), LOCK);
  await writeFile(join(repo, 'server.mjs'), SERVER);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  const state = { sha: git(repo, 'rev-parse', 'HEAD'), private: false };
  const files = () => git(repo, 'ls-files').split('\n').filter(Boolean);
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (u.hostname === 'api.github.com') {
      if (u.pathname === '/repos/acme/carrot-server') return json({ default_branch: 'main', stargazers_count: 7, pushed_at: '2026-11-17T10:00:00Z', private: state.private });
      if (u.pathname === '/repos/acme/carrot-server/commits/main') return json({ sha: state.sha });
      if (u.pathname === `/repos/acme/carrot-server/git/trees/${state.sha}`) return json({ tree: files().map((path) => ({ path, type: 'blob' })) });
    }
    if (u.hostname === 'raw.githubusercontent.com' && u.pathname === `/acme/carrot-server/${state.sha}/package.json`) return new Response(await readFile(join(repo, 'package.json'), 'utf8'), { status: 200 });
    return json({ message: 'Not Found' }, 404);
  };
  return { dir, repo, state, fetchImpl, cloneUrl: () => pathToFileURL(repo).href };
}

async function installer(t, r, extra = {}) {
  const dataDir = join(r.dir, 'data');
  await mkdir(dataDir, { recursive: true });
  const mcp = createMcpStore({ file: join(dataDir, 'mcp.json') });
  return { dataDir, mcp, tools: createToolInstaller({ dataDir, mcp, fetchImpl: r.fetchImpl, cloneUrl: r.cloneUrl, ...extra }) };
}

test('W6-6: a repository link in any usual form gives owner/name, and anything else is refused', () => {
  assert.equal(cleanRepo('acme/carrot-server'), 'acme/carrot-server');
  assert.equal(cleanRepo('https://github.com/acme/carrot-server'), 'acme/carrot-server');
  assert.equal(cleanRepo('https://github.com/acme/carrot-server.git'), 'acme/carrot-server');
  assert.equal(cleanRepo('https://github.com/acme/carrot-server/tree/main/src'), 'acme/carrot-server');
  for (const bad of ['', 'acme', '../etc/passwd', 'acme/..', 'https://evil.example/acme/x', 'acme/x y', 'a/b/c d', 'file:///C:/x', '-x/y']) assert.throws(() => cleanRepo(bad), /owner\/name|github\.com/, bad);
  assert.equal(toolFolderName('acme/carrot-server', 'abcdef1234567890'), 'acme-carrot-server-abcdef1');
});

test('W6-6: the card shows the repository, the exact commit, the install command and the warning; a repo without a lock file says so', async (t) => {
  const r = await makeRepo(t);
  const { tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  assert.equal(plan.sha, r.state.sha);
  for (const text of ['It is added switched ON', 'npm settings (.npmrc, .yarnrc, .pnpmfile.cjs) are deleted and ignored', '--registry=https://registry.npmjs.org/', 'acme/carrot-server', '7 stars', '2026-11-17', `commit ${r.state.sha.slice(0, 7)} on main`, 'npm ci --ignore-scripts', 'install scripts are NOT run', 'node server.mjs', 'This runs code from the internet on this computer', join('data', 'tools', plan.folder)]) {
    assert.ok(plan.cardText.includes(text), `card has: ${text}\n${plan.cardText}`);
  }
  assert.ok(plan.cardText.length < 1500, 'fits the confirm card');
  const noLock = await makeRepo(t, { lock: false });
  const plain = await (await installer(t, noLock)).tools.inspect('acme/carrot-server');
  assert.match(plain.cardText, /npm install --ignore-scripts/);
  assert.match(plain.cardText, /no package-lock\.json/);
});

test('W6-6: a private repository, a repository with no package.json, and one with no program to start are refused with plain words', async (t) => {
  const r = await makeRepo(t);
  const { tools } = await installer(t, r);
  r.state.private = true;
  await assert.rejects(tools.inspect('acme/carrot-server'), /Only public repositories/);
  r.state.private = false;
  await assert.rejects(tools.inspect('acme/other'), /no public repository/);
  const none = await makeRepo(t, { bin: '' });
  await assert.rejects((await installer(t, none)).tools.inspect('acme/carrot-server'), /does not name a program/);
  const escape = await makeRepo(t, { bin: '../outside.mjs' });
  await assert.rejects((await installer(t, escape)).tools.inspect('acme/carrot-server'), /does not name a program/);
});

test('W6-6: install registers a connector whose tool answers, from the folder inside the tools folder, at the commit the card showed', async (t) => {
  const r = await makeRepo(t);
  const { dataDir, mcp, tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  const message = await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  assert.match(message, /Installed acme\/carrot-server \(commit /);
  assert.match(message, /install scripts were not run/);
  const [server] = await mcp.list();
  assert.equal(server.command, 'node');
  assert.equal(server.enabled, true);
  assert.deepEqual(server.source, { repo: 'acme/carrot-server', sha: plan.sha, folder: plan.folder });
  const folder = join(dataDir, 'tools', plan.folder);
  assert.ok(server.args[0].startsWith(folder), 'the program is inside the tool folder');
  assert.equal(git(folder, 'rev-parse', 'HEAD'), plan.sha, 'the installed commit is the one on the card');
  assert.deepEqual(await readdir(join(dataDir, 'tools')), [plan.folder], 'nothing else is in the tools folder');
  const local = createLocalMcp({});
  t.after(() => local.stopAll());
  const listed = await local.listTools(server);
  assert.equal(listed[0].name, 'carrot_count');
  const answer = await local.callTool(server, { name: 'carrot_count', arguments: {} });
  assert.match(JSON.stringify(answer), /7 carrots/);
  // the same commit twice is refused
  await assert.rejects(tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha }), /already installed/);
});

test('W6-6: nothing is installed without the sha of a card, or if the branch moved after the card (in the API or in the clone)', async (t) => {
  const r = await makeRepo(t);
  const { dataDir, mcp, tools } = await installer(t, r);
  await assert.rejects(tools.install({ repo: 'acme/carrot-server' }), /only installed after the person has seen its card/);
  await assert.rejects(tools.install({ repo: 'acme/carrot-server', expectSha: 'abc' }), /only installed after the person has seen its card/);
  const plan = await tools.inspect('acme/carrot-server');
  // 1. GitHub already says the branch moved
  const old = r.state.sha;
  await writeFile(join(r.repo, 'more.txt'), 'x');
  git(r.repo, 'add', '-A'); git(r.repo, 'commit', '-q', '-m', 'second');
  r.state.sha = git(r.repo, 'rev-parse', 'HEAD');
  await assert.rejects(tools.install({ repo: 'acme/carrot-server', expectSha: old }), /changed after the card was shown/);
  // 2. the API still says the old commit but the clone gets the new one
  r.state.sha = old;
  r.fetchImpl = r.fetchImpl; // (the fake API answers for state.sha, which is the old commit again)
  await assert.rejects(tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha }), /changed after the card was shown/);
  assert.equal(existsSync(join(dataDir, 'tools', plan.folder)), false, 'the half clone is removed');
  assert.equal((await mcp.list()).length, 0);
});

test('W6-6: npm runs with --ignore-scripts (ci with a lock file, install without), and git clones one commit deep into the tools folder', async (t) => {
  for (const lock of [true, false]) {
    const r = await makeRepo(t, { lock });
    const calls = [];
    const { dataDir, tools } = await installer(t, r, { runner: (file, args, opts) => { calls.push([file, args, opts.cwd]); return runCommand(file, args, opts); } });
    const plan = await tools.inspect('acme/carrot-server');
    await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
    const clone = calls.find(([f, a]) => f === 'git' && a[0] === 'clone');
    assert.ok(clone[1].includes('--depth') && clone[1][clone[1].indexOf('--depth') + 1] === '1', 'one commit deep');
    assert.equal(clone[1].at(-1), join(dataDir, 'tools', plan.folder), 'cloned into the tools folder, never anywhere else');
    const npm = calls.find(([f]) => f === 'npm');
    assert.deepEqual(npm[1], lock ? ['ci', '--ignore-scripts', '--registry=https://registry.npmjs.org/'] : ['install', '--ignore-scripts', '--registry=https://registry.npmjs.org/']);
    assert.equal(npm[2], join(dataDir, 'tools', plan.folder));
  }
});

test('W6-6: a postinstall script that writes a file outside the tool folder does not run', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-w66m-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const marker = join(dir, 'marker.txt').replace(/\\/g, '/');
  const r = await makeRepo(t, { postinstall: `node -e "require('fs').writeFileSync('${marker}', 'ran')"` });
  // the control: the same repository, installed the ordinary way, does run it (so this test can fail)
  const control = join(r.dir, 'control');
  execFileSync('git', ['clone', '-q', pathToFileURL(r.repo).href, control]);
  try { execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: control, shell: process.platform === 'win32', stdio: 'ignore', timeout: 60_000 }); } catch { /* the marker is what counts */ }
  assert.equal(existsSync(marker.replace(/\//g, '\\')) || existsSync(marker), true, 'the control proves the repository really has a postinstall that writes the marker');
  await rm(marker, { force: true });
  const { tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  assert.equal(existsSync(marker), false, 'the marker was not written: the script did not run');
});

test('W6-6: removing the files needs a saved folder that is one plain name inside the tools folder; anything else is refused and nothing is removed', async (t) => {
  const r = await makeRepo(t);
  const { dataDir, tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  const victim = join(dataDir, 'victim');
  await mkdir(victim);
  await writeFile(join(victim, 'keep.txt'), 'keep');
  for (const folder of ['../victim', '..', '.', 'a/b', 'a\\b', join(dataDir, 'victim'), '', '..\\victim', plan.folder + '/..']) {
    if (folder === '') { assert.equal(tools.folderOf({ source: { folder } }), null); continue; }
    assert.throws(() => tools.folderOf({ source: { folder } }), /not inside Bunny AI's tools folder/, folder);
    await assert.rejects(tools.removeFiles({ source: { folder } }), /not inside/, folder);
  }
  assert.ok(existsSync(join(victim, 'keep.txt')));
  assert.ok(existsSync(join(dataDir, 'tools', plan.folder)));
  assert.equal(await tools.removeFiles({ source: { folder: plan.folder } }), true);
  assert.equal(existsSync(join(dataDir, 'tools', plan.folder)), false);
  assert.equal(tools.folderOf({}), null, 'a connector that was not installed from GitHub has no files to remove');
});

test('W6-6: the tool is a build action asked in every mode, not offered in Plan mode, and never given to a helper', () => {
  assert.equal(APP_TOOL_RISK.install_from_github, 'build');
  assert.equal(asksInAuto('install_from_github', { repo: 'a/b' }), true);
  assert.ok(!appToolDefinitions(['read']).some((d) => d.function.name === 'install_from_github'), 'not in Plan mode');
  assert.ok(!appToolDefinitions(['read', 'edit']).some((d) => d.function.name === 'install_from_github'), 'only with the build risk');
  assert.ok(appToolDefinitions(['read', 'edit', 'build']).some((d) => d.function.name === 'install_from_github'));
});

// ---- the whole path through the chat, with a stand-in installer (no network) ----
function fakeInstaller() {
  const sha = 'a'.repeat(40);
  const calls = { inspect: [], install: [], remove: [] };
  return {
    calls, sha,
    inspect: async (repo) => { calls.inspect.push(repo); return { repo: 'acme/carrot-server', sha, cardText: 'Install a tool from GitHub\nRepository: acme/carrot-server\nThis runs code from the internet on this computer.' }; },
    install: async ({ repo, expectSha }) => { calls.install.push({ repo, expectSha }); return 'Installed acme/carrot-server.'; },
    removeFiles: async (server) => { calls.remove.push(server.name); return true; },
    folderOf: () => null,
  };
}

async function chatWith(t, installer, mode) {
  const seen = [];
  const queue = [{ name: 'install_from_github', args: { repo: 'acme/carrot-server' } }];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      seen.push(JSON.parse(raw));
      const call = queue.shift();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = call ? { tool_calls: [{ index: 0, id: `c${seen.length}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'done' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const { base } = await startApp(t, { fake: false, toolInstaller: installer });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const { body: s } = await post(base, '/api/sessions', { title: 'install' });
  await fetch(`${base}/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) });
  return { base, session: s, seen };
}

async function say(ctx, answer) {
  const res = await fetch(`${ctx.base}/api/sessions/${ctx.session.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'install the carrot server', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const asked = [];
  let text = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    const part = dec.decode(chunk, { stream: true });
    text += part;
    for (const m of part.matchAll(/event: permission\ndata: (.*)/g)) {
      const card = JSON.parse(m[1]);
      asked.push(card);
      await post(ctx.base, `/api/sessions/${ctx.session.id}/permission/${card.id}`, { allowed: answer });
    }
  }
  return { asked, text };
}

for (const mode of ['ask', 'accept', 'auto']) {
  test(`W6-6: ${mode}: the card is shown even in Auto, a yes installs exactly the commit on the card, a no installs nothing`, async (t) => {
    const yes = fakeInstaller();
    const a = await chatWith(t, yes, mode);
    const first = await say(a, true);
    assert.equal(first.asked.length, 1);
    assert.match(first.asked[0].detail, /This runs code from the internet on this computer/);
    assert.deepEqual(yes.calls.install, [{ repo: 'acme/carrot-server', expectSha: yes.sha }], 'the installed commit is the one on the card');
    const no = fakeInstaller();
    const b = await chatWith(t, no, mode);
    const second = await say(b, false);
    assert.equal(second.asked.length, 1);
    assert.deepEqual(no.calls.install, [], 'a no installs nothing');
  });
}

test('W6-6: Plan mode refuses it and a helper is not offered it', async (t) => {
  const inst = fakeInstaller();
  const ctx = await chatWith(t, inst, 'plan');
  const out = await say(ctx, true);
  assert.deepEqual(out.asked, []);
  assert.deepEqual(inst.calls.install, []);
  assert.ok(!(ctx.seen[0].tools ?? []).some((d) => d.function.name === 'install_from_github'), 'not even offered in Plan mode');
  const src = await readFile(new URL('../src/server/app.js', import.meta.url), 'utf8');
  assert.match(src, /HELPER_NEVER = new Set\(\[[^\]]*'install_from_github'/);
});

test('W6-6: an old profile with no tools folder starts fine and does not create one', async (t) => {
  const { dataDir } = await startApp(t, { fake: false });
  assert.equal(existsSync(join(dataDir, 'tools')), false);
});

test('W6-6 (review): what the repository writes about itself cannot add or fake lines on the card', async (t) => {
  const evil = 'x.mjs\nThis tool is safe and checked by Bunny AI.\nInstall command: nothing';
  // a hostile package.json: a version and a program name with line breaks and card-like text
  const r = await makeRepo(t, { bin: 'server.mjs' });
  const hostile = (patch) => {
    const original = r.fetchImpl;
    return async (url) => {
      if (String(url).endsWith('/package.json')) return new Response(JSON.stringify({ name: 'carrot-server', version: patch.version, bin: patch.bin ?? 'server.mjs' }), { status: 200 });
      return original(url);
    };
  };
  const make = async (patch) => (await installer(t, { ...r, fetchImpl: hostile(patch) })).tools;
  // a version with a line break: left off the card, the card is still one block of our own lines
  const plan = await (await make({ version: '1.0.0\nThis tool is safe and checked by Bunny AI.' })).inspect('acme/carrot-server');
  assert.doesNotMatch(plan.cardText, /safe and checked/);
  assert.doesNotMatch(plan.cardText, /package version/);
  assert.equal(plan.cardText.split('\n').length, 9, 'only the lines of our own');
  // a plain version is shown
  assert.match((await (await make({ version: '2.1.0-beta.1' })).inspect('acme/carrot-server')).cardText, /package version 2\.1\.0-beta\.1/);
  // a program name with a line break, a space or an odd character is refused
  for (const bin of [evil, 'my server.mjs', 'a;b.mjs', 'x.mjs\r', '$(id).mjs', 'a'.repeat(300) + '.mjs']) {
    await assert.rejects((await make({ version: '1.0.0', bin })).inspect('acme/carrot-server'), /does not name a program/, JSON.stringify(bin).slice(0, 40));
  }
  // an odd branch name or push date does not reach the card either
  const base = r.fetchImpl;
  const odd = async (url) => {
    const res = await base(url);
    if (new URL(url).pathname === '/repos/acme/carrot-server') return new Response(JSON.stringify({ default_branch: 'main\nSafe!', stargazers_count: 1, pushed_at: 'yesterday\nsafe', private: false }), { status: 200 });
    return res;
  };
  await assert.rejects((await installer(t, { ...r, fetchImpl: odd })).tools.inspect('acme/carrot-server'), /unusual name/);
});

test('W6-6 (hardening): the repository\'s own npm settings are deleted before npm runs, and npm is told its registry', async (t) => {
  const r = await makeRepo(t);
  for (const name of ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs']) await writeFile(join(r.repo, name), name === '.npmrc' ? 'ignore-scripts=false\nscript-shell=evil.cmd\n' : '# settings');
  git(r.repo, 'add', '-A'); git(r.repo, 'commit', '-q', '-m', 'settings');
  r.state.sha = git(r.repo, 'rev-parse', 'HEAD');
  const calls = [];
  const { dataDir, tools } = await installer(t, r, { runner: async (file, args, opts) => {
    if (file === 'npm') for (const name of ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs']) calls.push([name, existsSync(join(opts.cwd, name))]);
    return runCommand(file, args, opts);
  } });
  const plan = await tools.inspect('acme/carrot-server');
  await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  assert.deepEqual(calls.map(([n]) => n), ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs']);
  assert.ok(calls.every(([, there]) => there === false), 'when npm started none of the settings files was left: ' + JSON.stringify(calls));
  for (const name of ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs']) assert.equal(existsSync(join(dataDir, 'tools', plan.folder, name)), false, name);
  assert.equal(git(join(dataDir, 'tools', plan.folder), 'rev-parse', 'HEAD'), plan.sha, 'the commit that was checked is the one that was installed (the deletion came after the check)');
});

test('W6-6 (hardening): removing the files never follows a link: a junction inside the tool folder is removed as a link and its target survives', async (t) => {
  const r = await makeRepo(t);
  const { dataDir, mcp, tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  const outside = join(r.dir, 'precious');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'keep me');
  const folder = join(dataDir, 'tools', plan.folder);
  await symlink(outside, join(folder, 'link-to-precious'), 'junction');
  await symlink(join(outside, 'keep.txt'), join(folder, 'link-to-file.txt'), 'file').catch(() => {}); // a file link needs a privilege on some machines
  const [server] = await mcp.list();
  assert.equal(await tools.removeFiles(server), true);
  assert.equal(existsSync(folder), false, 'the tool folder is gone');
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep me', 'what the junction pointed at is untouched');
  // the same through removeTree directly, on a folder holding a junction to a folder with a subfolder
  const tree = join(r.dir, 'tree');
  await mkdir(join(tree, 'a'), { recursive: true });
  await writeFile(join(tree, 'a', 'f.txt'), 'x');
  await symlink(outside, join(tree, 'a', 'j'), 'junction');
  await removeTree(tree);
  assert.equal(existsSync(tree), false);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep me');
});

test('W6-6 (hardening): a folder that is in use says so in plain words', async (t) => {
  const r = await makeRepo(t);
  const { tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  // a lock is simulated by making the folder impossible to remove while it is "in use"
  const busy = createToolInstaller({ dataDir: join(r.dir, 'data'), mcp: { add: async () => ({}) }, removeTreeImpl: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } });
  await assert.rejects(busy.removeFiles({ source: { folder: plan.folder } }), (err) => err.code === 'tool.inUse' && /folder is in use; close what uses it and try again/.test(err.message));
});

test('W6-6 (hardening): POST /api/mcp ignores a source in the body: only the installer can say where a connector came from', async (t) => {
  const { base } = await startApp(t, { fake: false });
  const res = await post(base, '/api/mcp', { name: 'Plain', url: 'https://plain.example/mcp', source: { repo: 'acme/x', sha: 'a'.repeat(40), folder: 'victim' } });
  assert.equal(res.status, 200);
  const list = await (await fetch(base + '/api/mcp')).json();
  assert.equal(list[0].source, undefined);
  // and a local one, with the confirmation the route asks for
  const local = await post(base, '/api/mcp', { name: 'Local', command: 'node', args: ['x.js'], confirmLocal: true, source: { repo: 'acme/x', sha: 'b'.repeat(40), folder: 'victim' } });
  assert.equal(local.status, 200);
  assert.ok(!(await (await fetch(base + '/api/mcp')).json()).some((c) => c.source));
});

test('W6-6 (hardening): a git dependency with a prepare script does not run it while installing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-w66g-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const marker = join(dir, 'prepare-ran.txt').replace(/\\/g, '/');
  // the dependency: a repository whose package.json has a prepare script that writes the marker
  const dep = join(dir, 'dep');
  await mkdir(dep);
  git(dep, 'init', '-q', '-b', 'main');
  await writeFile(join(dep, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0', scripts: { prepare: `node -e "require('fs').writeFileSync('${marker}', 'ran')"` } }));
  git(dep, 'add', '-A'); git(dep, 'commit', '-q', '-m', 'dep');
  // the tool, with no lock file, depending on it by git address
  const r = await makeRepo(t, { lock: false });
  const pkg = JSON.parse(await readFile(join(r.repo, 'package.json'), 'utf8'));
  pkg.dependencies = { dep: pathToFileURL(dep).href.replace('file:', 'git+file:') };
  await writeFile(join(r.repo, 'package.json'), JSON.stringify(pkg, null, 2));
  git(r.repo, 'add', '-A'); git(r.repo, 'commit', '-q', '-m', 'dependency');
  r.state.sha = git(r.repo, 'rev-parse', 'HEAD');
  const { dataDir, tools } = await installer(t, r);
  const plan = await tools.inspect('acme/carrot-server');
  await tools.install({ repo: 'acme/carrot-server', expectSha: plan.sha });
  assert.equal(existsSync(join(dataDir, 'tools', plan.folder, 'node_modules', 'dep', 'package.json')), true, 'the git dependency really was installed');
  assert.equal(existsSync(marker), false, 'its prepare script did not run');
});
