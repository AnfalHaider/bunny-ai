/**
 * INSTALL-ANYWHERE IA-2: a local connector from npm, pinned. `name@version` becomes an exact version with the registry's own integrity (sha512); the tarball is fetched once and checked against it;
 * every dependency is locked AND installed into a staging folder at CARD time (`npm install --package-lock-only`, then `npm ci --ignore-scripts --omit=dev`, with the person's .npmrc and registries cut off), so the card
 * can say what is really in the whole tree (compiled files, install scripts). After the yes, exactly that staged tree is moved into place, with its tree hash (IA-5) checked again: nothing is downloaded after the person has looked.
 * The connector runs as `node <bin>` from its folder, never `npx -y`. Nothing runs at install time.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { unpackTgz } from './engines/unpack.js';
import { treeHash } from './installSource.js';
import { execAbsolute, installEnv, npmProgram } from './installExec.js';

export const REGISTRY = 'https://registry.npmjs.org';
const NAME = /^(@[a-z0-9][a-z0-9._~-]{0,213}\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
export const NPM_LIMITS = Object.freeze({ tarball: 50 * 1024 * 1024, unpacked: 200 * 1024 * 1024 });

/** "name@version" -> { name, spec }, or { error }. A range or a tag is resolved to an exact version first. */
export function parseNpmSpec(text) {
  const t = String(text ?? '').trim();
  const at = t.lastIndexOf('@');
  const name = at > 0 ? t.slice(0, at) : t;
  const spec = at > 0 ? t.slice(at + 1) : 'latest';
  if (!NAME.test(name)) return { error: `"${t.slice(0, 80)}" is not an npm package name.` };
  if (!/^[\w.^~<>=*|\- ]{1,60}$/.test(spec)) return { error: 'That version is not one Bunny understands.' };
  return { name, spec };
}

/** The sha512 integrity string ("sha512-<base64>") of bytes. */
export const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// IA-12: npm is node.exe + npm-cli.js, both by absolute path found BEFORE any download, with no shell and a working folder that is not the package's
export const runNpmWith = (program) => (args, { cwd, env }) => execAbsolute(program[0], [program[1], ...args], { cwd, env });

/** The options and environment npm runs with: this registry only, an empty user and global config, no scripts, no audit or funding calls. */
export function npmIsolation(home) {
  const empty = join(home, 'empty.npmrc');
  return {
    args: [`--registry=${REGISTRY}/`, `--userconfig=${empty}`, `--globalconfig=${empty}`, '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', `--cache=${join(home, 'cache')}`],
    env: installEnv({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? process.env.TMPDIR ?? '', HOME: home, USERPROFILE: home, APPDATA: home, npm_config_cache: join(home, 'cache') }),
    empty,
  };
}

/** The bin file of an unpacked package, resolved INSIDE the package folder (no escape), or throws. */
export async function binOf(root, pkg, wanted = null) {
  const bins = typeof pkg.bin === 'string' ? { [String(pkg.name).split('/').pop()]: pkg.bin } : (pkg.bin ?? {});
  const names = Object.keys(bins);
  if (!names.length) throw new Error('That package does not say which file to run (no "bin"), so Bunny cannot run it as a connector.');
  const pick = wanted && bins[wanted] ? wanted : names[0];
  const full = resolve(root, String(bins[pick]));
  const rel = relative(root, full);
  if (rel.startsWith('..') || /^[A-Za-z]:|^[\\/]/.test(rel)) throw new Error('That package points its bin outside its own folder, which is refused.');
  let real;
  try { real = await realpath(full); } catch { throw new Error('The bin file the package names is not in it.'); }
  const rr = relative(await realpath(root), real);
  if (rr.startsWith('..') || rr.split(sep).includes('..')) throw new Error('That package points its bin outside its own folder, which is refused.');
  return { name: pick, file: real, rel: rr.split(sep).join('/') };
}

async function walk(dir, base = dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) await walk(f, base, out); else out.push(relative(base, f).split(sep).join('/')); }
  return out;
}

/**
 * Card time: resolve, fetch, check, unpack, lock. Returns what the card shows and what the install will use. `fetchJson(url)` and `fetchBytes(url, { maxBytes })` are the bounded public https reads (tests hand in stand-ins);
 * `runNpm(args, { cwd, env })` runs npm (also injectable).
 */
