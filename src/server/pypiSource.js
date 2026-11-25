/**
 * INSTALL-ANYWHERE IA-3: a local connector from PyPI, pinned, and WHEELS ONLY all the way down. `name==version` is resolved on pypi.org to a wheel with its sha256; pip resolves the whole dependency set with
 * `--only-binary=:all:` (a dependency that exists only as an sdist, which would run setup.py, stops the install and is named); every package is pinned with its sha256 in a requirements file and installed with
 * `--require-hashes --no-deps` into a venv made at CARD time at the connector's final folder (a venv cannot be moved), marked pending. The card names what is in the tree. The yes re-hashes the tree (IA-5) and
 * removes the pending mark; no or a timeout deletes the folder. pip runs with `--isolated`, this index only, no input and none of the person's pip settings. Nothing runs at install time.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { treeHash } from './installSource.js';
import { unpackZip } from './engines/unpack.js';
import { execAbsolute, installEnv, pythonProgram } from './installExec.js';

export const INDEX = 'https://pypi.org/simple';
const NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const EXACT = /^\d+(\.\d+)*([abc]|rc)?\d*(\.post\d+)?(\.dev\d+)?(\+[A-Za-z0-9.]+)?$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const PYPI_LIMITS = Object.freeze({ wheel: 50 * 1024 * 1024, unpacked: 200 * 1024 * 1024 });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** "name==version" -> { name, version } or { error }. Only an exact version is pinned. */
export function parsePypiSpec(text) {
  const m = /^([^=<>!~\s]+)==(\S+)$/.exec(String(text ?? '').trim());
  if (!m) return { error: 'Say the package as name==version (an exact version).' };
  if (!NAME.test(m[1])) return { error: `"${m[1].slice(0, 60)}" is not a PyPI package name.` };
  if (!EXACT.test(m[2])) return { error: 'That is not an exact version.' };
  return { name: m[1], version: m[2] };
}

// IA-12: python and pip are started by absolute path found before any download, with no shell, from a folder of ours that holds nothing downloaded
const defaultRun = (program, args, { cwd, env }) => execAbsolute(program, args, { cwd, env, timeout: 600_000 });

/** What pip runs with: this index only, none of the person's pip settings (--isolated), binaries only, hashes required, no prompts. */
export const PIP_FLAGS = Object.freeze(['--isolated', '--no-input', '--disable-pip-version-check', '--only-binary=:all:', `--index-url=${INDEX}`, '--no-cache-dir']);
export function pipEnv(home) {
  const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? process.env.TMPDIR ?? '', HOME: home, USERPROFILE: home, APPDATA: home, PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  return installEnv(env); // no PIP_INDEX_URL, PIP_EXTRA_INDEX_URL or PIP_* of the person's: only what is named here
}

async function walk(dir, base = dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) { const f = join(dir, e.name); if (e.isDirectory()) await walk(f, base, out); else out.push(relative(base, f).split(sep).join('/')); }
  return out;
}

/** Pick the wheel to pin: a pure-Python wheel when there is one, else the first wheel. An sdist is never taken. */
export function pickWheel(urls) {
  const wheels = (urls ?? []).filter((u) => u.packagetype === 'bdist_wheel' && /^[0-9a-f]{64}$/.test(String(u.digests?.sha256 ?? '')) && String(u.url).startsWith('https://'));
  if (!wheels.length) throw new Error('That package has no wheel (it is only offered as source, which would run its setup script). Bunny installs wheels only.');
  return wheels.find((u) => /-py2?\.?py3-none-any\.whl$|-py3-none-any\.whl$/.test(u.filename)) ?? wheels[0];
}

/**
 * Card time. `fetchJson(url)`, `fetchBytes(url, { maxBytes })` are the bounded public https reads; `run(program, args, { cwd, env })` runs python or pip (all injectable for tests); `python` is the program that makes the venv.
 * `dest` is the connector's final folder: the venv is made there, marked pending.
 */
