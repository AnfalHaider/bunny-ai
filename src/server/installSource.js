/**
 * INSTALL-ANYWHERE (the owner: "plugins, tools, skill, MCP servers can be from any website if required"; spec 9242f04c, Security IA-1 to IA-9).
 * This file is the pipeline for a source that is NOT GitHub's API: an archive (.zip, .tar.gz, .tgz) or a single SKILL.md at an https address.
 *
 *   fetch (https, public, bounded) -> pin (sha256 of the bytes) -> unpack safely into a new temp folder -> inspect (the same importer as GitHub) -> tree hash -> ONE CARD -> install exactly what was inspected
 *
 * Nothing in the source runs: it is only read. Hooks, scripts and binaries are listed as not imported and are not kept.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fetchLimited } from './download.js';
import { UnpackError, unpackTgz, unpackZip } from './engines/unpack.js';
import { buildPlugin } from './pluginImport.js';
import { fetchGitSource, parseGitAddress } from './gitSource.js';
import { checkPublicAddress } from './publicFetch.js';

export const LIMITS = Object.freeze({ file: 256 * 1024, archive: 50 * 1024 * 1024, unpacked: 200 * 1024 * 1024, entries: 5000 });
export const CHANGED = 'The source changed after you looked; nothing was installed.';
const UNKNOWN = 'Bunny reads GitHub links, an archive (.zip, .tar.gz, .tgz) or a SKILL.md at a public https address. Other kinds of source are not supported yet.';

/** What kind of source an address names, by its path (the content is checked after the fetch). */
export function sourceKind(address) {
  let u;
  try { u = new URL(String(address ?? '').trim()); } catch { return { error: 'That is not a full address.' }; }
  if (u.protocol !== 'https:') return { error: 'Only https addresses are installed from: http is refused.' };
  if (u.username || u.password) return { error: 'An address with a user name or password in it is refused.' };
  const p = decodeURIComponent(u.pathname).toLowerCase();
  // IA-1: a git host that is not GitHub's (any address ending .git, or a GitLab, Bitbucket or Codeberg page link)
  if (u.hostname.toLowerCase() !== 'github.com' && (/\.git(\/|$)/.test(p) || /^(gitlab\.com|bitbucket\.org|codeberg\.org)$/i.test(u.hostname)) && !/\.(zip|tgz|tar\.gz)$/.test(p)) { const g = parseGitAddress(u.href); return g.error ? { error: g.error } : { kind: 'git', url: u }; }
  if (/\.zip$/.test(p)) return { kind: 'zip', url: u };
  if (/\.(tar\.gz|tgz)$/.test(p)) return { kind: 'tgz', url: u };
  if (/(^|\/)skill\.md$/.test(p) || /\.md$/.test(p)) return { kind: 'skill', url: u };
  return { error: UNKNOWN };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function walk(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** IA-4: .git, .hg and .svn inside an archive are skipped (removed after unpacking); a name that looks like a Windows short name, or a name that clashes after case or Unicode normalisation, stops the install. */
async function tidy(root) {
  const drop = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (/^\.(git|hg|svn)$/i.test(entry.name)) await rm(full, { recursive: true, force: true }); else await drop(full); }
    }
  };
  await drop(root);
  const files = await walk(root);
  if (files.length > LIMITS.entries) throw new Error(`That source has more than ${LIMITS.entries} files, which is more than Bunny installs from. Nothing was installed.`);
  const seen = new Set();
  for (const f of files) {
    if (f.split('/').some((seg) => /~\d+(\.|$)/.test(seg))) throw new Error(`A name in that source looks like a Windows short name (${f.slice(0, 80)}), which Bunny does not accept. Nothing was installed.`);
    const key = f.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`Two files in that source have names that clash (${f.slice(0, 80)}), so it was refused. Nothing was installed.`);
    seen.add(key);
  }
  return files;
}

/** IA-5: sha256 over every kept file's path and bytes, in sorted order. */
export async function treeHash(root, { skip = [] } = {}) {
  const h = createHash('sha256');
  for (const f of (await walk(root)).filter((x) => !skip.includes(x)).sort()) { h.update(`${f}\0`); h.update(createHash('sha256').update(await readFile(join(root, f))).digest()); }
  return h.digest('hex');
}

async function sizeOf(root) { let n = 0; for (const f of await walk(root)) n += (await stat(join(root, f))).size; return n; }

/**
 * Fetch, pin, unpack, inspect. Returns a prepared source (kept in a temp folder under `workDir`, never fetched twice) or throws a plain message; any failure leaves nothing behind.
 * `fetchSource(url, { maxBytes })` -> { bytes, url } is the bounded public https fetch (tests hand in a loopback stand-in).
 */
