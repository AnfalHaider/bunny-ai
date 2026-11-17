/**
 * W6-6: install a tool (an MCP server written in Node.js) from a public GitHub repository, with the person's yes on a card.
 *
 * What makes this safe enough to offer:
 *  - the card is made from what GitHub says about ONE commit (its sha, the files it holds, the exact install command), and the install
 *    happens at that commit or not at all: if the branch moved between the card and the clone, nothing is installed;
 *  - the code goes only into <data folder>\tools\<owner>-<repo>-<sha7>, never into the chat's folder, and nothing outside it is touched;
 *  - npm runs with --ignore-scripts (flag and environment): no preinstall, install or postinstall script of the repository or of its
 *    dependencies runs while installing; the server's own code runs only when the person switches the connector on and it starts;
 *  - removing the connector removes the folder, after checking the saved name still points inside the tools folder.
 * Only public repositories, only Node.js servers. A Python or other server is added by the person in Settings, Customize.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

export const TOOLS_DIR = 'tools';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const STEP_TIMEOUT_MS = 5 * 60_000;

/** "owner/repo" from a short name or a github.com link. */
export function cleanRepo(value) {
  const text = String(value ?? '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:\/(?:tree|blob)\/.*)?$/.exec(text);
  if (!m || m[2] === '.' || m[2] === '..') throw new Error('Give the repository as owner/name or a github.com link.');
  return `${m[1]}/${m[2]}`;
}

/** The folder name of one installed tool: one path segment, from the repository and the first 7 characters of the commit. */
export function toolFolderName(full, sha) {
  return `${full.replace('/', '-')}-${String(sha).slice(0, 7)}`.replace(/[^\w.-]/g, '-');
}

/** Where the programs run: the environment is a short list, never the person's tokens, and npm is told twice not to run scripts. */
function installEnv() {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, GIT_TERMINAL_PROMPT: '0', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
}

/** Run one fixed program with fixed arguments. (npm is a .cmd on Windows, which needs a shell; the arguments are constants of this file.) */
export function runCommand(file, args, { cwd }) {
  return new Promise((resolveRun, reject) => {
    execFile(file, args, { cwd, env: installEnv(), timeout: STEP_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 << 20, shell: process.platform === 'win32' && file === 'npm' }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).replace(/\s+/g, ' ').trim().slice(0, 400)));
      else resolveRun(String(stdout));
    });
  });
}

