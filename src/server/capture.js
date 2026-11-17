/**
 * W6-10: save a copy of the page in the browser panel into the chat's folder: captures/<site>-<yyyymmdd-hhmm>/index.html plus assets/.
 *
 * The page itself (its HTML as it is now and the addresses of its pictures, style sheets, scripts and icons) comes from the browser panel; this
 * file fetches what it names, rewrites the links to the saved copies, and writes everything through the workspace (so the person's rules, the
 * checkpoints, the .git refusal and the folder fence all apply). At most 300 files and 50 MB. A file is fetched with the same address checks as
 * download_file: a private or local address is refused, unless the page itself is on this PC.
 */
import { basename, extname, posix } from 'node:path';
import { isIP } from 'node:net';
import { checkToolCall, describeRule } from './permissionRules.js';

export const MAX_CAPTURE_FILES = 300;
export const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;

const pad = (n) => String(n).padStart(2, '0');

/** Is this host on this computer or on a private network (a page there may name files there)? */
export function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::' || h === '0.0.0.0') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return isIP(h) === 6 && /^(fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:)/.test(h); // an IPv6 literal only: a NAME such as fdn.example.com or fcbarcelona.com is not local
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The folder this capture goes in, relative to the chat's folder: captures/<host>-<yyyymmdd-hhmm>. */
export function captureFolderName(pageUrl, now = new Date()) {
  let host = 'page';
  try { host = new URL(pageUrl).host; } catch { /* keep the plain name */ }
  const site = host.replace(/[^\w.-]/g, '-').replace(/^[.-]+/, '').slice(0, 60) || 'page';
  return `captures/${site}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

const safeName = (url, index) => {
  let name = 'file';
  try { name = basename(new URL(url).pathname) || 'file'; } catch { /* plain */ }
  name = name.replace(/[^\w.-]/g, '-').replace(/^[.-]+/, '').slice(-60) || 'file';
  if (!extname(name)) name += '.bin';
  return `${pad(index)}-${name}`;
};

/**
 * @param {object} o
 * @param {{url: string, html: string, title?: string, resources: {raw: string, url: string, kind: string}[]}} o.info  what the panel's page script returned
 * @param {object} o.workspace  has writeFiles (checked paths, checkpoints)
 * @param {Function} o.fetchLimited  (url, { allowLoopback, signal }) => { bytes, type, url }
 * @returns {Promise<{ folder: string, files: number, bytes: number, skipped: {url: string, why: string}[], text: string }>}
 */
export async function capturePage({ info, workspace, fetchLimited, authorize = null, signal, now = new Date(), maxFiles = MAX_CAPTURE_FILES, maxBytes = MAX_CAPTURE_BYTES }) {
  if (!workspace) throw new Error('Choose a folder for this chat first.');
  let page;
  try { page = new URL(info?.url); } catch { throw new Error('The page has no address that can be saved.'); }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') throw new Error('Only http and https pages can be saved.');
  // a page on this PC may name files on this PC, but only on its OWN origin (same scheme, host and port), also after a redirect; any other page may not
  const pageIsLocal = isLocalHost(page.hostname);
  const allowLoopback = (u) => pageIsLocal && u.origin === page.origin;
  const folder = captureFolderName(page.href, now);
  const saved = new Map(); // address -> { rel (inside the capture folder), bytes }
  const skipped = [];
  let total = 0;
  let index = 0;

  async function take(url, kind) {
    if (saved.has(url)) return saved.get(url);
    if (saved.size >= maxFiles) { skipped.push({ url, why: `more than ${maxFiles} files` }); return null; }
    if (total >= maxBytes) { skipped.push({ url, why: `more than ${Math.round(maxBytes / 1024 / 1024)} MB in all` }); return null; }
    try {
      const got = await fetchLimited(url, { allowLoopback, signal });
      if (total + got.bytes.length > maxBytes) { skipped.push({ url, why: `more than ${Math.round(maxBytes / 1024 / 1024)} MB in all` }); return null; }
      index += 1;
      const entry = { rel: `assets/${safeName(url, index)}`, bytes: got.bytes, kind };
      total += got.bytes.length;
      saved.set(url, entry);
      return entry;
    } catch (err) {
      skipped.push({ url, why: String(err?.message ?? err).slice(0, 160) });
      return null;
    }
  }

  /** The CSS with every url(...) and @import "..." it names saved and pointed at the saved copy. `from` is where the CSS came from; `prefix` is the path from the CSS file to assets/. */
  async function rewriteCss(css, from, prefix) {
    const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    const IMPORT_RE = /@import\s+(['"])([^'"]+)\1/gi;
    const refs = new Set();
    for (const m of css.matchAll(URL_RE)) refs.add(m[2].trim());
    for (const m of css.matchAll(IMPORT_RE)) refs.add(m[2].trim());
    const local = new Map(); // what the CSS wrote -> where the saved copy is
    for (const ref of refs) {
      if (!ref || ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('blob:')) continue;
      let abs;
      try { abs = new URL(ref, from).href; } catch { continue; }
      if (!/^https?:/i.test(abs)) continue;
      const entry = await take(abs, 'asset');
      if (entry) local.set(ref, `${prefix}${posix.basename(entry.rel)}`);
    }
    // only inside url(...) and @import, never anywhere else in the text
    return css
      .replace(URL_RE, (whole, q, ref) => (local.has(ref.trim()) ? `url(${q}${local.get(ref.trim())}${q})` : whole))
      .replace(IMPORT_RE, (whole, q, ref) => (local.has(ref.trim()) ? `@import ${q}${local.get(ref.trim())}${q}` : whole));
  }

  // 1. the files the page names
  let html = String(info.html ?? '');
  for (const res of (Array.isArray(info.resources) ? info.resources : []).slice(0, maxFiles)) {
    if (!/^https?:/i.test(String(res?.url ?? ''))) continue;
    const entry = await take(res.url, res.kind);
    if (!entry) continue;
    if (res.kind === 'style') {
      const css = await rewriteCss(entry.bytes.toString('utf8'), res.url, ''); // the style sheet lives in assets/, next to what it names
      entry.bytes = Buffer.from(css, 'utf8');
    }
    const raw = String(res.raw ?? '');
    if (raw) for (const q of ['"', "'"]) html = html.split(`${q}${raw}${q}`).join(`${q}${entry.rel}${q}`);
  }
  // 2. style blocks inside the page itself
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const m of blocks) {
    const css = await rewriteCss(m[1], page.href, 'assets/');
    if (css !== m[1]) html = html.replace(m[1], () => css);
  }

  // 3. write it all, through the workspace
  const entries = [{ path: `${folder}/index.html`, bytes: Buffer.from(`<!-- A copy of ${page.href} saved by Bunny AI -->\n${html}`, 'utf8') },
    ...[...saved.values()].map((e) => ({ path: `${folder}/${e.rel}`, bytes: e.bytes }))];
  await authorize?.(entries.map((e) => e.path)); // the person's rules, for every path that is about to be written (any Deny: nothing is written)
  await workspace.writeFiles(entries);
  const kb = Math.round(entries.reduce((n, e) => n + e.bytes.length, 0) / 1024);
  const lines = [`Saved a copy of ${page.href} in ${folder}/ (${entries.length} files, ${kb} KB). Open ${folder}/index.html to see it offline.`];
  if (info.truncated) lines.push('The page\'s HTML was longer than 5 MB and was cut.');
  if (skipped.length) lines.push(`Not saved (${skipped.length}):`, ...skipped.slice(0, 15).map((s) => `- ${s.url.slice(0, 120)}: ${s.why}`));
  return { folder, files: entries.length, bytes: entries.reduce((n, e) => n + e.bytes.length, 0), skipped, text: lines.join('\n') };
}

/**
 * W610-2: judge EVERY path a capture will write against the person's rules, as if each were a write_file. Any Deny: throws, so nothing is written.
 * Any Ask: one question that names the folder. `ask(text)` answers true or false.
 */
export async function authorizeWrites({ paths, rules, canon, ask, folder }) {
  let asked = null;
  for (const path of paths) {
    const verdict = checkToolCall(rules, 'write_file', { path }, await canon(path).catch(() => false));
    if (verdict?.effect === 'deny') throw new Error(`Blocked by your permission rule ${describeRule(verdict)} (it covers ${path}): nothing was saved.`);
    if (verdict?.effect === 'ask' && !asked) asked = verdict;
  }
  if (asked && !(await ask(`Save a copy of this page (${paths.length} files) into ${folder}/\n\nAsked because of your rule ${describeRule(asked)}.`))) {
    throw new Error('The person did not allow this. Do not try it again; carry on without it or ask them.');
  }
}