export async function preparePypi(text, { workDir, dest, python = null, fetchJson, fetchBytes, run = defaultRun, now = () => new Date() } = {}) {
  const parsed = parsePypiSpec(text);
  if (parsed.error) throw new Error(parsed.error);
  if (!python) python = pythonProgram(workDir); // resolved now, before anything is downloaded
  const meta = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(parsed.name)}/${encodeURIComponent(parsed.version)}/json`);
  const wheel = pickWheel(meta?.urls);
  const bytes = Buffer.from(await fetchBytes(wheel.url, { maxBytes: PYPI_LIMITS.wheel }));
  if (bytes.length > PYPI_LIMITS.wheel) throw new Error('That package is larger than Bunny installs from.');
  if (sha256(bytes) !== wheel.digests.sha256) throw new Error('The wheel does not match the hash PyPI published, so it was refused. Nothing was installed.');
  const home = join(workDir, 'pip-home', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const scratch = join(workDir, 'pypi-scratch', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  if (existsSync(dest)) throw new Error('That folder already exists, so Bunny will not build over it. Nothing was installed.'); // never delete something that is already there before the yes
  await mkdir(home, { recursive: true }); await mkdir(scratch, { recursive: true }); await mkdir(dest, { recursive: true });
  const env = pipEnv(home);
  try {
    // 1. unpack the wheel to read its entry points and look at it (only read; never run)
    const wheelFile = join(scratch, wheel.filename); await writeFile(wheelFile, bytes);
    const unpacked = join(scratch, 'wheel'); await unpackZip(wheelFile, unpacked, { max: PYPI_LIMITS.unpacked });
    const wheelFiles = await walk(unpacked);
    const entry = wheelFiles.find((f) => /\.dist-info\/entry_points\.txt$/.test(f));
    let target = null;
    if (entry) {
      const m = /\[console_scripts\][^\[]*?=\s*([A-Za-z_][\w.]*):([A-Za-z_]\w*)/s.exec(await readFile(join(unpacked, entry), 'utf8'));
      if (m) target = { module: m[1], func: m[2] };
    }
    const top = wheelFiles.map((f) => f.split('/')[0]).find((f) => IDENT.test(f) && wheelFiles.includes(`${f}/__main__.py`));
    if (!target && !top) throw new Error('That package does not say how to run it (no console script and no __main__), so Bunny cannot run it as a connector.');
    if (target && !(IDENT.test(target.func) && target.module.split('.').every((p) => IDENT.test(p)))) throw new Error('That package names its entry point in a way Bunny does not accept.');
    // 2. the venv at the final folder, then the whole set resolved with wheels only
    await run(python, ['-m', 'venv', join(dest, 'venv')], { cwd: home, env });
    const venvPy = join(dest, 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    const report = join(scratch, 'report.json');
    await run(venvPy, ['-m', 'pip', 'install', '--dry-run', '--ignore-installed', '--report', report, ...PIP_FLAGS, `${parsed.name}==${parsed.version}`], { cwd: home, env })
      .catch((err) => { throw new Error(`A package this one needs has no wheel, or could not be found, so Bunny will not install it (wheels only, all the way down): ${String(err.message).slice(0, 160)}`); });
    const rep = JSON.parse(await readFile(report, 'utf8'));
    const pins = [];
    for (const item of rep.install ?? []) {
      const h = item.download_info?.archive_info?.hashes?.sha256 ?? String(item.download_info?.archive_info?.hash ?? '').replace(/^sha256=/, '');
      const url = String(item.download_info?.url ?? '');
      if (!/^[0-9a-f]{64}$/.test(h) || !/\.whl$/i.test(url)) throw new Error(`${item.metadata?.name ?? 'A package'} is not a wheel with a published hash, so Bunny will not install it (wheels only, all the way down).`);
      pins.push({ name: item.metadata.name, version: item.metadata.version, sha256: h });
    }
    const requirements = pins.map((p) => `${p.name}==${p.version} --hash=sha256:${p.sha256}`).join('\n') + '\n';
    const reqFile = join(dest, 'requirements.lock'); await writeFile(reqFile, requirements);
    await run(venvPy, ['-m', 'pip', 'install', '--require-hashes', '--no-deps', '-r', reqFile, ...PIP_FLAGS], { cwd: home, env });
    // 3. what is in the whole tree
    await writeFile(join(dest, '.pending'), `${now().toISOString()}\n`);
    const files = (await walk(dest)).filter((f) => f !== '.pending');
    const pkgOf = (f) => { const m = /site-packages\/([^/]+)/.exec(f); return m ? m[1].replace(/\.(dist-info|libs)$/, '').replace(/\.py$/, '') : parsed.name; };
    const compiledPackages = [...new Set(files.filter((f) => /\.(pyd|so|dylib)$/i.test(f) || /\.so\.\d/.test(f)).map(pkgOf))];
    const args = target ? ['-c', `import sys; from ${target.module} import ${target.func}; sys.exit(${target.func}())`] : ['-m', top];
    await rm(scratch, { recursive: true, force: true }).catch(() => {}); await rm(home, { recursive: true, force: true }).catch(() => {});
    return { name: parsed.name, version: parsed.version, wheel: wheel.filename, sha256: wheel.digests.sha256, size: bytes.length, dest, command: venvPy, args, dependencies: Math.max(0, pins.length - 1), pins, compiled: compiledPackages.length > 0, compiledPackages, treeHash: await treeHash(dest, { skip: ['.pending'] }), fetchedAt: now().toISOString() };
  } catch (err) {
    await rm(dest, { recursive: true, force: true }).catch(() => {}); await rm(scratch, { recursive: true, force: true }).catch(() => {}); await rm(home, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export function describePypi(p) {
  return [
    `Connector from PyPI: ${p.name}==${p.version}`,
    `Pinned: ${p.wheel}, sha256 ${p.sha256.slice(0, 16)}…, ${Math.round(p.size / 1024)} KB, fetched just now`,
    `Wheels only, all the way down: this adds ${p.dependencies} more package${p.dependencies === 1 ? '' : 's'}, each pinned with its hash.`,
    ...(p.compiledPackages.length ? p.compiledPackages.slice(0, 12).map((n) => `${n}: includes compiled code`) : ['No compiled code in the whole tree.']),
    `Runs: ${p.args[0] === '-m' ? `python -m ${p.args[1]}` : 'its console script'}   (in ${p.dest})`,
    'This runs code from the internet on this computer.',
  ].join('\n');
}

/** The yes: the folder must hash the same (IA-5); then the pending mark goes. Nothing is downloaded. */
export async function installPypi(p) {
  let same = false;
  try { same = (await treeHash(p.dest, { skip: ['.pending'] })) === p.treeHash; } catch { same = false; }
  if (!same) { await rm(p.dest, { recursive: true, force: true }).catch(() => {}); throw new Error('The source changed after you looked; nothing was installed.'); }
  await rm(join(p.dest, '.pending'), { force: true });
  return { command: p.command, args: p.args, folder: p.dest };
}
export const discardPypi = (p) => rm(p?.dest ?? '', { recursive: true, force: true }).catch(() => {});
