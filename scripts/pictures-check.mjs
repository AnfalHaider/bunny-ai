// PICTURE-CHECK, the fast half (O7): every help picture is listed, listed once, shown somewhere, and described the same way where it is shown. No browser.
//   node scripts/pictures-check.mjs          check this repository (the gate runs it as "help pictures listed", also in --quick)
//
// A help picture is a file in docs/images/ that README.md, a help page (docs/help/**) or the app (src/ui/**) refers to. Design's drawings (docs/design/review-*) are records of a moment
// and are not help pictures. The manifest is docs/images/pictures.json: one entry per picture, saying which scene makes it (e2e/pictures/scenes.mjs), at what size and theme, what is
// captured, how much may differ, what its words are (alt) and where it is used; or why it is exempt (hand-made art).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PICTURES_DIR = 'docs/images';
export const MANIFEST = 'docs/images/pictures.json';
export const SCENES = 'e2e/pictures/scenes.mjs';
export const DEFAULT_TOLERANCE = 0.002;
export const MAX_TOLERANCE = 0.01;
const EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Decode the few entities an HTML attribute may carry. */
const unescapeAttr = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const walk = (root, dir, keep) => {
  const out = [];
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, rel, keep));
    else if (keep(rel)) out.push(rel);
  }
  return out;
};

/** Every place a help picture may be referred to: README.md, docs/help/** (.md, .html) and src/ui/** (.html, .js). */
export function referenceFiles(root) {
  const files = [];
  if (existsSync(join(root, 'README.md'))) files.push('README.md');
  files.push(...walk(root, 'docs/help', (f) => /\.(md|html)$/i.test(f)));
  files.push(...walk(root, 'src/ui', (f) => /\.(html|js)$/i.test(f) && !f.includes('/fonts/')));
  return files;
}

/** The pictures a file refers to: [{ name, alt|null, file }]. An <img> gives its alt; a markdown image gives its alt; a <source srcset> or any other mention gives none. */
export function referencesIn(file, text) {
  const found = [];
  const mention = /docs\/images\/([\w.-]+\.(?:png|jpe?g|gif|webp|svg))/gi;
  const imgTag = /<img\b[^>]*>/gi;
  const withAlt = new Map();
  for (const m of text.matchAll(imgTag)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    const name = /docs\/images\/([\w.-]+\.(?:png|jpe?g|gif|webp|svg))/i.exec(src)?.[1];
    if (name) withAlt.set(name, /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? null);
  }
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]*docs\/images\/([\w.-]+\.(?:png|jpe?g|gif|webp|svg)))[^)]*\)/gi)) withAlt.set(m[3], m[1]);
  for (const m of text.matchAll(mention)) {
    const name = m[1];
    found.push({ name, alt: withAlt.has(name) ? unescapeAttr(withAlt.get(name) ?? '') : null, file, hasAlt: withAlt.has(name) });
  }
  return found;
}