export async function prepareNpm(text, { workDir, fetchJson, fetchBytes, runNpm = null, now = () => new Date() } = {}) {
  const parsed = parseNpmSpec(text);
  if (parsed.error) throw new Error(parsed.error);
  if (!runNpm) runNpm = runNpmWith(npmProgram(workDir)); // resolved now, before anything is downloaded
  const meta = await fetchJson(`${REGISTRY}/${parsed.name.replace('/', '%2f')}`);
  let version = parsed.spec;
  if (!EXACT.test(version)) {
    version = meta?.['dist-tags']?.[version] ?? (version === 'latest' ? meta?.['dist-tags']?.latest : null);
    if (!version || !EXACT.test(version)) { // NPM-2: a tag that does not name an exact version is refused too; a range: the highest listed exact version that equals it is only taken when it is an exact one; ranges are not guessed at
      throw new Error(`Bunny pins an exact version. Say which one of ${Object.keys(meta?.versions ?? {}).slice(-3).join(', ') || 'its versions'}, or latest.`);
    }
  }
  const entry = meta?.versions?.[version];
  if (!entry?.dist?.tarball || !/^sha512-[A-Za-z0-9+/]+=*$/.test(String(entry.dist.integrity ?? ''))) throw new Error('The registry did not give an exact version with its integrity, so Bunny will not install it.');
  const tarball = new URL(entry.dist.tarball);
  if (tarball.protocol !== 'https:') throw new Error('The package is not offered over https.');
  const bytes = Buffer.from(await fetchBytes(tarball.href, { maxBytes: NPM_LIMITS.tarball }));
  if (bytes.length > NPM_LIMITS.tarball) throw new Error('That package is larger than Bunny installs from.');
  if (integrityOf(bytes) !== entry.dist.integrity) throw new Error('The package does not match the integrity the registry published, so it was refused. Nothing was installed.');
  const root = join(workDir, 'npm', `${parsed.name.replace('/', '__')}-${version}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const archive = join(workDir, 'npm', `${parsed.name.replace('/', '__')}-${version}.tgz`);
  await writeFile(archive, bytes);
  try {
    await unpackTgz(archive, root, { max: NPM_LIMITS.unpacked, strip: 'package' });
    await rm(archive, { force: true });
    // Security: nothing the package ships may steer npm. Its own config, lockfiles and shrinkwrap are removed before npm reads the folder (a project .npmrc can set the registry, script-shell or git program; a shipped lockfile can name any address)
    for (const f of ['.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmrc', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) await rm(join(root, f), { force: true });
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const [dep, range] of Object.entries(pkg[group] ?? {})) {
        if (!/^(npm:)?[\^~<>=*xX0-9.\s|\-a-zA-Z]*$/.test(String(range)) || /^(git|github|file|link|http|https|ssh|workspace)[:+]|\//.test(String(range))) throw new Error(`${dep} comes from ${String(range).slice(0, 60)}, not from the npm registry, so Bunny will not install it.`);
      }
    }
    const scriptsOfMain = { ...(pkg.scripts ?? {}) }; // read for the card before the file is rewritten
    // Security: npm reads only the fields Bunny allows. Everything else in the package's own package.json (peerDependencies, overrides, resolutions, bundleDependencies, workspaces, publishConfig, config ...) is dropped before any npm command runs
    const allowed = { name: pkg.name, version: pkg.version, bin: pkg.bin, main: pkg.main, type: pkg.type, dependencies: pkg.dependencies, optionalDependencies: pkg.optionalDependencies };
    await writeFile(join(root, 'package.json'), JSON.stringify(Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined)), null, 2));
    const needsScript = ['preinstall', 'install', 'postinstall'].filter((k) => scriptsOfMain[k]);
    const bin = await binOf(root, { ...pkg, name: parsed.name });
    // IA-2: the lockfile is made now, from the registry, with nothing of the person's npm setup; the install uses exactly it
    const home = join(workDir, 'npm-home', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`); // this run's own npm home and cache, deleted when the card is made: nothing of the person's cache or config is reused
    await mkdir(home, { recursive: true });
    const iso = npmIsolation(home);
    await writeFile(iso.empty, '');
    iso.env.npm_config_git = join(home, 'no-git'); // a program that does not exist: a dependency (of a dependency) that names a git address can never be cloned, so nothing outside the registry is fetched while the lock is made
    await runNpm(['install', '--package-lock-only', '--omit=dev', '--prefix', root, ...iso.args], { cwd: workDir, env: iso.env }); // cwd is the work folder, never the package's own
    const lockBytes = await readFile(join(root, 'package-lock.json'));
    const lock = JSON.parse(lockBytes.toString('utf8'));
    for (const [k, v] of Object.entries(lock.packages ?? {})) { // every package must come from the public registry over https: no git, no file, no other host
      if (k && v?.resolved && !String(v.resolved).startsWith(`${REGISTRY}/`)) throw new Error(`${k.replace(/^.*node_modules\//, '')} would be fetched from ${String(v.resolved).slice(0, 60)}, not from the npm registry, so Bunny will not install it.`);
      if (k && v?.link) throw new Error('A linked package is not accepted.');
    }
    const count = Math.max(0, Object.keys(lock.packages ?? {}).filter((k) => k).length);
    await runNpm(['ci', '--omit=dev', '--prefix', root, ...iso.args], { cwd: workDir, env: iso.env }); // the whole tree, now, with no scripts
    const files = await walk(root);
    const pkgOf = (f) => { const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(f.replace(/^/, '/')); return m ? m[1] : parsed.name; };
    const compiledPackages = [...new Set(files.filter((f) => /\.node$/i.test(f)).map(pkgOf))];
    const scriptPackages = new Set();
    for (const f of files.filter((x) => /(^|\/)binding\.gyp$/i.test(x))) scriptPackages.add(pkgOf(f)); // binding.gyp means a build step Bunny does not run
    for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x))) {
      try { const pj = JSON.parse(await readFile(join(root, f), 'utf8')); if (['preinstall', 'install', 'postinstall'].some((k) => pj.scripts?.[k])) scriptPackages.add(String(pj.name ?? pkgOf(f))); } catch { /* not a package file */ }
    }
    for (const [k, v] of Object.entries(lock.packages ?? {})) if (k && v?.hasInstallScript) scriptPackages.add(k.replace(/^.*node_modules\//, ''));
    const compiled = compiledPackages.length > 0;
    const compiledFiles = files.filter((f) => /\.node$/i.test(f));
    await rm(home, { recursive: true, force: true }).catch(() => {}); // npm's cache and home are gone
    return {
      name: parsed.name, version, integrity: entry.dist.integrity, tarballSha256: sha256(bytes), size: bytes.length, root, bin,
      command: 'node', args: [bin.file], lockSha256: sha256(lockBytes), treeHash: await treeHash(root), dependencies: count, compiled, compiledCount: compiledFiles.length, compiledPackages, scriptPackages: [...new Set([...scriptPackages, ...(needsScript.length ? [parsed.name] : [])])], needsScript, fetchedAt: now().toISOString(),
    };
  } catch (err) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    await rm(archive, { force: true }).catch(() => {});
    throw err;
  }
}

