// Renders compose.html to PNGs. Run from the repo root with Playwright installed:
//   node docs/design/readme-images/render.mjs
// Uses only images already in the repo (invented profiles). file:// is fine: fetch of the logo needs a server, so this script starts none and inlines instead.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const dir = `${root}/docs/design/readme-images`;
const mark = readFileSync(`${root}/docs/design/logo/bunny-mark.svg`, 'utf8');
const html = readFileSync(`${dir}/compose.html`, 'utf8')
  .replace("fetch('../logo/bunny-mark.svg').then(r=>r.text())", `Promise.resolve(${JSON.stringify(mark)})`);
writeFileSync(`${dir}/.compose-run.html`, html);
const jobs = JSON.parse(readFileSync(`${dir}/jobs.json`, 'utf8'));
const b = await chromium.launch();
for (const j of jobs) {
  const size = j.kind === 'hero' ? { width: 1800, height: 600 } : { width: 1600, height: 1000 };
  const p = await b.newPage({ viewport: size });
  const q = new URLSearchParams({ kind: j.kind, theme: j.theme, img: pathToFileURL(/^[A-Za-z]:|^\//.test(j.img) ? j.img : `${root}/${j.img}`).href, ...(j.q || {}) });
  await p.goto(`${pathToFileURL(`${dir}/.compose-run.html`).href}?${q}`);
  await p.waitForFunction(() => document.title === 'ready');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${root}/docs/images/${j.out}` });
  await p.close();
}
await b.close();
