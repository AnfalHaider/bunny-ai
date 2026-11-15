/**
 * QA scripted walk of the 0.1.4 screens, against an INVENTED profile only.
 *
 *   BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1 PORT=5391 node src/server/main.js
 *   BASE=http://127.0.0.1:5391 OUT=<temp>/shots node e2e/walk-0.1.4.mjs
 *
 * Not a Playwright spec (the gate's e2e suite does not pick it up). It prints PASS/FAIL per
 * check, saves a screenshot per screen/width/theme into OUT, and writes OUT/results.json.
 * It refuses to run unless the server says it is in test mode.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!BASE || !OUT) throw new Error('set BASE and OUT');
const health = await (await fetch(BASE + '/api/health')).json();
if (!health.fake) throw new Error('refusing to run: the server is not in fake-upstream (invented profile) mode');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = async (id, name, fn) => {
  try { const d = await fn(); results.push({ id, name, ok: true, d }); console.log('PASS', id, name, d ?? ''); }
  catch (e) { const m = String(e.message).split('\n')[0]; results.push({ id, name, ok: false, d: m }); console.log('FAIL', id, name, '::', m); }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const J = { 'content-type': 'application/json' };
const api = async (p) => (await fetch(BASE + p)).json();
const put = (o) => fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify(o) });

// A slow scripted model, added as a custom provider the way a person adds one, so the
// hopping bunny has time to show.
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const model = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    setTimeout(() => res.end(frame({ content: 'Hello from the scripted model.' }) + 'data: [DONE]\n\n'), 4000);
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const SIZES = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 800 } };
const ctxFor = async (size, theme) => {
  const c = await browser.newContext({ viewport: SIZES[size], colorScheme: theme, baseURL: BASE });
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') p.errs.push(m.text()); });
  return [c, p];
};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

await put({ modelFilter: 'all', theme: 'system' });
const added = await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) });
ok(added.ok, 'custom provider add failed');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAB6Aw0B2m0uXAAAAABJRU5ErkJggg==', 'base64');
writeFileSync(`${OUT}/photo.png`, PNG);

for (const size of ['desktop', 'phone']) for (const theme of ['light', 'dark']) {
  const tag = `${size}-${theme}`;
  const [c, p] = await ctxFor(size, theme);
  await p.goto('/');
  await p.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'chat'); });
  await p.goto('/');
  await p.waitForSelector('#greeting');

  if (tag === 'desktop-light') {
    await check('P1', 'Profile: open Settings from the shell', async () => {
      await p.locator('#account-button').click(); await p.locator('#account-menu [data-settings="profile"]').click(); await p.waitForTimeout(800);
      await p.frameLocator('#settings-frame').locator('#display-name').waitFor({ timeout: 5000 });
      await shot(p, `${tag}-settings-open`);
    });
    const fr = p.frameLocator('#settings-frame');
    await check('P2', 'Profile: full name + call-me name save and persist', async () => {
      await fr.locator('#display-name').fill('Test Person'); await fr.locator('#call-name').fill('Pip');
      await fr.locator('#call-name').blur(); await p.waitForTimeout(900);
      const s = await api('/api/settings');
      ok(JSON.stringify(s).includes('Test Person'), 'full name not saved'); ok(JSON.stringify(s).includes('Pip'), 'call name not saved');
      return JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => /name|photo/i.test(k))));
    });
    await check('P3', 'Profile: photo upload, Remove appears, /api/profile/photo serves it', async () => {
      await fr.locator('#photo-file').setInputFiles(`${OUT}/photo.png`); await p.waitForTimeout(1000);
      eq((await fetch(BASE + '/api/profile/photo')).status, 200, 'photo GET');
      await fr.locator('#photo-remove').waitFor({ state: 'visible', timeout: 3000 });
      await shot(p, `${tag}-profile-photo`);
    });
    await check('P4', 'Profile: wrong file type shows an error', async () => {
      await fr.locator('#photo-file').setInputFiles({ name: 'bad.png', mimeType: 'text/plain', buffer: Buffer.from('nope') }); await p.waitForTimeout(800);
      const t = await fr.locator('#photo-error').textContent(); ok(t.trim().length > 0, 'no error message shown'); return t.trim();
    });
    await check('P5', 'Profile: remove photo', async () => {
      await fr.locator('#photo-remove').click(); await p.waitForTimeout(800);
      eq((await fetch(BASE + '/api/profile/photo')).status, 404, 'photo after remove');
    });
    await check('P6', 'Profile: full name appears in the shell', async () => {
      await p.reload(); await p.waitForSelector('#greeting'); ok((await p.locator('body').innerText()).includes('Test Person'), 'full name not on page');
    });
  }

  for (const sec of ['profile', 'appearance', 'bunny', 'code']) {
    await p.goto(`/src/ui/settings.html?embed=1&section=${sec}`); await p.waitForTimeout(700);
    await check(`S-${sec}-${tag}`, `Settings ${sec}: renders, no overflow, no console errors (${tag})`, async () => {
      const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(o <= 1, `horizontal overflow ${o}px`); ok(p.errs.length === 0, 'console errors: ' + p.errs.join(' | ')); await shot(p, `${tag}-settings-${sec}`);
    });
  }

  if (tag === 'desktop-light') {
    await p.goto('/src/ui/settings.html?embed=1&section=appearance'); await p.waitForTimeout(500);
    for (const key of ['interfaceFont', 'responseFont', 'transcriptSize', 'transcriptWidth', 'motion', 'codeThemeLight', 'codeThemeDark', 'codeFontSize']) {
      await check(`A-${key}`, `Appearance ${key}: each option saves; last persists after reload`, async () => {
        const sel = p.locator(`select[data-key="${key}"]`); const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value));
        ok(opts.length >= 2, 'fewer than 2 options');
        for (const v of opts) { await sel.selectOption(v); await p.waitForTimeout(250); const s = await api('/api/settings'); eq(String(s[key]), v, `saved ${key}`); }
        await p.reload(); await p.waitForTimeout(500); eq(await p.locator(`select[data-key="${key}"]`).inputValue(), opts.at(-1), 'after reload');
        return opts.join(',');
      });
    }
    await check('A-codefont', 'Appearance code font input saves', async () => { const i = p.locator('input[data-key="codeFont"]'); await i.fill('Consolas'); await i.blur(); await p.waitForTimeout(500); eq((await api('/api/settings')).codeFont, 'Consolas', 'codeFont'); });
    await check('A-preview', 'Code theme previews render', async () => { ok((await p.locator('#code-preview-light').innerText()).length > 0, 'light preview empty'); ok((await p.locator('#code-preview-dark').innerText()).length > 0, 'dark preview empty'); });
    await check('A-theme', 'Theme select light/dark changes the page', async () => {
      const sel = p.locator('#theme'); const out = {};
      for (const v of ['light', 'dark']) { await sel.selectOption(v); await p.waitForTimeout(300); out[v] = await p.evaluate(() => getComputedStyle(document.body).backgroundColor); }
      ok(out.light !== out.dark, 'same bg ' + JSON.stringify(out)); await sel.selectOption('system'); return JSON.stringify(out);
    });
    await put({ interfaceFont: null, responseFont: null, transcriptSize: null, transcriptWidth: null, motion: null, codeFont: null, codeFontSize: null, codeThemeLight: null, codeThemeDark: null });

    await p.goto('/src/ui/settings.html?embed=1&section=bunny'); await p.waitForTimeout(500);
    await check('B1', 'Instructions save, count updates, persist after reload', async () => {
      await p.locator('#instructions').fill('Answer briefly. I like carrots.'); await p.waitForTimeout(1500);
      const count = await p.locator('#instructions-count').textContent(); ok(count.startsWith('31'), 'count ' + count);
      const saved = await p.locator('#instructions-saved').textContent();
      await p.reload(); await p.waitForTimeout(600); eq(await p.locator('#instructions').inputValue(), 'Answer briefly. I like carrots.', 'after reload'); return `count="${count}" saved label="${saved}"`;
    });
    await check('B2', 'Memory toggles flip and persist', async () => {
      const out = {};
      for (const k of ['memoryEnabled', 'searchChats', 'autoMemory', 'memorySensitive']) { const cb = p.locator(`input.pref[data-key="${k}"]`); const before = await cb.isChecked(); await cb.evaluate((e) => e.click()); await p.waitForTimeout(400); const s = await api('/api/settings'); eq(!!s[k], !before, k); out[k] = !before; }
      await p.reload(); await p.waitForTimeout(500);
      for (const [k, v] of Object.entries(out)) eq(await p.locator(`input.pref[data-key="${k}"]`).isChecked(), v, 'after reload ' + k);
      return JSON.stringify(out);
    });
    await check('B3', 'Import: empty answer handled; real answer adds memories', async () => {
      await p.locator('#start-import').click(); await p.locator('#memory-import').waitFor({ state: 'visible' });
      await p.locator('#run-memory-import').click(); await p.waitForTimeout(500); const empty = await p.locator('#import-result').textContent();
      await p.locator('#import-answer').fill('- Prefers short answers\n- Works in TypeScript\n- Deploys to Vercel'); await p.locator('#run-memory-import').click(); await p.waitForTimeout(1200);
      const res = await p.locator('#import-result').textContent(); const mem = await api('/api/memory'); ok(mem.length >= 1, 'no memories added'); await shot(p, 'desktop-light-memory-import');
      return `empty:"${empty.trim()}" result:"${res.trim()}" memories:${mem.length}`;
    });
    await check('B4', 'Manage memory opens', async () => { await p.locator('#manage-memory').click(); await p.waitForTimeout(600); await shot(p, 'desktop-light-memory-manage'); });

    await p.goto('/src/ui/settings.html?embed=1&section=code'); await p.waitForTimeout(500);
    await check('C1', 'Code: permission mode + effort persist', async () => {
      for (const id of ['default-permission', 'default-effort']) { const sel = p.locator('#' + id); const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value)); await sel.selectOption(opts.at(-1)); await p.waitForTimeout(400); }
      await p.reload(); await p.waitForTimeout(500);
      const a = await p.locator('#default-permission').inputValue(), b = await p.locator('#default-effort').inputValue(); eq(a, 'auto', 'permission'); eq(b, 'max', 'effort'); return `${a}/${b}`;
    });
    await check('C2', 'Code: branch prefix, view, unrelated-task, toggles persist', async () => {
      await p.locator('input.pref[data-key="branchPrefix"]').fill('qa-test'); await p.locator('input.pref[data-key="branchPrefix"]').blur();
      await p.locator('select.pref[data-key="transcriptView"]').selectOption('verbose'); await p.locator('select.pref[data-key="unrelatedTask"]').selectOption('new');
      const out = {};
      for (const k of ['statusLabels', 'helpersEnabled', 'promptSuggestions', 'summaryNextSteps']) { const cb = p.locator(`input.pref[data-key="${k}"]`); const b = await cb.isChecked(); await cb.evaluate((e) => e.click()); out[k] = !b; }
      await p.waitForTimeout(700); await p.reload(); await p.waitForTimeout(500);
      eq(await p.locator('input.pref[data-key="branchPrefix"]').inputValue(), 'qa-test', 'prefix'); eq(await p.locator('select.pref[data-key="transcriptView"]').inputValue(), 'verbose', 'view'); eq(await p.locator('select.pref[data-key="unrelatedTask"]').inputValue(), 'new', 'unrelated');
      for (const [k, v] of Object.entries(out)) eq(await p.locator(`input.pref[data-key="${k}"]`).isChecked(), v, k);
    });
    await check('C3', 'Code: "Open Appearance" button does not crash', async () => { await p.locator('#open-appearance').click(); await p.waitForTimeout(500); });
    await check('C4', 'Code defaults reach a new chat (permission shows Auto)', async () => {
      await p.goto('/'); await p.waitForSelector('#greeting'); await p.waitForTimeout(500);
      const txt = await p.evaluate(() => document.body.innerText); await shot(p, 'desktop-light-newchat-code-defaults'); ok(/\bAuto\b/.test(txt), 'Auto not visible in the new chat');
    });
    await put({ instructions: '', defaultPermission: null, defaultEffort: null, transcriptView: null, unrelatedTask: null, branchPrefix: null });
  }

  await p.goto('/'); await p.waitForSelector('#greeting');
  await check(`Z-${tag}`, `Account-menu zoom row: in, out, reset (${tag})`, async () => {
    if (size === 'phone') { await p.locator('#sidebar-toggle').click(); await p.waitForTimeout(400); }
    const openers = ['#account-button', '#account-btn', '#user-button', '#profile-button', '#sidebar-account', '.account-trigger'];
    let opened = false;
    for (const sel of openers) { const l = p.locator(sel).first(); if (await l.count()) { await l.click(); opened = true; break; } }
    if (!opened) {
      const cands = await p.evaluate(() => [...document.querySelectorAll('[aria-controls],[aria-haspopup]')].map((e) => e.id || e.className).join(','));
      throw new Error('no account-menu opener found; candidates: ' + cands);
    }
    await p.waitForTimeout(300); ok(await p.locator('.zoom-row').isVisible(), 'zoom row not visible');
    await p.locator('#zoom-in').click(); eq(await p.locator('#zoom-reset').textContent(), '110%', 'in'); await shot(p, `${tag}-zoom-110`);
    await p.locator('#zoom-out').click(); await p.locator('#zoom-out').click(); eq(await p.locator('#zoom-reset').textContent(), '90%', 'out');
    await p.locator('#zoom-reset').click(); eq(await p.locator('#zoom-reset').textContent(), '100%', 'reset');
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(o <= 1, 'overflow ' + o);
  });
  await p.keyboard.press('Escape');
  await p.goto('/'); await p.waitForSelector('#greeting');
  await check(`G-${tag}`, `Greeting uses the call-me name (${tag})`, async () => { const g = ((await p.locator('#greeting').getAttribute('aria-label')) ?? await p.locator('#greeting').textContent()).trim(); ok(g.includes('Pip'), g); await shot(p, `${tag}-greeting`); return g; });

  await p.locator('#picker-button').click(); await p.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  await check(`H-${tag}`, `Hopping bunny during a reply: word + timer, gone after (${tag})`, async () => {
    await p.locator('#input').fill('say hello'); await p.locator('#send').click();
    await p.locator('.bunny-working').waitFor({ timeout: 6000 }); await p.waitForTimeout(1500);
    const word = await p.locator('.bunny-working .bunny-word').textContent(); const time = await p.locator('.bunny-working .bunny-time').textContent().catch(() => '(no timer)');
    await shot(p, `${tag}-hopping-bunny`);
    await p.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }); await p.waitForTimeout(500);
    eq(await p.locator('.bunny-working').count(), 0, 'bunny still showing after reply');
    ok((await p.locator('.msg.assistant .body').last().textContent()).includes('scripted model'), 'reply missing');
    await shot(p, `${tag}-after-reply`); return `word="${word}" time="${time}"`;
  });
  await check(`E-${tag}`, `No console errors on the shell (${tag})`, async () => { ok(p.errs.length === 0, p.errs.join(' | ')); });
  await c.close();
}
await browser.close(); model.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.ok).length} PASS / ${results.filter((r) => !r.ok).length} FAIL`);
