/**
 * Windows DPAPI secret store.
 *
 * Encryption is done by Windows itself, bound to the current user, so a copied
 * file is useless on another account or machine. Secrets are never written in
 * plain text and never passed as command-line arguments (they would show up in
 * the process list); they travel over stdin, base64 encoded.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

// S-6 (v0.1.10): the full path of Windows PowerShell, not a name looked up through PATH (a program earlier in PATH could answer instead)
export const PS = join(process.env.SystemRoot ?? process.env.windir ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** S-6: the saved cipher goes into a script, so it must be plain base64 and nothing else. */
export const isCipher = (value) => typeof value === 'string' && value.length > 0 && value.length <= 65536 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

/** Run a PowerShell script and return trimmed stdout, or throw its stderr. */
function powershell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err.trim() || `powershell exited ${code}`));
      else resolve(out.trim());
    });
    // The script carries the payload, so the process table shows only "-Command -".
    child.stdin.end(script, 'utf8');
  });
}

/** File name for a logical key, so ids cannot escape the directory. */
function fileFor(dir, name) {
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 32);
  return join(dir, `${hash}.secret`);
}

/**
 * @param {{ dir: string }} opts
 */
export function dpapiSecretStore({ dir }) {
  if (process.platform !== 'win32') {
    throw new Error('dpapiSecretStore is Windows-only');
  }

  // S-3 (v0.1.10): a per-install entropy value (random, kept in its own file beside the secrets, never in a .secret file) goes into every Protect and Unprotect call, so the two
  // PowerShell calls a generic stealer would make on a copied .secret file fail without it. Secrets saved by an older build (no entropy) still read, and are re-saved with it.
  const entropyFile = join(dir, 'entropy.key');
  let entropy = null;
  async function entropyKey() {
    if (entropy) return entropy;
    await mkdir(dir, { recursive: true });
    try { await writeFile(entropyFile, randomBytes(32).toString('base64'), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); } catch { /* already made */ }
    const text = String(await readFile(entropyFile, 'utf8')).trim();
    if (!isCipher(text)) throw new Error('The secret store\'s entropy file is damaged.');
    entropy = text;
    return entropy;
  }

  async function protect(value) {
    const payload = Buffer.from(String(value), 'utf8').toString('base64');
    const key = await entropyKey();
    return powershell(`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$p = [Convert]::FromBase64String('${payload}')
$k = [Convert]::FromBase64String('${key}')
$e = [Security.Cryptography.ProtectedData]::Protect($p, $k, 'CurrentUser')
[Convert]::ToBase64String($e)
`);
  }

  async function unprotect(cipher, withEntropy) {
    const key = withEntropy ? await entropyKey() : null;
    return powershell(`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$e = [Convert]::FromBase64String('${cipher}')
$k = ${key ? `[Convert]::FromBase64String('${key}')` : '$null'}
$p = [Security.Cryptography.ProtectedData]::Unprotect($e, $k, 'CurrentUser')
[Convert]::ToBase64String($p)
`);
  }

  return {
    async set(name, value) {
      await mkdir(dir, { recursive: true });
      const blob = await protect(value);
      const target = fileFor(dir, name);
      const temp = `${target}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ name, cipher: blob, v: 2 }), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, target);
    },

    async get(name) {
      let raw;
      try {
        raw = await readFile(fileFor(dir, name), 'utf8');
      } catch {
        return null;
      }
      let cipher;
      let version = 1;
      try { ({ cipher, v: version = 1 } = JSON.parse(raw)); } catch { return null; }
      if (!isCipher(cipher)) return null; // a file that is not what Bunny wrote is a secret that is not there
      const out = await unprotect(cipher, version === 2);
      const value = Buffer.from(out, 'base64').toString('utf8');
      if (version !== 2) { try { await this.set(name, value); } catch { /* it still reads next time */ } } // saved by an older build: now with entropy
      return value;
    },

    async delete(name) {
      await rm(fileFor(dir, name), { force: true });
    },
  };
}

/** Where secrets live by default. */
export function defaultSecretDir() {
  const base = process.env.LOCALAPPDATA ?? process.env.HOME ?? '.';
  return join(base, 'BunnyAI', 'secrets');
}
