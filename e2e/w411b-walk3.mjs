/**
 * QA, W4-11 first batch at 4b2a311, walk 3: S-2 (skill descriptions from folded front matter), P-1 (plugin layouts), P-3 (connectors in
 * .mcp.json), and RO-1 on screen (the "Trust read-only labels" button in Customize, desktop and phone, light and dark).
 * Invented profile only: the GitHub reads are an invented in-memory tree (no network); the page runs against an invented-data server.
 *   node e2e/w411b-walk3.mjs      (screenshots to $SHOTS or the temp folder)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { readGithubPlugin, frontmatter, firstSentence } = await imp('src/server/pluginImport.js');
const { createAppTools } = await imp('src/server/appTools.js');
const { startApp } = await imp('test/helpers.js');
const { startHttpMcp } = await imp('e2e/w411b-http.mjs');
const SHOTS = process.env.SHOTS || join(mkdtempSync(join(tmpdir(), 'bunny-w411b3-')), 'shots'); mkdirSync(SHOTS, { recursive: true });
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 250) : ''}`); };

function fakeGithub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files[m[1]] !== undefined) return new Response(files[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}
const load = (files, name = 'repo') => readGithubPlugin(`https://github.com/o/${name}`, { fetchImpl: fakeGithub(files) });
const sk = (name, front, body = 'Do the thing.') => `---\nname: ${name}\n${front}\n---\n${body}`;

// =============== S-2: descriptions ===============
{
  const cases = [
    ['folded block (>)', 'description: >\n  First part of the description\n  and the second part.', 'First part of the description and the second part.'],
    ['folded block with a strip mark (>-)', 'description: >-\n  Keep it\n  short.', 'Keep it short.'],
    ['literal block (|)', 'description: |\n  Line one\n  Line two', 'Line one\nLine two'],
    ['plain value that goes on over indented lines', 'description: Starts here\n  and goes on here', 'Starts here and goes on here'],
    ['value on the next lines (empty after the colon)', 'description:\n  Written on the next line', 'Written on the next line'],
    ['one line (as before)', 'description: Just one line', 'Just one line'],
    ['quoted', 'description: "A quoted description"', 'A quoted description'],
    ['single-quoted with a colon inside', "description: 'Use when: the person asks'", 'Use when: the person asks'],
    ['Windows line ends', 'description: >\r\n  Folded with\r\n  CRLF ends', 'Folded with CRLF ends'],
    ['another key after a block', 'description: >\n  Block text\nlicense: MIT', 'Block text'],
  ];
  for (const [label, front, want] of cases) {
    const fm = frontmatter(`---\nname: x\n${front}\n---\nBody`);
    check(`S2 ${label}`, `front matter with a ${label} gives the description "${want.replace(/\n/g, '\\n')}"`, (fm.data?.description ?? fm.description) === want || fm?.data?.description === want, JSON.stringify(fm).slice(0, 160));
  }
  const files = { 'skills/a/SKILL.md': sk('a', 'description: >\n  Use when the person wants a weekly report\n  built from the issue list.'), 'skills/b/SKILL.md': sk('b', '', '# Title\n\nUse this to tidy a folder. It moves files.\n\n```\ncode here\n```\n'), 'skills/c/SKILL.md': sk('c', 'description:', '# Only a heading\n'), 'skills/d/SKILL.md': sk('d', 'description: ok', 'x') };
  const p = await load(files);
  const by = Object.fromEntries(p.skills.map((s) => [s.name, s.description]));
  check('S2 import folded', 'an imported skill with a folded description keeps it whole (so the model can tell when to use it)', by.a === 'Use when the person wants a weekly report built from the issue list.', by.a);
  check('S2 import none', 'an imported skill with NO description is described by the first sentence of its text that is not a heading', by.b === 'Use this to tidy a folder. It moves files.', JSON.stringify(by.b));
  check('S2 import empty', 'one with no description and only a heading has an empty description (no crash)', by.c === '' || by.c === undefined, JSON.stringify(by.c));
  check('S2 cut', 'a very long folded description is cut to 200 characters', (await load({ 'skills/z/SKILL.md': sk('z', `description: >\n  ${'word '.repeat(80)}`) })).skills[0].description.length <= 200);
  check('S2 firstSentence', 'firstSentence skips headings, tables, quotes, fences and blank lines, and strips markdown marks', firstSentence('# H\n\n> quote\n| a | b |\n```\nx\n```\n**Bold** and `code` text.') === 'Bold and code text.', firstSentence('# H\n\n> quote\n| a | b |\n```\nx\n```\n**Bold** and `code` text.'));
}

// =============== P-1: plugin layouts ===============
{
  const one = (path) => ({ [path]: sk('s', 'description: d') });
  for (const [label, path] of [['skills/<name>/SKILL.md', 'skills/s/SKILL.md'], ['a nested plugin plugins/<p>/skills/<s>/SKILL.md', 'plugins/alpha/skills/s/SKILL.md'], ['.claude/skills/<s>/SKILL.md', '.claude/skills/s/SKILL.md'], ['a root SKILL.md', 'SKILL.md'], ['<name>/SKILL.md (two segments)', 's/SKILL.md']]) {
    const p = await load(one(path)).catch((e) => ({ error: e.message, skills: [] }));
    check(`P1 ${label}`, `${label} is found`, p.skills.length === 1, p.error ?? p.skills.map((s) => s.name).join());
  }
  const multi = await load({ ...one('plugins/alpha/skills/one/SKILL.md'), 'plugins/beta/skills/two/SKILL.md': sk('two', 'description: d'), '.claude/skills/three/SKILL.md': sk('three', 'description: d') });
  check('P1 several plugins', 'a repository with several plugins and a .claude folder gives all their skills', multi.skills.map((s) => s.name).sort().join() === 's,three,two', multi.skills.map((s) => s.name).join());
  const rej = await load({ 'docs/examples/deep/more/SKILL.md': sk('x', 'description: y') }).then(() => 'imported', (e) => e.message);
  check('P1 deep example', 'a SKILL.md deep inside docs that is not under a skills folder is not taken ("no skills")', /no skills/i.test(rej), rej.slice(0, 80));
  const noisy = await load({ 'skills/real/SKILL.md': sk('real', 'description: the real one'), 'node_modules/pkg/skills/vendored/SKILL.md': sk('vendored', 'description: from a dependency'), 'test/fixtures/skills/sample/SKILL.md': sk('sample', 'description: a test fixture'), 'examples/skills/demo/SKILL.md': sk('demo', 'description: a demo') });
  console.log(`INFO  a repository that also holds skills inside node_modules, test fixtures and examples imports: ${noisy.skills.map((s) => s.name).sort().join(', ')}`);
  check('P1 noise', 'skills inside node_modules and test fixtures are not imported with the real one (only skills/real)', noisy.skills.length === 1 && noisy.skills[0].name === 'real', noisy.skills.map((s) => s.name).join());
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`skills/s${i}/SKILL.md`, sk(`s${i}`, 'description: d')]));
  const capped = await load(many).catch((e) => ({ error: e.message, skills: [], skipped: [] }));
  console.log(`INFO  a repository with 80 skills imports ${capped.skills.length} (${capped.skipped?.slice(-1)[0] ?? capped.error ?? 'no note'})`);
  check('P1 many', 'a repository with 80 skills does not hang or crash (bounded)', capped.skills.length > 0 && capped.skills.length <= 80, `${capped.skills.length}`);
}

// =============== P-3: connectors in .mcp.json ===============
{
  const mcp = (servers) => JSON.stringify({ mcpServers: servers });
  const base = { 'skills/a/SKILL.md': sk('a', 'description: d') };
  const mixed = await load({ ...base, '.mcp.json': mcp({ plain: { url: 'https://plain.example.com/mcp' }, legacy: { type: 'sse', url: 'https://legacy.example.com/sse' }, Upper: { type: 'SSE', url: 'https://upper.example.com/sse' }, keyed: { url: 'https://keyed.example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } }, envd: { url: 'https://envd.example.com/mcp', env: { KEY: 'x' } }, http: { type: 'http', url: 'https://http.example.com/mcp' }, emptyHeaders: { url: 'https://eh.example.com/mcp', headers: {} } }) });
  const byName = Object.fromEntries(mixed.connectors.map((c) => [c.name, c]));
  check('P3a', 'a plain connector (and one that says type http, and one with empty headers) is added ON', byName.plain?.enabled !== false && byName.http?.enabled !== false && byName.emptyHeaders?.enabled !== false, JSON.stringify(mixed.connectors.map((c) => [c.name, c.enabled])));
  check('P3b', 'legacy SSE servers (type sse, any capitals) are NOT added and are listed as skipped with the reason', !byName.legacy && !byName.Upper && mixed.skipped.filter((x) => /older SSE server/.test(x)).length === 2, mixed.skipped.join(' | ').slice(0, 200));
  check('P3c', 'a connector with headers or env is added SWITCHED OFF and said to need a key or sign-in', byName.keyed?.enabled === false && byName.envd?.enabled === false && mixed.skipped.filter((x) => /needs a key or sign-in/.test(x)).length === 2, `${JSON.stringify(mixed.connectors.map((c) => [c.name, c.enabled]))}`);
  check('P3d', 'no header value or env value is copied into the connector record (no token in what is saved)', !JSON.stringify(mixed.connectors).includes('TOKEN') && !JSON.stringify(mixed.connectors).includes('Bearer'), JSON.stringify(mixed.connectors).slice(0, 200));
  const odd = await load({ ...base, '.mcp.json': mcp({ local: { command: 'npx', args: ['-y', 'server'] }, ftp: { url: 'ftp://x.example.com/mcp' }, nourl: {}, javascript: { url: 'javascript:alert(1)' }, ok: { url: 'https://ok.example.com/mcp' } }) });
  check('P3e', 'entries without an https address (a command, ftp, nothing, a javascript: address) are not added; the good one is', odd.connectors.length === 1 && odd.connectors[0].name === 'ok', JSON.stringify(odd.connectors));
  console.log(`INFO  a command-based (local) entry in .mcp.json is ${odd.skipped.some((x) => /local|command|npx/i.test(x)) ? 'listed as skipped with a reason' : 'dropped without a word in the skipped list'}`);
  for (const [label, body] of [['broken JSON', '{ not json'], ['an array', '[1,2]'], ['no mcpServers key', '{"other":1}'], ['null servers', '{"mcpServers":null}']]) {
    const p = await load({ ...base, '.mcp.json': body }).catch((e) => ({ error: e.message }));
    check(`P3f ${label}`, `a .mcp.json that is ${label} does not break the plugin: its skill still imports and no connector is added`, !p.error && p.skills.length === 1 && p.connectors.length === 0, p.error ?? `${p.skills.length} skills, ${p.connectors.length} connectors`);
  }
  // installing keeps the off state and still refuses a second install
  const added = []; let settings = {};
  const tools = createAppTools({ skills: { add: async (s) => ({ id: `sk-${s.name}`, ...s }), remove: async () => {} }, mcp: { add: async (c) => { added.push(c); return { id: `c-${c.name}`, ...c }; }, remove: async () => {} }, getSettings: () => settings, saveSettings: async (patch) => { settings = { ...settings, ...patch }; }, fetchImpl: fakeGithub({ ...base, '.mcp.json': mcp({ plain: { url: 'https://plain.example.com/mcp' }, keyed: { url: 'https://keyed.example.com/mcp', headers: { A: 'b' } } }) }) });
  const inst = await tools.installFromGithub('https://github.com/o/mixed');
  check('P3g', 'installing adds the plain connector ON and the keyed one OFF, and the install result says what was skipped or switched off', added.map((c) => `${c.name}:${c.enabled}`).join() === 'plain:true,keyed:false' && Array.isArray(inst.plugin.skipped), added.map((c) => `${c.name}:${c.enabled}`).join());
  const again = await tools.installFromGithub('https://github.com/o/mixed').then(() => 'installed again', (e) => e.message);
  check('P3h', 'installing the same repository again is refused (already installed)', /already installed/.test(again), again.slice(0, 80));
}

// =============== RO-1 on screen: the Trust read-only labels button ===============
{
  const { base } = await startApp(t, { fake: false });
  const s = await startHttpMcp({ tools: ['look'] }); cleanups.push(async () => s.close());
  const c = await (await fetch(`${base}/api/mcp`, { method: 'POST', headers: j, body: JSON.stringify({ name: 'Pet Notes', url: s.url, enabled: true }) })).json();
  const loc = await (await fetch(`${base}/api/mcp`, { method: 'POST', headers: j, body: JSON.stringify({ name: 'Local Tool', command: 'node', args: ['-e', '0'], confirmLocal: true }) })).json();
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const browser = await chromium.launch();
  for (const [sz, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]]) for (const theme of ['light', 'dark']) {
    const tag = `${sz}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await fetch(`${base}/api/mcp/${c.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ trustReadOnly: false }) });
    await page.goto(base + '/src/ui/customize.html?embed=1'); await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    await page.locator('.cz-tab[data-kind="connectors"]').click().catch(() => {});
    const row = page.locator('tr, .cz-row, [data-id]').filter({ hasText: 'Pet Notes' }).first();
    await row.waitFor({ timeout: 10000 });
    const btn = row.getByRole('button', { name: 'Trust read-only labels' });
    check(`UI1 ${tag}`, 'a remote connector row has a "Trust read-only labels" button (not trusted yet)', (await btn.count()) === 1, `${await row.getByRole('button').allTextContents()}`);
    if (tag === 'desktop/light') { // c5082f5: a connector that has not listed its tools cannot be trusted, and the refusal is shown in words
      await btn.click(); await page.waitForTimeout(800); const txt = await page.locator('body').innerText(); const notTrusted = !(await (await fetch(`${base}/api/mcp`)).json()).find((x) => x.id === c.id).trustReadOnly;
      check('UI0', 'before the connector has listed its tools, "Trust read-only labels" is refused in words on the page and nothing is trusted', notTrusted && /Check the connector first/i.test(txt), txt.replace(/\s+/g, ' ').slice(txt.search(/Pet Notes/), txt.search(/Pet Notes/) + 260));
      await page.screenshot({ path: join(SHOTS, 'trust-refused.png') });
    }
    await fetch(`${base}/api/mcp/${c.id}/tools`).then((r) => r.json()); await page.reload(); await page.locator('.cz-tab[data-kind="connectors"]').click().catch(() => {}); await page.waitForTimeout(700);
    await btn.click(); await page.waitForTimeout(900);
    const trusted = page.locator('tr, .cz-row, [data-id]').filter({ hasText: 'Pet Notes' }).first().getByRole('button', { name: 'Read-only labels trusted' });
    const saved = (await (await fetch(`${base}/api/mcp`)).json()).find((x) => x.id === c.id).trustReadOnly;
    check(`UI2 ${tag}`, 'clicking it changes the button to "Read-only labels trusted" and the connector is saved as trusted', (await trusted.count()) === 1 && saved === true, `button count ${await trusted.count()}, saved ${saved}`);
    await page.reload(); await page.locator('.cz-tab[data-kind="connectors"]').click().catch(() => {}); await page.waitForTimeout(800);
    check(`UI3 ${tag}`, 'after a reload it still says "Read-only labels trusted"', (await page.getByRole('button', { name: 'Read-only labels trusted' }).count()) === 1);
    const cr = await page.evaluate(() => {
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const b = [...document.querySelectorAll('button')].find((x) => /Read-only labels trusted/.test(x.textContent)); if (!b) return null;
      let bg = [255, 255, 255]; for (let e = b; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) { bg = parse(c); break; } }
      const r = b.getBoundingClientRect(); return { fg: parse(getComputedStyle(b).color), bg, right: Math.round(r.right), vw: innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1, h: Math.round(r.height) };
    });
    check(`UI4 ${tag}`, 'the button text is readable (4.5:1), inside the window, no sideways scroll', cr && ratio(cr.fg, cr.bg) >= 4.5 && cr.right <= cr.vw && !cr.over, JSON.stringify({ ratio: cr ? +ratio(cr.fg, cr.bg).toFixed(2) : null, right: cr?.right, vw: cr?.vw, over: cr?.over }));
    await page.screenshot({ path: join(SHOTS, `trust-${sz}-${theme}.png`) });
    await page.getByRole('button', { name: 'Read-only labels trusted' }).click(); await page.waitForTimeout(800);
    check(`UI5 ${tag}`, 'clicking it again takes the trust back ("Trust read-only labels" returns, saved as not trusted)', (await page.getByRole('button', { name: 'Trust read-only labels' }).count()) >= 1 && (await (await fetch(`${base}/api/mcp`)).json()).find((x) => x.id === c.id).trustReadOnly === false);
    const localRow = page.locator('tr, .cz-row, [data-id]').filter({ hasText: 'Local Tool' }).first();
    if (!(sz === 'desktop' && theme === 'light')) { check(`UI7 ${tag}`, 'no page error', errors.length === 0, errors.join('|')); await ctx.close(); continue; }
    console.log(`INFO  the LOCAL connector row has a trust button: ${(await localRow.getByRole('button', { name: /read-only labels/i }).count()) > 0 ? 'yes' : 'no (a local connector cannot be trusted from the screen; only through the API)'}`);
    check(`UI7 ${tag}`, 'no page error', errors.length === 0, errors.join('|'));
    await ctx.close();
  }
  await browser.close();
  void loc;
}

for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
