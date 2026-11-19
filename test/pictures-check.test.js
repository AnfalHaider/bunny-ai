import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkPictures, referencesIn } from '../scripts/pictures-check.mjs';

// PICTURE-CHECK, the fast half: every help picture is listed once, shown, and described the same way. Fixture folders, one rule failing each.
const entry = (extra = {}) => ({ scene: 'settings-wait', viewport: [860, 900], theme: 'light', scale: 1, capture: 'viewport', alt: 'Settings: a wait row', usedBy: ['README.md'], ...extra });
const readmeFor = (names, alt = 'Settings: a wait row') => names.map((n) => `<img src="docs/images/${n}" alt="${alt}" width="440" />`).join('\n');

function repo(t, { files = ['a.png'], manifest = { 'a.png': entry() }, readme = readmeFor(['a.png']), extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-pic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel, text) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  for (const f of files) put(`docs/images/${f}`, 'png');
  if (manifest) put('docs/images/pictures.json', JSON.stringify(manifest));
  put('README.md', readme);
  for (const [rel, text] of Object.entries(extra)) put(rel, text);
  return root;
}
const says = (problems, pattern) => assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got: ${problems.join(' | ')}`);

test('a tidy repository has no problems', (t) => { assert.deepEqual(checkPictures(repo(t)), []); });

test('rule 1: a picture with no entry, and an entry with no picture', (t) => {
  says(checkPictures(repo(t, { files: ['a.png', 'b.png'], readme: readmeFor(['a.png']) })), /b\.png has no entry/);
  says(checkPictures(repo(t, { files: ['a.png'], manifest: { 'a.png': entry(), 'gone.png': entry() } })), /lists gone\.png but .* is not there/);
  says(checkPictures(repo(t, { manifest: null })), /pictures\.json is missing/);
});

test('rule 2: a picture shown with no entry, an entry nothing shows, and a usedBy that is not true', (t) => {
  says(checkPictures(repo(t, { readme: readmeFor(['a.png', 'c.png']) })), /README\.md shows docs\/images\/c\.png, which has no entry/);
  says(checkPictures(repo(t, { readme: 'nothing here' })), /a\.png: (nothing shows this picture|usedBy lists README\.md, but README\.md does not refer)/);
  says(checkPictures(repo(t, { manifest: { 'a.png': entry({ usedBy: ['docs/help/x.md'] }) } })), /usedBy lists docs\/help\/x\.md, but .* does not refer/);
  says(checkPictures(repo(t, { extra: { 'docs/help/other.md': '![the same picture](../images/a.png)\n![x](docs/images/a.png)' } })), /docs\/help\/other\.md shows docs\/images\/a\.png, but .* does not list it in usedBy/);
});

test('rule 3: the alt where the picture is used must be the alt in the manifest, with entities read as text', (t) => {
  says(checkPictures(repo(t, { readme: readmeFor(['a.png'], 'Something else') })), /the alt in README\.md .* is not the alt in .*pictures\.json/);
  const quoted = 'A step, then "Still working" &amp; more';
  assert.deepEqual(checkPictures(repo(t, { manifest: { 'a.png': entry({ alt: 'A step, then "Still working" & more' }) }, readme: readmeFor(['a.png'], 'A step, then &quot;Still working&quot; &amp; more') })), []);
  void quoted;
  // a markdown image counts too
  assert.deepEqual(checkPictures(repo(t, { readme: '![Settings: a wait row](docs/images/a.png)' })), []);
  says(checkPictures(repo(t, { readme: '![Different](docs/images/a.png)' })), /is not the alt/);
});

test('the shape of an entry: scene, size, theme, scale, capture, tolerance (only above the default with a why, never above 1%), alt, usedBy', (t) => {
  const bad = (extra, pattern) => says(checkPictures(repo(t, { manifest: { 'a.png': entry(extra) } })), pattern);
  bad({ scene: '' }, /scene must be the name of a scene/);
  bad({ viewport: [10, 10] }, /viewport must be/);
  bad({ theme: 'sepia' }, /theme must be/);
  bad({ scale: 2 }, /scale must be 1/);
  bad({ capture: { locator: '' } }, /capture must be/);
  bad({ tolerance: 0.5 }, /tolerance must be above 0 and at most 0\.01/);
  bad({ tolerance: 0.005 }, /needs a "why"/);
  assert.deepEqual(checkPictures(repo(t, { manifest: { 'a.png': entry({ tolerance: 0.005, why: 'the caret blinks in this screen' }) } })), []);
  bad({ alt: '' }, /alt .* is missing/);
  bad({ usedBy: [] }, /usedBy must list/);
});

test('an exempt picture needs a reason and still has to be shown', (t) => {
  says(checkPictures(repo(t, { manifest: { 'a.png': { exempt: '' } } })), /needs a reason/);
  assert.deepEqual(checkPictures(repo(t, { manifest: { 'a.png': { exempt: 'hand-made art (Design); not a screen' } } })), []);
  says(checkPictures(repo(t, { manifest: { 'a.png': { exempt: 'hand-made art (Design); not a screen' } }, readme: 'no picture here' })), /nothing shows this picture/);
});

test('Design\'s drawings are not help pictures, and a picture a help page or the app shows counts', (t) => {
  assert.deepEqual(checkPictures(repo(t, { extra: { 'docs/design/review-v0114-x/shot.png': 'png', 'docs/design/review-v0114-x/index.html': '<img src="shot.png">' } })), []);
  says(checkPictures(repo(t, { extra: { 'src/ui/help.html': '<img src="/docs/images/new.png" alt="x">' } })), /src\/ui\/help\.html shows docs\/images\/new\.png, which has no entry/);
});

test('referencesIn reads <img>, <source srcset> and markdown, and takes alt only from an image tag', () => {
  const found = referencesIn('README.md', '<source srcset="docs/images/d.png"><img src="docs/images/l.png" alt="Light &amp; dark"> ![md](docs/images/m.png)');
  assert.deepEqual(found.map((f) => [f.name, f.alt]), [['d.png', null], ['l.png', 'Light & dark'], ['m.png', 'md']]);
});

test('this repository: the real manifest passes, from the command line, with a one-line summary', () => {
  const r = spawnSync(process.execPath, ['scripts/pictures-check.mjs'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /help pictures: \d+ listed, each shown and described the same way/);
});

test('the scene an entry names must be in e2e/pictures/scenes.mjs (checked once that file exists)', (t) => {
  const scenes = "export const scenes = {\n  'settings-wait': async (page) => {},\n  plain: async () => {},\n};\n";
  assert.deepEqual(checkPictures(repo(t, { extra: { 'e2e/pictures/scenes.mjs': scenes } })), []);
  says(checkPictures(repo(t, { manifest: { 'a.png': entry({ scene: 'nope' }) }, extra: { 'e2e/pictures/scenes.mjs': scenes } })), /the scene "nope" is not in e2e\/pictures\/scenes\.mjs/);
  assert.deepEqual(checkPictures(repo(t, { manifest: { 'a.png': entry({ scene: 'plain' }) }, extra: { 'e2e/pictures/scenes.mjs': scenes } })), []);
});
