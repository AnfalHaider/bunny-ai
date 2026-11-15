import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubClient, githubToolDefinitions, runGithubTool, GITHUB_TOOL_RISK, describeGithubTool } from '../src/server/github.js';
import { createAccounts } from '../src/server/accounts.js';
import { memorySecretStore } from '../src/providers/connections.js';
import { startApp, post, json } from './helpers.js';

/** A stand-in for api.github.com that records what was asked. */
function fakeGithub() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname + u.search, auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    if (init.headers?.authorization !== 'Bearer ghp_goodtoken0000000000000000') return new Response('{"message":"Bad credentials"}', { status: 401 });
    const p = u.pathname;
    if (p === '/user') return ok({ login: 'bunny', name: 'Bunny Rabbit', avatar_url: 'https://a/x.png', html_url: 'https://github.com/bunny' });
    if (p === '/user/repos') return ok([{ full_name: 'bunny/carrots', private: true, description: 'Crunchy', pushed_at: '2026-11-01T00:00:00Z' }]);
    if (p === '/repos/bunny/carrots/contents/README.md') return ok({ path: 'README.md', encoding: 'base64', size: 9, content: Buffer.from('# Carrots').toString('base64') });
    if (p === '/repos/bunny/carrots/issues' && init.method === 'POST') return ok({ number: 7, html_url: 'https://github.com/bunny/carrots/issues/7' });
    if (p === '/repos/bunny/carrots/issues') return ok([
      { number: 1, state: 'open', title: 'Too few carrots', user: { login: 'a' }, updated_at: '2026-11-02', labels: [{ name: 'bug' }] },
      { number: 2, state: 'open', title: 'A PR', pull_request: {}, user: { login: 'b' }, updated_at: '2026-11-02', labels: [] },
    ]);
    if (p === '/repos/bunny/carrots') return ok({ default_branch: 'main' });
    if (p === '/repos/bunny/carrots/pulls' && init.method === 'POST') return ok({ number: 8, html_url: 'https://github.com/bunny/carrots/pull/8' });
    return new Response('{"message":"Not Found"}', { status: 404 });
  };
  return { calls, fetchImpl };
}

test('reading tools are free; writing to GitHub follows the permission mode; cloning is a command', () => {
  assert.equal(GITHUB_TOOL_RISK.github_read_file, 'read');
  assert.equal(GITHUB_TOOL_RISK.github_create_pull_request, 'edit');
  assert.equal(GITHUB_TOOL_RISK.github_clone, 'run');
  const planOnly = githubToolDefinitions(['read']).map((d) => d.function.name);
  assert.ok(planOnly.includes('github_my_repos') && !planOnly.includes('github_comment'));
  assert.ok(!githubToolDefinitions(['read', 'edit', 'run']).some((d) => d.function.name === 'github_clone'), 'no clone without a folder');
  assert.ok(githubToolDefinitions(['read', 'edit', 'run'], { canClone: true }).some((d) => d.function.name === 'github_clone'));
  assert.equal(describeGithubTool('github_issue', { repo: 'a/b', number: 3 }), 'Read a/b#3');
});

