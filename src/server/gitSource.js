/**
 * INSTALL-ANYWHERE IA-1: a git host that is not GitHub's API (GitLab, Bitbucket, Codeberg, any https address ending .git).
 * git does its own networking, so fetchLimited does not cover it. Every call here:
 *   - refuses a host that is, or resolves to, a private address BEFORE git starts;
 *   - runs git with the person's own setup cut off: no system or global config (an empty one, an isolated HOME), no insteadOf rewrites, no credential helper, no prompt, no askpass, no proxy, no hooks, no fsmonitor,
 *     no LFS smudge, no submodules, only the https protocol, and no redirects followed;
 *   - pins a 40-character commit with ls-remote, fetches exactly that commit (depth 1) and checks `git rev-parse HEAD` equals it;
 *   - removes the .git folder; the files are only read afterwards.
 */
import { execFile } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPrivateAddress } from './download.js';

const SHA = /^[0-9a-f]{40}$/;

/** { url (the clone address), ref, host } from a git address or a GitLab / Bitbucket / Codeberg page link, or { error }. */
export function parseGitAddress(address) {
  let u;
  try { u = new URL(String(address ?? '').trim()); } catch { return { error: 'That is not a full address.' }; }
  if (u.protocol !== 'https:') return { error: 'Only https git addresses are installed from.' };
  if (u.username || u.password) return { error: 'An address with a user name or password in it is refused.' };
  if (u.hostname.toLowerCase() === 'github.com') return { error: 'GitHub links are read through GitHub.' };
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return { error: 'A git address needs an owner and a repository.' };
  let ref = null;
  const cut = parts.findIndex((p, i) => i >= 2 && (p === 'tree' || p === 'src' || p === 'browse') && parts[i + 1]); // /tree/<ref>, /-/tree/<ref>, /src/<ref>
  const owner = parts[0];
  let repo;
  const dashAt = parts.indexOf('-');
  if (parts.some((p) => p.endsWith('.git'))) repo = parts.slice(1, parts.findIndex((p) => p.endsWith('.git')) + 1).join('/');
  else repo = parts.slice(1, dashAt > 0 ? dashAt : cut > 0 ? cut : parts.length).join('/');
  if (cut > 0) ref = parts[cut + 1];
  if (!repo) return { error: 'A git address needs an owner and a repository.' };
  if (/[^\w.@:/-]/.test(`${owner}/${repo}`)) return { error: 'That repository name has characters Bunny does not accept.' };
  const cloneUrl = `https://${u.host}/${owner}/${repo.replace(/\.git$/, '')}.git`;
  return { url: cloneUrl, ref: ref && /^[\w./-]{1,100}$/.test(ref) ? ref : null, host: u.hostname.toLowerCase() };
}

/** The environment git runs in: nothing of the person's own setup. */
export function isolatedEnv(home) {
  return {
    PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? process.env.TMPDIR ?? '', TMP: process.env.TMP ?? process.env.TMPDIR ?? '',
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, APPDATA: home, LOCALAPPDATA: home,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'empty.gitconfig'), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ALLOW_PROTOCOL: 'https', GIT_PROTOCOL_FROM_USER: '0', GIT_OPTIONAL_LOCKS: '0',
  };
}
/** The options placed before every git sub-command. */
export const isolatedArgs = (hooks) => ['-c', 'credential.helper=', '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false', '-c', 'http.proxy=', '-c', 'submodule.recurse=false', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false', '-c', 'core.symlinks=false', '-c', 'core.autocrlf=false'];

const defaultRun = (args, { cwd, env }) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, env, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, shell: false }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(String(stdout))));
});

/** Refuse a host that is, or resolves to, a private address, before git starts. */
export async function checkGitHost(host, { lookupImpl = (h, o) => dnsLookup(h, o) } = {}) {
  const h = String(host).replace(/^\[|\]$/g, '');
  const refuse = () => new Error('Bunny installs from a git host only at a public https address.');
  if (isIP(h)) { if (isPrivateAddress(h)) throw refuse(); return; }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || !h.includes('.')) throw refuse();
  let list;
  try { const found = await lookupImpl(h, { all: true }); list = Array.isArray(found) ? found : [found]; } catch { throw new Error(`Could not find the host ${h}.`); }
  if (!list.length || list.some((x) => isPrivateAddress(x.address))) throw refuse();
}

/**
 * Resolve the commit and fetch exactly it into `dest` (an empty folder). Returns { commit }. `workDir` holds the isolated home and the empty hooks folder.
 * `runGit(args, { cwd, env })` is injectable for tests; `allowFile` lets a test clone from a local bare repository (nothing in the app passes it).
 */
export async function fetchGitSource(address, dest, { workDir, runGit = defaultRun, lookupImpl, allowFile = false } = {}) {
  const parsed = allowFile ? { url: String(address), ref: null, host: 'local' } : parseGitAddress(address); // a test's local bare repository is the only thing allowFile allows; nothing in the app passes it
  if (parsed.error) throw new Error(parsed.error);
  if (!allowFile) await checkGitHost(parsed.host, { lookupImpl });
  const home = join(workDir, 'git-home'); const hooks = join(workDir, 'git-hooks');
  await mkdir(home, { recursive: true }); await mkdir(hooks, { recursive: true });
  await writeFile(join(home, 'empty.gitconfig'), '');
  const env = isolatedEnv(home);
  const base = isolatedArgs(hooks);
  const url = allowFile ? String(address) : parsed.url;
  const out = await runGit([...base, 'ls-remote', url, parsed.ref ?? 'HEAD'], { cwd: workDir, env: allowFile ? { ...env, GIT_ALLOW_PROTOCOL: 'file' } : env });
  const commit = String(out).split(/\s+/)[0] ?? '';
  if (!SHA.test(commit)) throw new Error('That git address did not name a commit Bunny could read.');
  await mkdir(dest, { recursive: true });
  const e2 = allowFile ? { ...env, GIT_ALLOW_PROTOCOL: 'file' } : env;
  const fileArgs = allowFile ? ['-c', 'protocol.file.allow=always'] : [];
  await runGit([...base, ...fileArgs, 'init', '-q'], { cwd: dest, env: e2 });
  await runGit([...base, ...fileArgs, 'fetch', '-q', '--depth', '1', '--no-recurse-submodules', '--no-tags', url, commit], { cwd: dest, env: e2 });
  await runGit([...base, 'checkout', '-q', '--detach', '--no-recurse-submodules', 'FETCH_HEAD'], { cwd: dest, env: e2 });
  const head = String(await runGit([...base, 'rev-parse', 'HEAD'], { cwd: dest, env: e2 })).trim();
  if (head !== commit) throw new Error('The commit that was checked out is not the one that was pinned. Nothing was installed.');
  await rm(join(dest, '.git'), { recursive: true, force: true }); // the files are only read from here on
  return { commit, url: parsed.url };
}