export async function prepareSource(address, { workDir, fetchSource = (u, o) => fetchLimited(u, o), now = () => new Date(), checkAddress = checkPublicAddress, gitOptions = {} } = {}) {
  const found = sourceKind(address);
  if (found.error) throw new Error(found.error);
  const token = randomUUID();
  const work = join(workDir, token);
  await mkdir(work, { recursive: true });
  try {
    const maxBytes = found.kind === 'skill' ? LIMITS.file : LIMITS.archive;
    let root = join(work, 'src');
    let repoName = decodeURIComponent(found.url.pathname).split('/').filter(Boolean).pop() ?? 'source';
    let bytes = Buffer.alloc(0); let pin = ''; let commit = null;
    if (found.kind === 'git') { // IA-1: the commit is the pin; git runs in isolation and only the files are kept
      const got = await fetchGitSource(found.url.href, root, { workDir: work, ...gitOptions });
      commit = got.commit; pin = got.commit;
      repoName = repoName.replace(/\.git$/, '');
    } else {
    const got = await fetchSource(found.url.href, { maxBytes });
    const finalUrl = new URL(String(got.url ?? found.url.href));
    if (finalUrl.protocol !== 'https:') throw new Error('The address sent Bunny to a page that is not https, which is refused.');
    bytes = Buffer.from(got.bytes);
    if (bytes.length > maxBytes) throw new Error(`That source is larger than the limit (${Math.round(maxBytes / 1024)} KB). Nothing was installed.`);
    pin = sha256(bytes);
    await mkdir(root, { recursive: true });
    if (found.kind === 'skill') {
      await writeFile(join(root, 'SKILL.md'), bytes);
      repoName = decodeURIComponent(found.url.pathname).split('/').filter(Boolean).slice(-2, -1)[0] ?? found.url.hostname;
    } else {
      const archive = join(work, found.kind === 'zip' ? 'source.zip' : 'source.tgz');
      await writeFile(archive, bytes);
      try {
        if (found.kind === 'zip') await unpackZip(archive, root, { max: LIMITS.unpacked }); else await unpackTgz(archive, root, { max: LIMITS.unpacked });
      } catch (err) { throw err instanceof UnpackError ? new Error(`${err.message} Nothing was installed.`) : err; }
      await rm(archive, { force: true });
      // a single top folder (GitHub's own archives have one) is the plugin's folder
      const top = await readdir(root, { withFileTypes: true });
      if (top.length === 1 && top[0].isDirectory()) root = join(root, top[0].name);
      repoName = repoName.replace(/\.(zip|tar\.gz|tgz)$/i, '');
    }
    }
    const real = await sizeOf(root);
    if (real > LIMITS.unpacked) throw new Error('That source is larger than Bunny installs from. Nothing was installed.');
    const files = await tidy(root); // after this, only text that the importer reads is opened
    const raw = async (path) => {
      const full = join(root, path);
      if ((await stat(full)).size > LIMITS.file * 2) throw new Error(`${path} is too large`);
      return readFile(full, 'utf8');
    };
    const plugin = await buildPlugin({ files, raw, repo: repoName.slice(0, 60), source: found.url.href });
    // IA-0/IA-6: a remote connector the source brings must be https and public; anything else is listed as refused, never added
    const connectors = [];
    for (const c of plugin.connectors) {
      try { await checkAddress(c.url); connectors.push(c); } catch { plugin.skipped.push(`connector "${c.name}" at ${String(c.url).slice(0, 120)} (not a public https address)`); }
    }
    plugin.connectors = connectors;
    if (!plugin.skills.length && !plugin.connectors.length) throw new Error('That source has no skills or remote connectors Bunny can use.');
    return { token, kind: found.kind, url: found.url.href, host: found.url.host, sha256: pin, commit, size: bytes.length, fetchedAt: now().toISOString(), root, work, treeHash: await treeHash(root), plugin };
  } catch (err) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export const discardSource = (prepared) => rm(prepared?.work ?? '', { recursive: true, force: true }).catch(() => {});

/** IA-5: just before the install the folder is hashed again; any difference stops it. */
export async function stillTheSame(prepared) {
  try { return (await treeHash(prepared.root)) === prepared.treeHash; } catch { return false; }
}

/** The words on the card for this source: where it is from, the pin, its size, and every part by name. */
export function describeSource(prepared, { openWeb = false } = {}) {
  const p = prepared.plugin;
  const kb = prepared.size < 1024 ? `${prepared.size} bytes` : `${Math.round(prepared.size / 1024)} KB`;
  const lines = [
    ...(openWeb ? ['Found on the open web: not from a known catalogue.'] : []),
    `Source ${prepared.url}`,
    prepared.commit ? `Commit ${prepared.commit}, fetched just now` : `Fingerprint (sha256) ${prepared.sha256.slice(0, 16)}…, ${kb}, fetched just now`,
    `Plugin ${p.name}${p.description ? `: ${p.description}` : ''}`,
    ...p.skills.map((s) => `Skill ${s.name} (${String(s.instructions ?? '').length} characters of instructions): ${s.description || '(no description)'}`),
    ...p.connectors.map((c) => `Connector ${c.name}: ${c.url}`),
    ...(p.connectors.length ? ['This service can change what it does at any time.'] : []),
    ...(p.skipped?.length ? [`Not imported: ${p.skipped.join('; ')}`] : []),
  ];
  return lines.join('\n');
}