test('the GitHub tools read and write through the API with the signed-in token', async () => {
  const gh = fakeGithub();
  const client = githubClient('ghp_goodtoken0000000000000000', { fetchImpl: gh.fetchImpl });
  assert.match(await runGithubTool(client, 'github_my_repos', {}), /bunny\/carrots \(private\) — Crunchy/);
  assert.equal(await runGithubTool(client, 'github_read_file', { repo: 'https://github.com/bunny/carrots', path: 'README.md' }), 'README.md:\n# Carrots');
  const issues = await runGithubTool(client, 'github_list_issues', { repo: 'bunny/carrots' });
  assert.match(issues, /#1 \[open\] Too few carrots/);
  assert.doesNotMatch(issues, /A PR/, 'pull requests are not listed as issues');
  assert.match(await runGithubTool(client, 'github_create_issue', { repo: 'bunny/carrots', title: 'More', body: 'Please' }), /Opened bunny\/carrots#7/);
  assert.deepEqual(gh.calls.find((c) => c.method === 'POST').body, { title: 'More', body: 'Please' });
  assert.match(await runGithubTool(client, 'github_create_pull_request', { repo: 'bunny/carrots', title: 'Fix', head: 'fix-1' }), /#8/);
  assert.equal(gh.calls.filter((c) => c.method === 'POST').at(-1).body.base, 'main', 'the default branch is the base when none is given');
  await assert.rejects(runGithubTool(client, 'github_repo', { repo: 'not a repo' }), /owner\/name/);
  await assert.rejects(client.get('https://evil.example/steal'), /Only the GitHub API/);
});

test('signing in to GitHub: from the CLI, from a token, and out again; tokens never come back', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-account-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = fakeGithub();
  const secrets = memorySecretStore();
  let cli = null;
  const accounts = createAccounts({ file: join(dir, 'account.json'), secrets, getSettings: () => ({}), fetchImpl: gh.fetchImpl, cliToken: async () => cli });

  await assert.rejects(accounts.githubFromCli(), /not installed or not signed in/);
  cli = 'ghp_goodtoken0000000000000000';
  const me = await accounts.githubFromCli();
  assert.equal(me.login, 'bunny');
  assert.equal(me.method, 'GitHub CLI');
  assert.equal(await accounts.githubToken(), 'ghp_goodtoken0000000000000000');
  const status = await accounts.status();
  assert.equal(status.github.name, 'Bunny Rabbit');
  assert.ok(!JSON.stringify(status).includes('ghp_'), 'the status never carries the token');

  await assert.rejects(accounts.githubFromToken('hello'), /does not look like a GitHub token/);
  await assert.rejects(accounts.githubFromToken('ghp_wrongtoken000000000000000'), /refused/);
  await accounts.signOut('github');
  assert.equal((await accounts.status()).github, null);
  assert.equal(await accounts.githubToken(), null);
  assert.throws(() => accounts.githubDeviceConfig(), /client id/);
});

test('Google sign-in sends the person to Google with PKCE and comes back to this app', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-account-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, body: init.body ? String(init.body) : '' });
    if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'ya29.x', refresh_token: '1//r' }), { status: 200 });
    if (url.includes('userinfo')) return new Response(JSON.stringify({ name: 'Anna', email: 'anna@example.com', picture: 'https://p' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const secrets = memorySecretStore();
  const accounts = createAccounts({ file: join(dir, 'account.json'), secrets, getSettings: () => ({ googleClientId: 'abc.apps.googleusercontent.com' }), fetchImpl });
  const { url } = accounts.googleStart('http://127.0.0.1:5000');
  const params = new URL(url).searchParams;
  assert.equal(params.get('redirect_uri'), 'http://127.0.0.1:5000/api/account/google/callback');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('scope'), 'openid email profile');
  await assert.rejects(accounts.googleFinish({ code: 'c', state: 'not-the-state' }), /expired/);
  const who = await accounts.googleFinish({ code: 'the-code', state: params.get('state') });
  assert.equal(who.email, 'anna@example.com');
  assert.match(seen[0].body, /code_verifier=/);
  assert.equal(await secrets.get('account:google'), '1//r');
  await assert.rejects(accounts.googleFinish({ code: 'again', state: params.get('state') }), /expired/, 'a sign-in link works once');
});

test('the account routes report nothing signed in, refuse a bad token, and need a client id for Google', async (t) => {
  const { base } = await startApp(t);
  const { body } = await json(base, '/api/account');
  assert.deepEqual(body, { github: null, google: null, githubDeviceReady: false, googleReady: false });
  assert.equal((await post(base, '/api/account/github/token', { token: 'nope' })).status, 400);
  const google = await post(base, '/api/account/google/start', {});
  assert.equal(google.status, 400);
  assert.match(google.body.message, /client id/);
});
