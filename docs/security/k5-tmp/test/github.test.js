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
  assert.equal(JSON.parse(await secrets.get('account:google')).refresh, '1//r');
  assert.equal(await accounts.googleAccessToken(), 'ya29.x', 'a fresh token is used as it is');
  await assert.rejects(accounts.googleFinish({ code: 'again', state: params.get('state') }), /expired/, 'a sign-in link works once');
});

test('the account routes report nothing signed in, refuse a bad token, and need a client id for Google', async (t) => {
  const { base } = await startApp(t);
  const { body } = await json(base, '/api/account');
  assert.deepEqual(body, { github: null, google: null, githubDeviceReady: false, googleReady: false, googleWorkspaceOn: false });
  assert.equal((await post(base, '/api/account/github/token', { token: 'nope' })).status, 400);
  const google = await post(base, '/api/account/google/start', {});
  assert.equal(google.status, 400);
  assert.match(google.body.message, /client id/);
});

test('Gmail, Calendar and Drive are asked for only when switched on, and an old token is renewed', async (t) => {
  const { mkdtemp: mk } = await import('node:fs/promises');
  const dir = await mk(join(tmpdir(), 'bunny-account-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let renewals = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'refresh_token') { renewals += 1; return new Response(JSON.stringify({ access_token: 'ya29.new', expires_in: 3600 }), { status: 200 }); }
      return new Response(JSON.stringify({ access_token: 'ya29.old', refresh_token: '1//r', expires_in: 1, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly' }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: 'Anna', email: 'anna@example.com' }), { status: 200 });
  };
  const settings = { googleClientId: 'abc.apps.googleusercontent.com', googleWorkspace: false };
  const accounts = createAccounts({ file: join(dir, 'account.json'), secrets: memorySecretStore(), getSettings: () => settings, fetchImpl });
  assert.equal(new URL(accounts.googleStart('http://127.0.0.1:1').url).searchParams.get('scope'), 'openid email profile');
  settings.googleWorkspace = true;
  const params = new URL(accounts.googleStart('http://127.0.0.1:1').url).searchParams;
  assert.match(params.get('scope'), /gmail\.readonly.*calendar\.events.*drive\.readonly/);
  assert.equal(params.get('access_type'), 'offline');
  const who = await accounts.googleFinish({ code: 'c', state: params.get('state') });
  assert.equal(who.workspace, true);
  assert.equal(await accounts.googleAccessToken(), 'ya29.new', 'the token had run out, so it was renewed');
  assert.equal(await accounts.googleAccessToken(), 'ya29.new');
  assert.equal(renewals, 1, 'and the renewed one is kept');
});

test('the Google tools search mail, draft without sending, read the calendar and export a Doc', async () => {
  const { runGoogleTool, googleToolDefinitions, GOOGLE_TOOL_RISK } = await import('../src/server/google.js');
  assert.equal(GOOGLE_TOOL_RISK.gmail_send, 'send', 'sending asks in every mode (its own risk, not the build one Auto lets through)');
  assert.equal(GOOGLE_TOOL_RISK.gmail_draft, 'edit');
  assert.ok(!googleToolDefinitions(['read']).some((d) => d.function.name === 'gmail_draft'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization });
    const ok = (d) => new Response(typeof d === 'string' ? d : JSON.stringify(d), { status: 200 });
    if (url.includes('/messages?')) return ok({ messages: [{ id: 'm1' }] });
    if (url.includes('/messages/m1?format=metadata')) return ok({ snippet: 'Your carrots shipped', payload: { headers: [{ name: 'From', value: 'shop@example.com' }, { name: 'Subject', value: 'Order 42' }, { name: 'Date', value: 'Mon' }] } });
    if (url.includes('/drafts')) return ok({ id: 'd1' });
    if (url.includes('/calendar/v3/')) return ok({ items: [{ summary: 'Carrot tasting', start: { dateTime: '2026-11-20T15:00:00Z' }, end: { dateTime: '2026-11-20T16:00:00Z' } }] });
    if (url.includes('/export?')) return ok('Carrot Shop plan');
    if (url.includes('/drive/v3/files/doc1?fields')) return ok({ name: 'Plan', mimeType: 'application/vnd.google-apps.document' });
    return new Response('{}', { status: 404 });
  };
  const opts = { token: 'ya29.t', fetchImpl };
  assert.match(await runGoogleTool('gmail_search', { query: 'newer_than:7d' }, opts), /\[m1\] Mon · shop@example\.com · Order 42\n  Your carrots shipped/);
  assert.match(await runGoogleTool('gmail_draft', { to: 'a@example.com', subject: 'Hi', body: 'Hello' }, opts), /draft d1/);
  const draft = calls.find((c) => c.url.includes('/drafts'));
  assert.match(Buffer.from(draft.body.message.raw, 'base64url').toString(), /^To: a@example\.com\r\nSubject: =\?UTF-8\?B\?SGk=\?=/);
  assert.ok(!calls.some((c) => c.url.includes('/messages/send')), 'a draft is not sent');
  assert.match(await runGoogleTool('calendar_events', {}, opts), /Carrot tasting/);
  assert.equal(await runGoogleTool('drive_read', { id: 'doc1' }, opts), 'Plan:\nCarrot Shop plan');
  assert.ok(calls.every((c) => c.auth === 'Bearer ya29.t'));
});
