import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGitAddress, checkGitHost, fetchGitSource, isolatedEnv } from '../src/server/gitSource.js';
import { sourceKind } from '../src/server/installSource.js';

// INSTALL-ANYWHERE IA-1: git hosts other than GitHub's API. Local stand-ins only; git runs in isolation and the commit is the pin.
const SHA = 'b'.repeat(40);
const pub = async () => [{ address: '93.184.216.34', family: 4 }];
const dirs = []; const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'bunny-git-')); dirs.push(d); return d; };
test.after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

test('which git addresses are read: https only, no password, GitLab / Bitbucket / Codeberg page links and .git addresses; GitHub keeps its own path', () => {
  assert.deepEqual(parseGitAddress('https://gitlab.com/acme/tools.git'), { url: 'https://gitlab.com/acme/tools.git', ref: null, host: 'gitlab.com' });
  assert.equal(parseGitAddress('https://gitlab.com/acme/tools/-/tree/v1.2').ref, 'v1.2');
  assert.equal(parseGitAddress('https://gitlab.com/acme/tools/-/tree/v1.2').url, 'https://gitlab.com/acme/tools.git');
  assert.equal(parseGitAddress('https://codeberg.org/acme/tools/src/branch-x').url, 'https://codeberg.org/acme/tools.git');
  assert.equal(parseGitAddress('https://git.example.org/team/repo.git').host, 'git.example.org');
  for (const bad of ['http://gitlab.com/a/b.git', 'ssh://git@gitlab.com/a/b.git', 'https://u:p@gitlab.com/a/b.git', 'https://github.com/a/b', 'https://gitlab.com/onlyowner']) assert.ok(parseGitAddress(bad).error, bad);
  assert.equal(sourceKind('https://gitlab.com/acme/tools').kind, 'git');
  assert.equal(sourceKind('https://git.example.org/x/y.git').kind, 'git');
  assert.equal(sourceKind('https://x.example.org/p.zip').kind, 'zip');
});

test('a host that is, or resolves to, a private address is refused BEFORE git starts', async () => {
  let ran = 0; const runGit = async () => { ran += 1; return ''; };
  const work = await tmp();
  for (const url of ['https://127.0.0.1/a/b.git', 'https://10.0.0.5/a/b.git', 'https://localhost/a/b.git', 'https://[::1]/a/b.git']) await assert.rejects(fetchGitSource(url, join(work, 'x'), { workDir: work, runGit }), /public https address/, url);
  await assert.rejects(fetchGitSource('https://rebind.example.com/a/b.git', join(work, 'x'), { workDir: work, runGit, lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }] }), /public https address/);
  assert.equal(ran, 0, 'git never started');
  await assert.doesNotReject(checkGitHost('git.example.com', { lookupImpl: pub }));
});

test("git runs with none of the person's own setup, only https, no redirects, no hooks, no submodules, and the checked-out commit must equal the pinned one", async () => {
  const work = await tmp(); const calls = [];
  const runGit = async (args, { env, cwd }) => {
    calls.push({ args, env, cwd });
    if (args.includes('ls-remote')) return `${SHA}\tHEAD\n`;
    if (args.includes('rev-parse')) return `${SHA}\n`;
    return '';
  };
  const got = await fetchGitSource('https://git.example.com/team/repo.git', join(work, 'src'), { workDir: work, runGit, lookupImpl: pub });
  assert.equal(got.commit, SHA);
  for (const c of calls) {
    assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1'); assert.ok(c.env.GIT_CONFIG_GLOBAL.startsWith(work), "an empty config inside the work folder, not the person's");
    assert.equal(c.env.GIT_TERMINAL_PROMPT, '0'); assert.equal(c.env.GCM_INTERACTIVE, 'never'); assert.equal(c.env.GIT_ASKPASS, ''); assert.equal(c.env.GIT_LFS_SKIP_SMUDGE, '1'); assert.equal(c.env.GIT_ALLOW_PROTOCOL, 'https');
    assert.ok(c.env.HOME.startsWith(work), 'an isolated HOME'); assert.equal(c.env.SSH_AUTH_SOCK, undefined);
    const line = c.args.join(' ');
    for (const need of ['credential.helper=', `core.hooksPath=${join(work, 'git-hooks')}`, 'core.fsmonitor=false', 'protocol.allow=never', 'protocol.https.allow=always', 'http.followRedirects=false', 'submodule.recurse=false', 'filter.lfs.smudge=']) assert.ok(line.includes(need), need);
    assert.ok(!/--recurse-submodules/.test(line.replaceAll('--no-recurse-submodules', '')));
  }
  const fetch = calls.find((c) => c.args.includes('fetch'));
  assert.ok(fetch.args.includes('--depth') && fetch.args.at(-1) === SHA, 'it fetched exactly the pinned commit at depth 1');
  assert.ok(!existsSync(join(work, 'src', '.git')), 'the .git folder is gone');
  await assert.rejects(fetchGitSource('https://git.example.com/team/repo.git', join(work, 'src2'), { workDir: work, lookupImpl: pub, runGit: async (args) => (args.includes('ls-remote') ? `${SHA}\tHEAD` : args.includes('rev-parse') ? `${'c'.repeat(40)}\n` : '') }), /not the one that was pinned/);
  assert.equal(isolatedEnv('/h').HOME, '/h');
});

test('with real git: a local repository is cloned at its commit, the commit is the pin, and the .git folder is dropped', async (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('git is not installed'); return; }
  const work = await tmp(); const repo = join(work, 'repo');
  await mkdir(join(repo, 'skills', 'notes'), { recursive: true });
  await writeFile(join(repo, 'skills', 'notes', 'SKILL.md'), '---\nname: notes\ndescription: Take notes\n---\nTake notes.');
  await writeFile(join(repo, '.gitattributes'), '* filter=evil\n');
  const g = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: join(work, 'none') } });
  g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'one');
  const head = g('rev-parse', 'HEAD').trim();
  const got = await fetchGitSource(repo, join(work, 'out'), { workDir: join(work, 'w'), allowFile: true });
  assert.equal(got.commit, head);
  assert.ok(existsSync(join(work, 'out', 'skills', 'notes', 'SKILL.md'))); assert.ok(!existsSync(join(work, 'out', '.git')));
});