/** The words on the card for a pinned npm connector. */
export function describeNpm(p) {
  return [
    `Connector from npm: ${p.name}@${p.version}`,
    `Pinned: version ${p.version}, integrity ${p.integrity.slice(0, 22)}…, ${Math.round(p.size / 1024)} KB, fetched just now`,
    `This adds ${p.dependencies} package${p.dependencies === 1 ? '' : 's'}, installed from a list fixed now (${p.lockSha256.slice(0, 12)}…).`,
    ...(p.compiledPackages.length ? p.compiledPackages.slice(0, 12).map((n) => `${n}: includes compiled code`) : ['No compiled code in the whole tree.']),
    ...(p.scriptPackages.length ? p.scriptPackages.slice(0, 12).map((n) => `${n}: needs a script Bunny doesn't run (it may not work)`) : ['No package needs an install script.']),
    `Runs: node ${p.bin.rel}   (in ${p.root})`,
    'This runs code from the internet on this computer.',
  ].join('\n');
}

/** Install exactly what the card showed: the staged tree must still hash the same (IA-5), then that very folder is moved to `dest`. Nothing is downloaded and no npm command runs. Returns { command, args }. */
export async function installNpm(p, { dest } = {}) {
  let same = false;
  try { same = (await treeHash(p.root)) === p.treeHash; } catch { same = false; }
  if (!same) { await rm(p.root, { recursive: true, force: true }).catch(() => {}); throw new Error('The source changed after you looked; nothing was installed.'); }
  if (!dest) throw new Error('There is nowhere to install it.');
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await rename(p.root, dest);
  const bin = await binOf(dest, { name: p.name, bin: { [p.bin.name]: p.bin.rel } });
  return { command: p.command, args: [bin.file], folder: dest };
}

/** The staged folder is deleted when the person says no, when the card times out, and after the move. */
export const discardNpm = (p) => rm(p?.root ?? '', { recursive: true, force: true }).catch(() => {});
