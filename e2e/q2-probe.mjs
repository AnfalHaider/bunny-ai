import { createServer } from 'node:http';
import { chromium } from 'playwright';
const B = process.env.BASE;
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 150))); p.on('crash', () => console.log('CRASH event'));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 150)); });
p.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().replace(B, '')); });
const say = async (t) => { await p.locator('#input').fill(t); await p.locator('#send').click(); await p.locator('#stop').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}); await p.locator('#stop').waitFor({ state: 'hidden', timeout: 20000 }); await p.waitForTimeout(400); };
await p.goto(B + '/'); await p.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); }); await p.goto(B + '/'); await p.waitForSelector('#greeting');
await p.locator('#picker-button').click(); await p.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
const step = process.env.STEP;
if (step === 'incognito') {
  await p.locator('#incognito').click(); await p.locator('#input').fill('secret words'); await p.locator('#send').click(); await p.waitForTimeout(4000);
  console.log('messages:', JSON.stringify(await p.locator('#messages').innerText())); console.log('error:', await p.locator('#error').innerText());
}
if (step === 'import') {
  await p.locator('#import').click(); await p.locator('#import-text').fill('## You\nhi there\n\n## Assistant\nhello back'); await p.locator('#import-run').click(); await p.waitForTimeout(1500);
  console.log('modal visible:', await p.locator('#import-text').isVisible(), 'err text:', JSON.stringify(await p.locator('#import-run').evaluate((e) => e.closest('.modal, dialog, #import-dialog, section')?.innerText.replace(/\s+/g, ' ').slice(0, 300))));
  console.log('sessions:', (await (await fetch(B + '/api/sessions')).json()).length);
}
if (step === 'palette') {
  await p.keyboard.press('Control+k'); await p.waitForTimeout(400); console.log('input visible', await p.locator('#palette-input').isVisible());
  console.log(await p.evaluate(() => document.querySelector('#palette-input')?.closest('[role=dialog], .palette, .modal-backdrop, div')?.outerHTML.slice(0, 700)));
}
if (step === 'stop') {
  await p.locator('#input').fill('slow please'); await p.locator('#send').click(); await p.waitForTimeout(1500);
  console.log('stop visible:', await p.locator('#stop').isVisible(), 'enabled:', await p.locator('#stop').isEnabled(), 'html:', await p.locator('#stop').evaluate((e) => e.outerHTML.slice(0, 200)));
}
if (step === 'layout') {
  await p.locator('.toolbar [data-view="tasks"]').click(); await p.waitForTimeout(300);
  console.log(await p.evaluate(() => [...document.querySelectorAll('[aria-label="Panel layout"]')].map((e) => [e.id, e.closest('section')?.id, !!e.offsetParent].join(':')).join(' ')));
  console.log(await p.evaluate(() => document.querySelector('#pane-layout-menu')?.outerHTML.slice(0, 600)));
}
if (step === 'actions') {
  await say('hello actions'); const last = p.locator('.msg.assistant').last(); await last.hover();
  console.log('assistant actions:', JSON.stringify(await last.locator('button').allInnerTexts()));
  const u = p.locator('.msg.user').last(); await u.hover(); console.log('user actions:', JSON.stringify(await u.locator('button').allInnerTexts()));
  for (const name of ['Copy', 'Retry', 'Save as artifact', 'Read aloud', 'Branch']) {
    console.log('click', name); try { await p.locator('.msg.assistant').last().hover(); await p.locator('.msg.assistant').last().locator('button', { hasText: name }).first().click({ timeout: 4000 }); await p.waitForTimeout(1500); } catch (e) { console.log('  ->', String(e).split('\n')[0]); }
  }
}
if (step === 'import2') {
  await p.locator('#import').click(); await p.locator('#import-run').click(); await p.waitForTimeout(600);
  console.log('after empty run: modal text:', JSON.stringify((await p.locator('#import-run').evaluate((e) => e.closest('.modal')?.innerText.replace(/\s+/g, ' ').slice(0, 260)))));
  await p.locator('#import-text').fill('## You\nhi there\n\n## Assistant\nhello back'); const before = (await (await fetch(B + '/api/sessions')).json()).length;
  p.on('request', (r) => { if (r.url().includes('/api/import')) console.log('REQ body:', (r.postData() || '').slice(0, 160)); });
  await p.locator('#import-run').click(); await p.waitForTimeout(1500);
  console.log('modal visible:', await p.locator('#import-text').isVisible(), 'sessions before/after:', before, (await (await fetch(B + '/api/sessions')).json()).length);
}
if (step === 'settingswin') {
  await p.locator('#settings-open').click(); await p.waitForTimeout(800);
  const rows = await p.locator('#settings-nav-list button.nav-row').evaluateAll((e) => e.map((x) => x.dataset.section + ':' + (x.offsetParent ? 'v' : 'h')));
  console.log('nav rows:', rows.join(' '));
  for (const r of rows.map((x) => x.split(':')[0])) {
    const t = Date.now();
    try { await p.locator('#settings-nav-list button.nav-row[data-section="' + r + '"]').click({ timeout: 4000 }); await p.waitForTimeout(500); const src = await p.locator('#settings-frame').getAttribute('src'); const len = (await p.frameLocator('#settings-frame').locator('body').innerText().catch(() => '')).trim().length; console.log(r, '->', src, 'text', len, (Date.now() - t) + 'ms'); }
    catch (e) { console.log(r, 'FAILED', String(e).slice(0, 120)); }
  }
}
if (step === 'layout2') {
  await p.locator('.toolbar [data-view="tasks"]').click(); await p.waitForTimeout(400);
  console.log(await p.evaluate(() => [...document.querySelectorAll('button[aria-label="Panel layout"]')].map((e) => { const r = e.getBoundingClientRect(); return (e.closest('section')?.id ?? '?') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' vis=' + !!e.offsetParent; }).join(' | ')));
  const rail = await p.locator('#side-pane .pane-head, #side-pane .tabs').first().innerHTML().catch(() => ''); console.log('head html:', rail.slice(0, 400));
}
if (step === 'palette2') {
  await p.keyboard.press('Control+k'); await p.locator('#palette-input').waitFor({ state: 'visible' });
  await p.locator('#palette-input').fill('incog'); await p.waitForTimeout(300);
  console.log('items after filter:', JSON.stringify(await p.locator('.palette-item').allInnerTexts()), 'selected:', await p.locator('.palette-item.is-selected, .palette-item[aria-selected=true]').count());
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  console.log('after Enter: palette open', await p.locator('#palette-input').isVisible(), 'incognito badge', await p.locator('#mode').isVisible());
  if (await p.locator('#palette-input').isVisible()) { await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(500); console.log('after ArrowDown+Enter: palette open', await p.locator('#palette-input').isVisible(), 'incognito badge', await p.locator('#mode').isVisible()); }
}
if (step === 'layout3') {
  await p.locator('.toolbar [data-view="tasks"]').click(); await p.waitForTimeout(400);
  const lay = p.locator('#side-pane button[aria-label="Panel layout"]'); console.log('count', await lay.count());
  await lay.first().click({ timeout: 5000 }); await p.waitForTimeout(400);
  console.log('menu hidden attr:', await p.locator('#pane-layout-menu').getAttribute('hidden'), 'menu box', JSON.stringify(await p.locator('#pane-layout-menu').boundingBox()));
  await p.screenshot({ path: process.env.OUT + '/layout3.png' });
  for (const l of ['Dock left', 'Dock bottom', 'Dock right', 'Fill the chat area']) {
    try { await p.locator('#pane-layout-menu [aria-label="' + l + '"]').click({ timeout: 3000 }); await p.waitForTimeout(300); console.log(l, 'ok; app classes:', await p.evaluate(() => document.querySelector('.app')?.className)); }
    catch (e) { console.log(l, 'FAILED', String(e).slice(0, 160)); }
    await p.locator('#side-pane button[aria-label="Panel layout"]').first().click({ timeout: 3000 }).catch(() => console.log('  reopen menu failed'));
  }
}
if (step === 'modeclobber') {
  const os = await import('node:os'); const fs = await import('node:fs'); const path = await import('node:path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bunny-q2-mc-'));
  await p.locator('#mode-code').click(); await p.waitForTimeout(400); if (!(await p.getByRole('dialog', { name: 'Choose a folder' }).count())) await p.locator('#folder-chip').click();
  await p.locator('input[aria-label="Folder path"]').fill(d); await p.getByRole('button', { name: 'Use folder' }).click(); await p.waitForTimeout(400);
  await p.locator('#mode-button').click(); await p.locator('#mode-menu button', { hasText: 'Plan' }).first().click(); await p.waitForTimeout(300);
  console.log('after choosing Plan, label:', (await p.locator('#mode-button').innerText()).trim(), 'select:', await p.locator('#permission-mode').inputValue());
  await p.locator('#branch-chip').click(); await p.waitForTimeout(600);
  console.log('after clicking the branch chip, label:', (await p.locator('#mode-button').innerText()).trim(), 'select:', await p.locator('#permission-mode').inputValue());
  await p.locator('#effort-level').selectOption('max'); await p.locator('#mode-button').click(); await p.locator('#mode-menu button', { hasText: 'Plan' }).first().click(); await p.waitForTimeout(300);
  await p.locator('#mode-code').click(); await p.locator('#mode-chat').click(); await p.waitForTimeout(300);
  console.log('after toggling Chat/Code, label:', (await p.locator('#mode-button').innerText()).trim(), 'effort:', await p.locator('#effort-level').inputValue());
}
if (step === 'customize') {
  await p.goto(B + '/src/ui/customize.html'); await p.waitForTimeout(800);
  console.log('buttons:', JSON.stringify(await p.locator('button').evaluateAll((e) => e.map((x) => (x.textContent || '').trim().slice(0, 20) + ':' + (x.offsetParent ? 'v' : 'h')))));
  for (const t of ['Connectors', 'Skills', 'Plugins', 'Yours', 'Discover']) { try { await p.getByRole('button', { name: t, exact: true }).first().click({ timeout: 3000 }); await p.waitForTimeout(400); console.log(t, 'ok;', (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 130)); } catch (e) { console.log(t, 'FAILED', String(e).slice(0, 100)); } }
}
if (step === 'importsend') {
  await p.locator('#import').click(); await p.locator('#import-text').fill('## You\nhi there\n\n## Assistant\nhello back'); await p.locator('#import-run').click(); await p.waitForTimeout(1500);
  console.log('url after import:', p.url().replace(B, ''), '| picker:', (await p.locator('#picker-button').innerText()).replace(/\s+/g, ' '));
  const reqs = []; p.on('request', (r) => { if (r.url().includes('/messages') || r.url().includes('/complete')) reqs.push(r.method() + ' ' + r.url().replace(B, '')); });
  await p.locator('#input').fill('are you there'); await p.locator('#send').click(); await p.waitForTimeout(3000);
  console.log('requests sent:', JSON.stringify(reqs)); console.log('error line:', JSON.stringify(await p.locator('#error').innerText())); console.log('transcript tail:', (await p.locator('#messages').innerText()).replace(/\s+/g, ' ').slice(-140));
  console.log('send enabled:', await p.locator('#send').isEnabled(), 'stop hidden:', await p.locator('#stop').isHidden());
}
if (step === 'stopreopen') {
  const C = process.env.BASE; const mdl = await import('node:http');
  const srv = mdl.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); } res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(frame({ content: 'Starting… ' })); setTimeout(() => res.end(frame({ content: 'late' }) + 'data: [DONE]' + String.fromCharCode(10, 10)), 8000); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await fetch(C + '/api/providers/custom-scripted', { method: 'DELETE' }); await fetch(C + '/api/providers/custom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Scripted', baseUrl: 'http://127.0.0.1:' + srv.address().port + '/v1' }) });
  await p.goto(C + '/'); await p.waitForSelector('#greeting'); await p.locator('#picker-button').click(); await p.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  const countS = async () => ((await p.locator('#messages').innerText()).match(/Starting/g) ?? []).length;
  const trial = async (label) => {
    const before = await countS();
    await p.locator('#input').fill('slow please ' + label); await p.locator('#send').click(); await p.locator('#stop').waitFor({ state: 'visible', timeout: 4000 }); await p.waitForTimeout(1500); await p.locator('#stop').click(); await p.locator('#stop').waitFor({ state: 'hidden', timeout: 5000 });
    const seen = []; for (let i = 0; i < 10; i++) { await p.waitForTimeout(300); seen.push((await countS()) > before); }
    console.log(label, 'Starting… visible after Stop over 3 s:', JSON.stringify(seen.map((x) => (x ? 1 : 0)).join('')));
  };
  if (process.env.IMPORTED) { await p.locator('#import').click(); await p.locator('#import-text').fill('## You'+String.fromCharCode(10)+'hi there'+String.fromCharCode(10,10)+'## Assistant'+String.fromCharCode(10)+'hello back'); await p.locator('#import-run').click(); await p.waitForTimeout(1500); console.log('imported chat opened:', p.url().replace(C, '')); await trial('imported chat'); await p.reload(); await p.waitForSelector('#input'); await p.waitForTimeout(1200); console.log('after reload the transcript has Starting:', /Starting/.test(await p.locator('#messages').innerText())); }
  else await trial('fresh chat'); 
  if (!process.env.IMPORTED) { await p.reload(); await p.waitForSelector('#input'); await p.waitForTimeout(1200); await trial('same chat after reload'); }
  srv.closeAllConnections?.(); srv.close();
}
await b.close();