/** @returns {string[]} one line for each problem; empty when every help picture is listed. */
export function checkPictures(root = '.') {
  const problems = [];
  const manifestFile = join(root, MANIFEST);
  if (!existsSync(manifestFile)) return [`${MANIFEST} is missing: every help picture needs an entry there.`];
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch (err) { return [`${MANIFEST} is not valid JSON: ${err.message}`]; }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [`${MANIFEST} must be an object with one entry per picture.`];

  const onDisk = walk(root, PICTURES_DIR, (f) => EXTENSIONS.test(f)).map((f) => f.slice(PICTURES_DIR.length + 1));
  // 1. every file has an entry, every entry has its file
  for (const f of onDisk) if (!Object.hasOwn(manifest, f)) problems.push(`${PICTURES_DIR}/${f} has no entry in ${MANIFEST}: add its scene (or an exempt reason).`);
  for (const name of Object.keys(manifest)) if (!onDisk.includes(name)) problems.push(`${MANIFEST} lists ${name} but ${PICTURES_DIR}/${name} is not there.`);

  // the shape of each entry
  for (const [name, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== 'object') { problems.push(`${name}: the entry must be an object.`); continue; }
    if (Object.hasOwn(entry, 'exempt')) {
      if (typeof entry.exempt !== 'string' || entry.exempt.trim().length < 8) problems.push(`${name}: an exempt picture needs a reason (at least a short sentence).`);
      continue;
    }
    if (typeof entry.scene !== 'string' || !/^[\w-]+$/.test(entry.scene)) problems.push(`${name}: scene must be the name of a scene (letters, digits, - and _).`);
    if (!(Array.isArray(entry.viewport) && entry.viewport.length === 2 && entry.viewport.every((n) => Number.isInteger(n) && n >= 200 && n <= 4000))) problems.push(`${name}: viewport must be [width, height] in whole pixels.`);
    if (!['light', 'dark'].includes(entry.theme)) problems.push(`${name}: theme must be "light" or "dark".`);
    if (entry.scale !== undefined && entry.scale !== 1) problems.push(`${name}: scale must be 1 (pictures are made at a device scale of 1).`);
    const cap = entry.capture;
    const okCapture = cap === undefined || cap === 'viewport' || (cap && typeof cap === 'object' && ((typeof cap.locator === 'string' && cap.locator) || (Array.isArray(cap.clip) && cap.clip.length === 4 && cap.clip.every(Number.isFinite))));
    if (!okCapture) problems.push(`${name}: capture must be "viewport", { locator } or { clip: [x, y, w, h] }.`);
    if (entry.tolerance !== undefined) {
      if (!(typeof entry.tolerance === 'number' && entry.tolerance > 0 && entry.tolerance <= MAX_TOLERANCE)) problems.push(`${name}: tolerance must be above 0 and at most ${MAX_TOLERANCE}.`);
      else if (entry.tolerance > DEFAULT_TOLERANCE && !(typeof entry.why === 'string' && entry.why.trim().length >= 8)) problems.push(`${name}: a tolerance above ${DEFAULT_TOLERANCE} needs a "why".`);
    }
    if (typeof entry.alt !== 'string' || !entry.alt.trim()) problems.push(`${name}: alt (the words that describe the picture) is missing.`);
    if (!(Array.isArray(entry.usedBy) && entry.usedBy.length && entry.usedBy.every((f) => typeof f === 'string'))) problems.push(`${name}: usedBy must list the files that show it.`);
  }

  // the scene each entry names is in e2e/pictures/scenes.mjs (only checked once that file exists)
  if (existsSync(join(root, SCENES))) {
    const names = new Set([...readFileSync(join(root, SCENES), 'utf8').matchAll(/^ {2}(?:'([\w-]+)'|([\w]+)):\s*async\b/gm)].map((m) => m[1] ?? m[2]));
    for (const [name, entry] of Object.entries(manifest)) if (entry && typeof entry.scene === 'string' && !names.has(entry.scene)) problems.push(`${name}: the scene "${entry.scene}" is not in ${SCENES}.`);
  }

  // 2 and 3. every reference has an entry, every usedBy really refers to the picture, and the alt is the same words
  const refs = [];
  for (const file of referenceFiles(root)) refs.push(...referencesIn(file, readFileSync(join(root, file), 'utf8')));
  for (const r of refs) {
    if (!Object.hasOwn(manifest, r.name)) problems.push(`${r.file} shows ${PICTURES_DIR}/${r.name}, which has no entry in ${MANIFEST}.`);
  }
  for (const [name, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== 'object' || !onDisk.includes(name)) continue;
    const mine = refs.filter((r) => r.name === name);
    if (Object.hasOwn(entry, 'exempt')) { if (!mine.length) problems.push(`${name}: nothing shows this picture. Remove it, or show it.`); continue; }
    for (const file of Array.isArray(entry.usedBy) ? entry.usedBy : []) {
      const here = mine.filter((r) => r.file === file);
      if (!here.length) { problems.push(`${name}: usedBy lists ${file}, but ${file} does not refer to ${PICTURES_DIR}/${name}.`); continue; }
      const withAlt = here.find((r) => r.hasAlt);
      if (typeof entry.alt === 'string' && withAlt && withAlt.alt !== entry.alt) problems.push(`${name}: the alt in ${file} ("${String(withAlt.alt).slice(0, 60)}…") is not the alt in ${MANIFEST}. Make them the same words.`);
    }
    for (const r of mine) if (!(entry.usedBy ?? []).includes(r.file)) problems.push(`${r.file} shows ${PICTURES_DIR}/${name}, but ${MANIFEST} does not list it in usedBy.`);
    if (!mine.length) problems.push(`${name}: nothing shows this picture (usedBy is not true). Remove it, or show it.`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkPictures(root);
  const count = (() => { try { return Object.keys(JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'))).length; } catch { return 0; } })();
  if (problems.length) { console.log(problems.map((p) => `  ${p}`).join('\n')); console.log(`help pictures: ${problems.length} problem${problems.length === 1 ? '' : 's'}`); process.exit(1); }
  console.log(`help pictures: ${count} listed, each shown and described the same way`);
}
