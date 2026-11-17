/**
 * GitHub: signing in, and the tools the model uses once you have.
 *
 * Three ways in, all ending in a token kept in the Windows credential store:
 *   - the GitHub CLI's own sign-in, when `gh` is installed and signed in;
 *   - a personal access token pasted in;
 *   - GitHub's device flow, when an OAuth app's client id is set in Settings.
 *
 * Reading follows the permission mode as reading does everywhere; anything that
 * writes to GitHub (an issue, a comment, a pull request) is an edit and asks first
 * in Manual and Accept edits. Cloning runs git, so it is a command.
 */
import { execFile } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { stat } from 'node:fs/promises';
import { gitPath, ghPath, safeEnv } from './safeExec.js';

const API = 'https://api.github.com';
const MAX_TEXT = 12_000;

/** The token the GitHub CLI holds, or null when it is missing or signed out. */
export function ghCliToken() {
  return new Promise((done) => {
    const program = ghPath();
    if (!program) { done(null); return; }
    execFile(program, ['auth', 'token'], { timeout: 10_000, windowsHide: true, shell: false, env: safeEnv() }, (err, stdout) => {
      const token = String(stdout ?? '').trim();
      done(err || !token ? null : token);
    });
  });
}

/**
 * The git command that clones a repository with the person's token. The token travels in git's ENVIRONMENT (GIT_CONFIG_COUNT/KEY/VALUE), never in the arguments, where any
 * program on the computer could read it from the process list. git is an absolute path (W29-1); the token is never written into .git/config.
 */