export function createToolInstaller({ dataDir, mcp, fetchImpl = globalThis.fetch, cloneUrl = (full) => `https://github.com/${full}.git`, runner = runCommand }) {
  const toolsRoot = () => resolve(dataDir, TOOLS_DIR);

  async function getJson(url, what) {
    const res = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Bunny-AI' }, redirect: 'error' });
    if (res.status === 404) throw new Error(`GitHub has no public ${what} there.`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the ${what}.`);
    return res.json();
  }

  /** What GitHub says about the repository at one commit, and what installing it would do. Nothing is downloaded to disk. */
  async function inspect(repo) {
    const full = cleanRepo(repo);
    const meta = await getJson(`${API}/repos/${full}`, 'repository');
    if (meta.private) throw new Error('Only public repositories can be installed from here.');
    // everything on the card that the repository controls is checked first: one plain line each, no control characters, no way to look like a card line of ours
    const branch = String(meta.default_branch ?? 'main');
    if (!/^[\w@./-]{1,100}$/.test(branch)) throw new Error('The repository\'s default branch has an unusual name, so Bunny AI will not install from it.');
    const head = await getJson(`${API}/repos/${full}/commits/${encodeURIComponent(branch)}`, 'branch');
    const sha = String(head.sha ?? '');
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub did not give a commit for the repository.');
    const tree = await getJson(`${API}/repos/${full}/git/trees/${sha}?recursive=1`, 'file list');
    const files = new Set((tree.tree ?? []).filter((t) => t.type === 'blob').map((t) => t.path));
    if (!files.has('package.json')) {
      throw new Error('This repository has no package.json, so it is not a Node.js tool. Only Node.js servers can be installed from here; add another kind in Settings, Customize.');
    }
    const raw = await fetchImpl(`${RAW}/${full}/${sha}/package.json`, { headers: { 'user-agent': 'Bunny-AI' }, redirect: 'error' });
    let pkg = null;
    try { pkg = JSON.parse(await raw.text()); } catch { pkg = null; }
    if (!pkg || typeof pkg !== 'object') throw new Error('The package.json of this repository could not be read.');
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && typeof pkg.bin === 'object' ? Object.values(pkg.bin).find((v) => typeof v === 'string') : null;
    const entry = String(bin ?? pkg.main ?? '').replace(/^\.[\\/]/, '').replace(/\\/g, '/');
    if (!entry || entry.startsWith('/') || entry.split('/').includes('..') || !/^[\w@./-]{1,200}$/.test(entry)) {
      throw new Error('The package.json does not name a program to start (no "bin" or "main"), so Bunny AI does not know how to run this tool.');
    }
    const lock = files.has('package-lock.json');
    const install = lock ? ['ci', '--ignore-scripts'] : ['install', '--ignore-scripts'];
    const name = String(full.split('/')[1]).slice(0, 60);
    const folder = toolFolderName(full, sha);
    const where = join(toolsRoot(), folder);
    const lines = [
      'Install a tool from GitHub',
      `Repository: ${full}  (${Number(meta.stargazers_count ?? 0)} stars, last push ${/^\d{4}-\d\d-\d\d/.test(String(meta.pushed_at ?? '')) ? String(meta.pushed_at).slice(0, 10) : 'unknown'})`,
      `Version: commit ${sha.slice(0, 7)} on ${branch}${/^[\w.+-]{1,30}$/.test(String(pkg.version ?? '')) ? `, package version ${pkg.version}` : ''}`,
      `It goes in: ${where}`,
      `Install command: npm ${install.join(' ')}   (install scripts are NOT run)`,
      ...(lock ? [] : ['There is no package-lock.json, so npm install picks the newest versions of its dependencies.']),
      `It will start with: node ${entry}`,
      'This runs code from the internet on this computer.',
    ];
    return { repo: full, sha, branch, name, folder, entry, install, lock, stars: Number(meta.stargazers_count ?? 0), pushedAt: String(meta.pushed_at ?? ''), cardText: lines.join('\n') };
  }

  /** Install at exactly the commit the person was shown. */
  async function install({ repo, expectSha }) {
    if (!/^[0-9a-f]{40}$/.test(String(expectSha ?? ''))) throw new Error('A tool is only installed after the person has seen its card.');
    const plan = await inspect(repo);
    if (plan.sha !== expectSha) throw new Error('The repository changed after the card was shown (a newer commit), so nothing was installed. Ask again to see the new card.');
    const root = toolsRoot();
    const target = join(root, plan.folder);
    if (relative(root, target).startsWith('..') || isAbsolute(relative(root, target))) throw new Error('The tool folder would be outside Bunny AI\'s tools folder, so nothing was installed.');
    if (await stat(target).then(() => true, () => false)) throw new Error(`${plan.repo} at commit ${plan.sha.slice(0, 7)} is already installed.`);
    await mkdir(root, { recursive: true });
    try {
      await runner('git', ['clone', '--depth', '1', '--no-tags', '--single-branch', cloneUrl(plan.repo), target], { cwd: root });
      const head = String(await runner('git', ['rev-parse', 'HEAD'], { cwd: target })).trim();
      if (head !== plan.sha) throw new Error('The repository changed after the card was shown (a newer commit), so nothing was installed. Ask again to see the new card.');
      await runner('npm', plan.install, { cwd: target });
      const entryPath = resolve(target, plan.entry);
      const inside = relative(target, entryPath);
      if (inside.startsWith('..') || isAbsolute(inside) || !(await stat(entryPath).then((s) => s.isFile(), () => false))) throw new Error(`The program ${plan.entry} is not in the repository, so the tool cannot be started.`);
      const added = await mcp.add({ name: plan.name, command: 'node', args: [entryPath], enabled: true, source: { repo: plan.repo, sha: plan.sha, folder: plan.folder } });
      return `Installed ${plan.repo} (commit ${plan.sha.slice(0, 7)}) as the connector ${added.name}. Its install scripts were not run. It is switched on; its tools are offered from the next message. Removing the connector removes its files.`;
    } catch (err) {
      await rm(target, { recursive: true, force: true }).catch(() => {}); // a half install is not kept
      throw err;
    }
  }

  /** The folder of an installed tool, only if its saved name is one plain name that lands inside the tools folder. */
  function folderOf(server) {
    const name = server?.source?.folder;
    if (typeof name !== 'string' || !name) return null;
    const root = toolsRoot();
    const target = resolve(root, name);
    const rel = relative(root, target);
    if (name !== rel || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
      throw new Error('This tool\'s saved folder is not inside Bunny AI\'s tools folder, so nothing was removed. Check the connector list file.');
    }
    return target;
  }

  /** Remove an installed tool's files (before its connector goes). Returns true when there were files to remove. */
  async function removeFiles(server) {
    const target = folderOf(server); // throws for a tampered path, before anything is removed
    if (!target) return false;
    await rm(target, { recursive: true, force: true });
    return true;
  }

  return { inspect, install, removeFiles, folderOf, toolsRoot };
}
