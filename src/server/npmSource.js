/**
 * INSTALL-ANYWHERE IA-2: a local connector from npm, pinned. `name@version` becomes an exact version with the registry's own integrity (sha512); the tarball is fetched once and checked against it;
 * every dependency is locked at CARD time (`npm install --package-lock-only --ignore-scripts`, with the person's .npmrc and registries cut off); the install is `npm ci --ignore-scripts --omit=dev` from
 * THAT lockfile, whose sha256 is checked again first. The connector then runs as `node <bin>` from its folder, never `npx -y`. Nothing runs at install time.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { unpackTgz } from './engines/unpack.js';

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

const defaultNpm = (args, { cwd, env }) => new Promise((ok, bad) => {
  execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, env, windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' }, (err, out, errText) => (err ? bad(new Error(String(errText || err.message).slice(0, 300))) : ok(String(out))));
});

/** The options and environment npm runs with: this registry only, an empty user and global config, no scripts, no audit or funding calls. */
export function npmIsolation(home) {
  const empty = join(home, 'empty.npmrc');
  return {
    args: [`--registry=${REGISTRY}/`, `--userconfig=${empty}`, `--globalconfig=${empty}`, '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier'],
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? process.env.TMPDIR ?? '', HOME: home, USERPROFILE: home, APPDATA: home, npm_config_cache: join(home, 'cache') },
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
export async function prepareNpm(text, { workDir, fetchJson, fetchBytes, runNpm = defaultNpm, now = () => new Date() } = {}) {
  const parsed = parseNpmSpec(text);
  if (parsed.error) throw new Error(parsed.error);
  const meta = await fetchJson(`${REGISTRY}/${parsed.name.replace('/', '%2f')}`);
  let version = parsed.spec;
  if (!EXACT.test(version)) {
    version = meta?.['dist-tags']?.[version] ?? (version === 'latest' ? meta?.['dist-tags']?.latest : null);
    if (!version) { // a range: the highest listed exact version that equals it is only taken when it is an exact one; ranges are not guessed at
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
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const needsScript = ['preinstall', 'install', 'postinstall'].filter((k) => pkg.scripts?.[k]);
    const bin = await binOf(root, { ...pkg, name: parsed.name });
    const files = await walk(root);
    const compiled = files.some((f) => /\.node$/i.test(f) || /(^|\/)binding\.gyp$/i.test(f));
    // IA-2: the lockfile is made now, from the registry, with nothing of the person's npm setup; the install uses exactly it
    const home = join(workDir, 'npm-home');
    await mkdir(home, { recursive: true });
    const iso = npmIsolation(home);
    await writeFile(iso.empty, '');
    await runNpm(['install', '--package-lock-only', '--omit=dev', ...iso.args], { cwd: root, env: iso.env });
    const lockBytes = await readFile(join(root, 'package-lock.json'));
    const lock = JSON.parse(lockBytes.toString('utf8'));
    const count = Math.max(0, Object.keys(lock.packages ?? {}).filter((k) => k).length);
    return {
      name: parsed.name, version, integrity: entry.dist.integrity, tarballSha256: sha256(bytes), size: bytes.length, root, bin,
      command: 'node', args: [bin.file], lockSha256: sha256(lockBytes), dependencies: count, compiled, needsScript, fetchedAt: now().toISOString(), home, iso,
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
    ...(p.compiled ? ['Includes compiled code.'] : []),
    ...(p.needsScript.length ? [`Needs an install script (${p.needsScript.join(', ')}), which Bunny does not run. It may not work.`] : []),
    `Runs: node ${p.bin.rel}   (in ${p.root})`,
    'This runs code from the internet on this computer.',
  ].join('\n');
}

/** Install exactly what the card showed: the lockfile must still hash the same, then `npm ci` from it, with no scripts. Returns { command, args }. */
export async function installNpm(p, { runNpm = defaultNpm } = {}) {
  const lockBytes = await readFile(join(p.root, 'package-lock.json')).catch(() => null);
  if (!lockBytes || sha256(lockBytes) !== p.lockSha256) { await rm(p.root, { recursive: true, force: true }).catch(() => {}); throw new Error('The source changed after you looked; nothing was installed.'); }
  await runNpm(['ci', '--omit=dev', ...p.iso.args], { cwd: p.root, env: p.iso.env });
  const bin = await binOf(p.root, { name: p.name, bin: { [p.bin.name]: p.bin.rel } });
  if (bin.file !== p.bin.file) throw new Error('The program to run changed after you looked; nothing was installed.');
  return { command: p.command, args: [bin.file] };
}