export function cloneCommand({ token, full, target, program = gitPath() }) {
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return {
    program,
    args: ['clone', '--depth', '50', `https://github.com/${full}.git`, target],
    env: safeEnv({ GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: header, GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false' }),
  };
}

/** Talk to the GitHub API with a token. */
export function githubClient(token, { fetchImpl = globalThis.fetch, api = API } = {}) {
  async function request(method, path, body) {
    const url = /^https:\/\//.test(path) ? path : `${api}${path.startsWith('/') ? '' : '/'}${path}`;
    if (!url.startsWith(api)) throw new Error('Only the GitHub API can be reached this way.');
    const res = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'Bunny-AI',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.status === 401) throw new Error('GitHub refused the sign-in. Sign in again in Settings, Profile.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${data?.message ?? String(text).slice(0, 200)}`);
    return data;
  }
  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    user: () => request('GET', '/user'),
  };
}

export const GITHUB_TOOL_RISK = {
  github_my_repos: 'read', github_search: 'read', github_repo: 'read', github_read_file: 'read',
  github_list_issues: 'read', github_issue: 'read', github_list_pull_requests: 'read', github_pull_request: 'read',
  github_api_get: 'read',
  github_create_issue: 'edit', github_comment: 'edit', github_create_pull_request: 'edit', github_update_issue: 'edit',
  github_clone: 'run',
};

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const repo = { type: 'string', description: 'owner/name, e.g. octocat/hello-world' };

export function githubToolDefinitions(risks, { canClone = false } = {}) {
  return [
    fn('github_my_repos', 'List the signed-in person\'s GitHub repositories, most recently pushed first.',
      { limit: { type: 'integer', description: 'Up to 100, default 30' } }),
    fn('github_search', 'Search GitHub for repositories, issues and pull requests, or code.',
      { query: { type: 'string', description: 'GitHub search syntax, e.g. "repo:owner/name is:open label:bug"' },
        kind: { type: 'string', enum: ['repositories', 'issues', 'code'], description: 'Default repositories' } }, ['query']),
    fn('github_repo', 'Describe a repository: description, default branch, stars, open issues, and its top-level files.', { repo }, ['repo']),
    fn('github_read_file', 'Read a file (or list a folder) from a repository on GitHub.',
      { repo, path: { type: 'string', description: 'Path in the repository; empty for the root' }, ref: { type: 'string', description: 'Branch, tag or commit; default branch if empty' } }, ['repo']),
    fn('github_list_issues', 'List issues in a repository (not pull requests).',
      { repo, state: { type: 'string', enum: ['open', 'closed', 'all'] }, labels: { type: 'string', description: 'Comma-separated' } }, ['repo']),
    fn('github_issue', 'Read one issue or pull request with its comments.', { repo, number: { type: 'integer' } }, ['repo', 'number']),
    fn('github_list_pull_requests', 'List pull requests in a repository.', { repo, state: { type: 'string', enum: ['open', 'closed', 'all'] } }, ['repo']),
    fn('github_pull_request', 'Read a pull request: its description, status checks summary and changed files with their patches.',
      { repo, number: { type: 'integer' } }, ['repo', 'number']),
    fn('github_api_get', 'Read anything else from the GitHub REST API with a GET, e.g. "/repos/owner/name/releases/latest".',
      { path: { type: 'string' } }, ['path']),
    fn('github_create_issue', 'Open a new issue.', { repo, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, ['repo', 'title']),
    fn('github_update_issue', 'Close, reopen, retitle or relabel an issue or pull request.',
      { repo, number: { type: 'integer' }, state: { type: 'string', enum: ['open', 'closed'] }, title: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, ['repo', 'number']),
    fn('github_comment', 'Comment on an issue or pull request.', { repo, number: { type: 'integer' }, body: { type: 'string' } }, ['repo', 'number', 'body']),
    fn('github_create_pull_request', 'Open a pull request from a pushed branch.',
      { repo, title: { type: 'string' }, head: { type: 'string', description: 'The branch with the changes' }, base: { type: 'string', description: 'The branch to merge into; default branch if empty' },
        body: { type: 'string' }, draft: { type: 'boolean' } }, ['repo', 'title', 'head']),
    ...(canClone ? [fn('github_clone', 'Clone a repository into a folder inside the workspace, signed in, so private repositories work too.',
      { repo, folder: { type: 'string', description: 'Folder name inside the workspace; default the repository name' } }, ['repo'])] : []),
  ].filter((d) => risks.includes(GITHUB_TOOL_RISK[d.function.name]));
}

export function isGithubTool(name) {
  return Object.hasOwn(GITHUB_TOOL_RISK, name);
}

export function describeGithubTool(name, a = {}) {
  const r = String(a.repo ?? '').slice(0, 60);
  switch (name) {
    case 'github_my_repos': return 'List my GitHub repositories';
    case 'github_search': return `Search GitHub for "${String(a.query ?? '').slice(0, 60)}"`;
    case 'github_repo': return `Look at ${r}`;
    case 'github_read_file': return `Read ${r}/${String(a.path ?? '').slice(0, 60)}`;
    case 'github_list_issues': return `List issues in ${r}`;
    case 'github_issue': return `Read ${r}#${a.number}`;
    case 'github_list_pull_requests': return `List pull requests in ${r}`;
    case 'github_pull_request': return `Read pull request ${r}#${a.number}`;
    case 'github_api_get': return `GitHub GET ${String(a.path ?? '').slice(0, 80)}`;
    case 'github_create_issue': return `Open an issue in ${r}: "${String(a.title ?? '').slice(0, 60)}"`;
    case 'github_update_issue': return `Update ${r}#${a.number}`;
    case 'github_comment': return `Comment on ${r}#${a.number}`;
    case 'github_create_pull_request': return `Open a pull request in ${r}: "${String(a.title ?? '').slice(0, 60)}"`;
    case 'github_clone': return `Clone ${r}`;
    default: return name;
  }
}

const cleanRepo = (value) => {
  const m = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(value ?? '').trim());
  if (!m) throw new Error('Give the repository as owner/name.');
  return `${m[1]}/${m[2]}`;
};
const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (cut short)` : text);
const when = (iso) => String(iso ?? '').slice(0, 10);

/** Run one GitHub tool. `workspaceRoot` is needed only to clone. */
export async function runGithubTool(client, name, a = {}, { workspaceRoot = null, token = '' } = {}) {
  switch (name) {
    case 'github_my_repos': {
      const n = Math.max(1, Math.min(100, Number(a.limit) || 30));
      const list = await client.get(`/user/repos?sort=pushed&per_page=${n}`);
      return list.map((r) => `${r.full_name}${r.private ? ' (private)' : ''} — ${r.description ?? 'no description'} · pushed ${when(r.pushed_at)}`).join('\n') || 'No repositories.';
    }
    case 'github_search': {
      const kind = ['repositories', 'issues', 'code'].includes(a.kind) ? a.kind : 'repositories';
      const found = await client.get(`/search/${kind}?per_page=15&q=${encodeURIComponent(String(a.query ?? ''))}`);
      const items = found.items ?? [];
      if (!items.length) return 'Nothing found.';
      if (kind === 'repositories') return items.map((r) => `${r.full_name} ★${r.stargazers_count} — ${r.description ?? ''}`).join('\n');
      if (kind === 'code') return items.map((c) => `${c.repository.full_name}: ${c.path}`).join('\n');
      return items.map((i) => `${i.repository_url.split('/repos/')[1]}#${i.number} [${i.state}${i.pull_request ? ', PR' : ''}] ${i.title}`).join('\n');
    }
    case 'github_repo': {
      const full = cleanRepo(a.repo);
      const r = await client.get(`/repos/${full}`);
      const top = await client.get(`/repos/${full}/contents`).catch(() => []);
      return [
        `${r.full_name}${r.private ? ' (private)' : ''}: ${r.description ?? 'no description'}`,
        `Default branch ${r.default_branch} · ★${r.stargazers_count} · ${r.open_issues_count} open issues and PRs · ${r.language ?? 'no main language'} · pushed ${when(r.pushed_at)}`,
        `Top level: ${(Array.isArray(top) ? top : []).map((f) => (f.type === 'dir' ? `${f.name}/` : f.name)).join(', ')}`,
      ].join('\n');
    }
    case 'github_read_file': {
      const full = cleanRepo(a.repo);
      const path = String(a.path ?? '').replace(/^\/+/, '');
      const ref = a.ref ? `?ref=${encodeURIComponent(a.ref)}` : '';
      const item = await client.get(`/repos/${full}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref}`);
      if (Array.isArray(item)) return item.map((f) => (f.type === 'dir' ? `${f.path}/` : `${f.path} (${f.size} bytes)`)).join('\n') || '(empty folder)';
      if (item.encoding !== 'base64') return `${item.path}: ${item.size} bytes, not readable as text here.`;
      return clip(`${item.path}:\n${Buffer.from(item.content, 'base64').toString('utf8')}`);
    }
    case 'github_list_issues': {
      const full = cleanRepo(a.repo);
      const state = ['open', 'closed', 'all'].includes(a.state) ? a.state : 'open';
      const labels = a.labels ? `&labels=${encodeURIComponent(a.labels)}` : '';
      const list = (await client.get(`/repos/${full}/issues?state=${state}&per_page=30${labels}`)).filter((i) => !i.pull_request);
      return list.map((i) => `#${i.number} [${i.state}] ${i.title} — ${i.user?.login} · ${when(i.updated_at)}${i.labels?.length ? ` · ${i.labels.map((l) => l.name).join(', ')}` : ''}`).join('\n') || 'No issues.';
    }
    case 'github_issue': {
      const full = cleanRepo(a.repo);
      const i = await client.get(`/repos/${full}/issues/${Number(a.number)}`);
      const comments = await client.get(`/repos/${full}/issues/${Number(a.number)}/comments?per_page=30`);
      return clip([
        `${full}#${i.number} [${i.state}${i.pull_request ? ', pull request' : ''}] ${i.title}`,
        `By ${i.user?.login} on ${when(i.created_at)}${i.labels?.length ? ` · labels: ${i.labels.map((l) => l.name).join(', ')}` : ''}`,
        '', i.body ?? '(no description)',
        ...comments.map((c) => `\n--- ${c.user?.login} on ${when(c.created_at)}:\n${c.body}`),
      ].join('\n'));
    }
    case 'github_list_pull_requests': {
      const full = cleanRepo(a.repo);
      const state = ['open', 'closed', 'all'].includes(a.state) ? a.state : 'open';
      const list = await client.get(`/repos/${full}/pulls?state=${state}&per_page=30`);
      return list.map((p) => `#${p.number} [${p.state}${p.draft ? ', draft' : ''}] ${p.title} — ${p.head.ref} → ${p.base.ref} · ${p.user?.login}`).join('\n') || 'No pull requests.';
    }
    case 'github_pull_request': {
      const full = cleanRepo(a.repo);
      const p = await client.get(`/repos/${full}/pulls/${Number(a.number)}`);
      const files = await client.get(`/repos/${full}/pulls/${Number(a.number)}/files?per_page=50`);
      const checks = await client.get(`/repos/${full}/commits/${p.head.sha}/check-runs?per_page=50`).catch(() => null);
      const runs = checks?.check_runs ?? [];
      const summary = runs.length ? `${runs.filter((r) => r.conclusion === 'success').length} of ${runs.length} checks passed${runs.some((r) => r.conclusion === 'failure') ? `; failed: ${runs.filter((r) => r.conclusion === 'failure').map((r) => r.name).join(', ')}` : ''}` : 'no checks';
      return clip([
        `${full}#${p.number} [${p.state}${p.merged ? ', merged' : ''}${p.draft ? ', draft' : ''}] ${p.title}`,
        `${p.head.ref} → ${p.base.ref} by ${p.user?.login} · +${p.additions} −${p.deletions} in ${p.changed_files} files · ${summary}`,
        '', p.body ?? '(no description)', '',
        ...files.map((f) => `--- ${f.filename} (${f.status}, +${f.additions} −${f.deletions})\n${String(f.patch ?? '').slice(0, 1500)}`),
      ].join('\n'));
    }
    case 'github_api_get':
      return clip(JSON.stringify(await client.get(String(a.path ?? '/')), null, 1));
    case 'github_create_issue': {
      const full = cleanRepo(a.repo);
      const i = await client.post(`/repos/${full}/issues`, { title: String(a.title ?? ''), body: a.body ?? '', ...(Array.isArray(a.labels) ? { labels: a.labels } : {}) });
      return `Opened ${full}#${i.number}: ${i.html_url}`;
    }
    case 'github_update_issue': {
      const full = cleanRepo(a.repo);
      const patch = {};
      if (a.state) patch.state = a.state === 'closed' ? 'closed' : 'open';
      if (a.title) patch.title = String(a.title);
      if (Array.isArray(a.labels)) patch.labels = a.labels;
      const i = await client.patch(`/repos/${full}/issues/${Number(a.number)}`, patch);
      return `Updated ${full}#${i.number} (${i.state}): ${i.html_url}`;
    }
    case 'github_comment': {
      const full = cleanRepo(a.repo);
      const c = await client.post(`/repos/${full}/issues/${Number(a.number)}/comments`, { body: String(a.body ?? '') });
      return `Commented: ${c.html_url}`;
    }
    case 'github_create_pull_request': {
      const full = cleanRepo(a.repo);
      const base = a.base || (await client.get(`/repos/${full}`)).default_branch;
      const p = await client.post(`/repos/${full}/pulls`, { title: String(a.title ?? ''), head: String(a.head ?? ''), base, body: a.body ?? '', draft: Boolean(a.draft) });
      return `Opened pull request ${full}#${p.number}: ${p.html_url}`;
    }
    case 'github_clone': {
      if (!workspaceRoot) throw new Error('Cloning needs Code mode with a folder.');
      const full = cleanRepo(a.repo);
      const name = String(a.folder || full.split('/')[1]).replace(/[^\w.-]/g, '-');
      const target = resolve(workspaceRoot, name);
      if (!target.startsWith(resolve(workspaceRoot) + sep)) throw new Error('The folder must be inside the workspace.');
      if (await stat(target).then(() => true, () => false)) throw new Error(`${name} already exists in the workspace.`);
      // The token goes in a header for this one command only; it is never written into .git/config.
      const run = cloneCommand({ token, full, target });
      if (!run.program) throw new Error('git was not found on this computer. Install Git for Windows to clone a repository.');
      await new Promise((done, fail) => {
        execFile(run.program, run.args,
          { timeout: 300_000, windowsHide: true, maxBuffer: 4 << 20, shell: false, env: run.env },
          (err, _out, stderr) => (err ? fail(new Error(String(stderr || err.message).replace(/Basic [A-Za-z0-9+/=]+/g, 'Basic ***').slice(0, 400))) : done()));
      });
      return `Cloned ${full} into ${join(name)} (last 50 commits).`;
    }
    default:
      throw new Error(`There is no GitHub tool called ${name}`);
  }
}
