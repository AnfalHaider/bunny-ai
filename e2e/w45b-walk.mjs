/**
 * QA walk for W4-5b, the one working line. Invented profile and folder only. A scripted model streams thinking, takes a step,
 * thinks again and answers; another is silent for 28 s (the slow state).
 *
 *   SRC=<worktree at the commit under test> OUT=<folder for pictures> [PORT0=5901] node e2e/w45b-walk.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fa1'; const PORT = +(process.env.PORT0 ?? 5901);
const NL = String.fromCharCode(10);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(8), name, '::', String(note).slice(0, 300));
};

// ---- the scripted model ----
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const toolFrame = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random().toString(36).slice(2)}`, function: { name, arguments: JSON.stringify(args) } }] });
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const lastUser = body.messages.map((m) => m.role).lastIndexOf('user');
    const asked = String(body.messages[lastUser]?.content ?? ''); const afterTool = body.messages.slice(lastUser).some((m) => m.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const at = (ms, fn) => setTimeout(() => { if (!res.writableEnded) fn(); }, ms);
    const end = () => { res.write('data: [DONE]' + NL + NL); res.end(); };
    if (/slowone/.test(asked)) { at(28_000, () => { res.write(frame({ content: 'Sorry for the wait. Here is the answer.' })); end(); }); return; }
    if (/steps/.test(asked)) {
      if (!afterTool) { res.write(frame({ reasoning_content: 'I should look at the folder first. ' })); at(1200, () => res.write(frame({ reasoning_content: 'The README will say what this is.' }))); at(2600, () => { res.write(toolFrame('list_files', {})); end(); }); }
      else { res.write(frame({ reasoning_content: 'Now I know the layout. ' })); at(1500, () => res.write(frame({ reasoning_content: 'One sentence is enough.' }))); at(3200, () => { res.write(frame({ content: 'The folder has a README and one source file.' })); end(); }); }
      return;
    }
    // plain thinking reply
    res.write(frame({ reasoning_content: 'The page has three price cards ' })); at(900, () => res.write(frame({ reasoning_content: 'and a comparison table. Keep the card order.' }))); at(8000, () => { res.write(frame({ content: 'Done: the cards keep their order.' })); end(); });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const FPORT = fake.address().port;
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: mkdtempSync(join(tmpdir(), 'bunny-w45-data-')), BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } fake.closeAllConnections?.(); fake.close(); process.exit(code); };
try {
  ok((await (await api('/api/health')).json()).fake, 'refusing: not an invented profile');
  const prov = await (await api('/api/providers/custom', 'POST', { name: 'Thinker', baseUrl: `http://127.0.0.1:${FPORT}/v1` })).json(); const PID = prov.id ?? prov.provider?.id; ok(PID, 'no provider');
  await api('/api/settings', 'PUT', { modelFilter: 'all' });
  const work = mkdtempSync(join(tmpdir(), 'bunny-w45-')); writeFileSync(join(work, 'README.md'), '# demo' + NL); writeFileSync(join(work, 'app.js'), 'export const a = 1;' + NL);
  const newChat = async (title, mode) => {
    const s = await (await api('/api/sessions', 'POST', { title, providerId: PID, model: 'offline/bunny-code' })).json();
    if (mode === 'code') for (const [n, v] of [['folder', work], ['workMode', 'code'], ['permissionMode', 'auto']]) await api(`/api/sessions/${s.id}/setting/${n}`, 'PATCH', { value: v });
    return s.id;
  };
  browser = await chromium.launch();
  const open = async (viewport, scheme, id, { thinkingView = false } = {}) => {
    await api('/api/settings', 'PUT', { transcriptView: thinkingView ? 'thinking' : 'normal' });
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, baseURL: BASE }); const page = await ctx.newPage();
    await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); }); await page.goto(`/src/ui/index.html?s=${id}`); await page.waitForSelector('#input'); await page.waitForTimeout(700);
    if (!(await page.locator('#picker-button').innerText()).includes('bunny-code')) { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
    return { ctx, page };
  };
  const snap = (page) => page.evaluate(() => {
    const ws = [...document.querySelectorAll('.bunny-working')]; const box = document.querySelector('#messages'); const w = ws[0];
    const others = [...(box?.children ?? [])].filter((e) => e !== w && !e.contains(w)); const maxBottom = Math.max(0, ...others.map((e) => e.getBoundingClientRect().bottom));
    const line = w?.querySelector('.bunny-line');
    return { n: ws.length, atBottom: w ? w.getBoundingClientRect().top >= maxBottom - 3 : null, word: w?.querySelector('.bunny-word')?.textContent ?? '', tail: w?.querySelector('.bunny-tail')?.textContent ?? '', time: w?.querySelector('.bunny-time')?.textContent ?? '', expanded: line?.getAttribute('aria-expanded'), slow: w?.classList.contains('is-slow') ?? false, h: line ? Math.round(line.getBoundingClientRect().height) : 0, thoughtRows: [...document.querySelectorAll('details.thinking summary')].map((s) => s.textContent.trim()), order: [...document.querySelectorAll('#messages details.thinking, #messages .tool-group, #messages .tool-call')].filter((e, i, a) => !a.some((p) => p !== e && p.contains(e))).map((e) => (e.matches('details.thinking') ? 'T' : 'S')).join(''), oldThinkingRow: /^\s*Thinking…?\s*$/m.test(document.querySelector('#messages')?.innerText ?? ''), liveThinkingDetails: document.querySelectorAll('details.thinking:not([data-done])').length, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  const send = async (page, text) => { await page.locator('#input').fill(text); await page.locator('#send').click(); };

  // ---- A: the plain thinking reply, desktop, light ----
  const idA = await newChat('plain', 'chat'); let { ctx, page } = await open({ width: 1440, height: 900 }, 'light', idA);
  await send(page, 'tidy the pricing page'); await page.waitForSelector('.bunny-working .bunny-line'); await page.waitForTimeout(500);
  const samples = []; const t0 = Date.now(); for (let i = 0; i < 12; i++) { samples.push(await snap(page)); await page.waitForTimeout(250); } await page.waitForTimeout(200);
  await row('A1', 'during the reply there is exactly ONE live line, at the bottom, and no separate "Thinking…" row', async () => {
    const blank = samples.filter((s) => s.n === 1 && s.word === ''); ok(!blank.length, blank.length + ' samples with a blank word'); const bad = samples.filter((s) => s.n !== 1 || s.atBottom === false || s.oldThinkingRow); ok(!bad.length, `${bad.length} of ${samples.length} samples wrong: ` + JSON.stringify(bad[0])); return `${samples.length} samples over ${Math.round((Date.now() - t0) / 1000)} s`;
  });
  await row('A2', 'while thinking the line reads "<word>… thinking · Ns" and has a chevron; it opens to the thinking text and closes again', async () => {
    const s = await snap(page); ok(/…$/.test(s.word) && s.tail === 'thinking' && /^\d+s$/.test(s.time), JSON.stringify({ w: s.word, t: s.tail, ti: s.time })); ok(s.expanded === 'false', 'not folded by default: ' + s.expanded);
    await page.screenshot({ path: `${OUT}/a-folded-light-1440.png` }); const line = page.locator('.bunny-working .bunny-line'); await line.click(); await page.waitForTimeout(300);
    ok((await line.getAttribute('aria-expanded')) === 'true', 'did not open'); const txt = await page.locator('.bunny-working .bunny-thinking').innerText(); ok(/three price cards/.test(txt), 'thinking text: ' + txt); await page.screenshot({ path: `${OUT}/a-open-light-1440.png` });
    await line.click(); await page.waitForTimeout(200); ok((await line.getAttribute('aria-expanded')) === 'false', 'did not close'); return `${s.word} thinking · ${s.time}`;
  });
  await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 }); await page.waitForTimeout(500);
  await row('A3', 'when done: no bunny line, a "Thought for Ns" row that opens to the text', async () => {
    const s = await snap(page); ok(s.n === 0, 'live line still there'); ok(s.thoughtRows.length === 1 && /^Thought for \d+s$/.test(s.thoughtRows[0]), JSON.stringify(s.thoughtRows));
    const row0 = page.locator('details.thinking').last(); await row0.locator('summary').click(); ok(/Keep the card order/.test(await row0.locator('.thinking-text').innerText()), 'row did not open to the text'); await page.screenshot({ path: `${OUT}/a-done-open-light-1440.png` }); return s.thoughtRows[0];
  });
  const rowsBefore = (await snap(page)).thoughtRows; await page.goto(`/src/ui/index.html?s=${idA}`); await page.waitForSelector('#messages .msg'); await page.waitForTimeout(700);
  await row('A4', 'reopening the chat shows the same "Thought for Ns" row', async () => { const r = (await snap(page)).thoughtRows; ok(JSON.stringify(r) === JSON.stringify(rowsBefore) && r.length === 1, `before ${JSON.stringify(rowsBefore)} after ${JSON.stringify(r)}`); return r[0]; });
  await ctx.close();

  // ---- B: Show thinking opens by default ----
  const idB = await newChat('show', 'chat'); ({ ctx, page } = await open({ width: 1440, height: 900 }, 'dark', idB, { thinkingView: true }));
  await send(page, 'tidy the pricing page'); await page.waitForSelector('.bunny-working .bunny-line'); await page.waitForTimeout(1500);
  await row('B1', '"Show thinking" opens the line by default and shows the thinking text', async () => { const s = await snap(page); ok(s.expanded === 'true', 'aria-expanded ' + s.expanded); ok(/price cards/.test(await page.locator('.bunny-working .bunny-thinking').innerText()), 'no text'); await page.screenshot({ path: `${OUT}/b-showthinking-dark-1440.png` }); });
  await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 }); await ctx.close();

  // ---- C: a reply with a step in the middle ----
  const idC = await newChat('steps', 'code'); ({ ctx, page } = await open({ width: 1440, height: 900 }, 'light', idC));
  await send(page, 'steps please'); await page.waitForSelector('.bunny-working .bunny-line');
  const run = []; let sawStep = false; let rowsAtEnd = []; let liveRowsMax = 0; const tEnd = Date.now() + 40000;
  while (Date.now() < tEnd) {
    const s = await snap(page); const hasGroup = await page.locator('.tool-group, .tool-call').count(); if (hasGroup) sawStep = true; run.push({ ...s, hasGroup, t: Date.now() }); if (s.order.includes('S') && !globalThis.__shot1) { globalThis.__shot1 = 1; await page.screenshot({ path: `${OUT}/c-step-start-light-1440.png` }); }
    if (!(await page.locator('#stop').isVisible().catch(() => false)) && Date.now() - run[0].t > 2500) break; await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  await row('C1', 'through thinking, a step, thinking again: always ONE live line at the bottom (never two, never none until done)', async () => {
    const live = run.filter((s) => s.n !== 0 || true); const two = run.filter((s) => s.n > 1); ok(!two.length, 'two lines at once: ' + JSON.stringify(two[0])); const notBottom = run.filter((s) => s.n === 1 && s.atBottom === false); ok(!notBottom.length, 'line not at the bottom in ' + notBottom.length + ' samples');
    const gaps = run.filter((s, i) => s.n === 0 && i < run.length - 3); ok(gaps.length <= 2, `${gaps.length} samples with no live line mid-run`); ok(sawStep, 'the step never appeared'); const old = run.filter((s) => s.oldThinkingRow); ok(!old.length, 'a Thinking… row showed'); return `${run.length} samples; words: ${[...new Set(run.map((s) => s.word).filter(Boolean))].slice(0, 6).join(' | ')}`;
  });
  await row('C2', 'when a step starts, "Thought for Ns" stays in place above it (and opens); then the line thinks again with a fresh timer', async () => {
    const withStep = run.find((s) => s.hasGroup && s.thoughtRows.length >= 1); ok(withStep, 'no sample with both a step and a Thought row: ' + JSON.stringify(run.filter((s) => s.hasGroup).slice(0, 2).map((s) => s.thoughtRows)));
    ok(/^Thought for \d+s$/.test(withStep.thoughtRows[0]), withStep.thoughtRows[0]); const final = await snap(page); const liveMax = Math.max(...run.map((x) => x.thoughtRows.length)); rowsAtEnd = final.thoughtRows; liveRowsMax = liveMax;
    const orders = [...new Set(run.map((x) => x.order))]; const stepMoment = run.find((x) => x.order.includes('S')); ok(stepMoment, 'no step sample'); const rowOpens = await page.evaluate(() => { const d = document.querySelector('details.thinking'); if (!d) return false; d.querySelector('summary').click(); return d.open && /layout/.test(d.innerText); }); ok(rowOpens, 'the Thought row did not open to the text'); const startsAbove = stepMoment.order.startsWith('T'); ok(startsAbove, 'live: the Thought row is not before its step: first order with a step is ' + stepMoment.order + ' (all: ' + orders.join(' -> ') + ')'); const order = orders.join(' -> ');
    await page.screenshot({ path: `${OUT}/c-steps-done-light-1440.png` }); return `the Thought row is before its step while live (${startsAbove ? 'yes' : 'no'}); orders ${order}; most Thought rows seen while live ${liveMax}; rows at the end ${JSON.stringify(final.thoughtRows)}`;
  });
  await row('C4', 'reopening the chat with a step shows the same Thought rows as the live end state (INFO if the live view had more rows)', async () => { await page.goto(`/src/ui/index.html?s=${idC}`); await page.waitForSelector('#messages .msg'); await page.waitForTimeout(700); const r = (await snap(page)).thoughtRows; await page.screenshot({ path: `${OUT}/c-reopened-light-1440.png` }); const savedOrder = (await snap(page)).order; const note = `live most ${liveRowsMax}, live end ${JSON.stringify(rowsAtEnd)}, reopened ${JSON.stringify(r)}, saved order ${savedOrder}`; ok(savedOrder.indexOf('T') !== -1 && savedOrder.indexOf('T') < savedOrder.indexOf('S'), 'saved: the Thought row is not before its step: ' + savedOrder); ok(JSON.stringify(r) === JSON.stringify(rowsAtEnd), 'differs: ' + note); return note; });
  await row('C3', 'finished: no live line, no bunny, the answer is shown', async () => { const s = await snap(page); ok(s.n === 0, 'live line left'); ok(/README and one source file/.test(await page.locator('#messages').innerText()), 'no answer'); });
  await ctx.close();

  // ---- D: old chat without the time ----
  const old = await (await api('/api/sessions', 'POST', { title: 'Old', messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hi', at: new Date().toISOString() }, { id: 'a1', role: 'assistant', kind: 'text', content: 'hello', thinking: 'Let me think.', at: new Date().toISOString() }] })).json();
  ({ ctx, page } = await open({ width: 1440, height: 900 }, 'light', old.id)); await page.waitForTimeout(500);
  await row('D1', 'an old chat (saved without the time) shows just "Thought"', async () => { const r = (await snap(page)).thoughtRows; ok(r.length === 1 && r[0] === 'Thought', JSON.stringify(r)); await page.screenshot({ path: `${OUT}/d-old-light-1440.png` }); });
  await ctx.close();

  // ---- E: the slow state, through the real client ----
  const idE = await newChat('slow', 'chat'); ({ ctx, page } = await open({ width: 1440, height: 900 }, 'light', idE));
  await send(page, 'slowone please'); await page.waitForSelector('.bunny-working .bunny-line'); const slowSeen = []; const tS = Date.now();
  while (Date.now() - tS < 36000) { const s = await snap(page); if (s.slow) { slowSeen.push(s); if (slowSeen.length === 1) await page.screenshot({ path: `${OUT}/e-slow-light-1440.png` }); } if (!(await page.locator('#stop').isVisible().catch(() => false)) && Date.now() - tS > 3000) break; await page.waitForTimeout(1000); }
  await row('E1', 'a model silent for 28 s: after about 25 s the line says "Hmph…" and "waiting for <model>" with the time', async () => {
    ok(slowSeen.length, 'the slow state never showed'); const firstWord = slowSeen[0].word; const s = slowSeen[Math.min(2, slowSeen.length - 1)]; /* the word swaps over 180 ms: judge it a couple of seconds into the slow state, and record the first sample */ ok(slowSeen.length < 3 || slowSeen.slice(2).every((x) => x.word === 'Hmph…'), 'the word did not settle on Hmph…: ' + slowSeen.map((x) => x.word).join(' | ')); ok(s.word === 'Hmph…', 'word ' + s.word); ok(/^waiting for .+/.test(s.tail), 'tail ' + s.tail); ok(/\d+s|\d+m/.test(s.time), 'time ' + s.time); ok(slowSeen.every((x) => x.n === 1), 'more than one line'); return `${s.word} | ${s.tail} | ${s.time} (first sample showed ${firstWord}); first after ${Math.round((Date.now() - tS) / 1000)} s of waiting`;
  });
  await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}); await page.waitForTimeout(600);
  await row('E2', 'when the answer arrives the slow line is gone and the reply shows', async () => { const s = await snap(page); ok(s.n === 0, 'line still there'); ok(/Sorry for the wait/.test(await page.locator('#messages').innerText()), 'no answer'); });
  await ctx.close();

  // ---- F: phone, 390 ----
  for (const scheme of ['light', 'dark']) {
    const idF = await newChat('phone-' + scheme, 'chat'); ({ ctx, page } = await open({ width: 390, height: 800 }, scheme, idF));
    await send(page, 'tidy the pricing page'); await page.waitForSelector('.bunny-working .bunny-line'); await page.waitForTimeout(1500);
    await row('F1-' + scheme, `390 px (${scheme}): the line stays on one line with no sideways scroll, folded and opened, and after it is done`, async () => {
      const a = await snap(page); ok(a.h < 40 && !a.wide, `folded: height ${a.h}, wide ${a.wide}`); await page.screenshot({ path: `${OUT}/f-folded-${scheme}-390.png` });
      await page.locator('.bunny-working .bunny-line').click(); await page.waitForTimeout(300); const b = await snap(page); ok(b.h < 40 && !b.wide, `open: height ${b.h}, wide ${b.wide}`); await page.screenshot({ path: `${OUT}/f-open-${scheme}-390.png` });
      await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 }); await page.waitForTimeout(500); const c = await snap(page); ok(!c.wide, 'sideways scroll after done'); await page.screenshot({ path: `${OUT}/f-done-${scheme}-390.png` });
      const long = await page.evaluate(async () => { const { createWorking } = await import('/src/ui/bunny-working.js'); const w = createWorking('waiting', { model: 'Claude Sonnet 4.5 Extended Thinking Preview 20251101' }); document.body.append(w.el); w.set('slow'); await new Promise((r) => setTimeout(r, 400)); const l = w.el.querySelector('.bunny-line').getBoundingClientRect(); const t = w.el.querySelector('.bunny-time').getBoundingClientRect(); const out = { h: Math.round(l.height), timeInside: t.right <= l.right + 1, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth, word: w.el.querySelector('.bunny-word').textContent }; w.stop(); w.el.remove(); return out; });
      const real = await page.evaluate(async () => { const { createWorking } = await import('/src/ui/bunny-working.js'); const out = []; for (const model of ['deepseek/deepseek-r1-distill-llama-70b:free', 'claude-3-5-sonnet-20241022', 'accounts/fireworks/models/llama-v3p1-405b-instruct']) { const w = createWorking('waiting', { model }); document.body.append(w.el); w.set('slow'); await new Promise((r) => setTimeout(r, 300)); const l = w.el.querySelector('.bunny-line').getBoundingClientRect(); const t = w.el.querySelector('.bunny-time').getBoundingClientRect(); out.push({ len: model.length, fits: t.right <= l.right + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth }); w.stop(); w.el.remove(); } return out; });
      ok(real.every((x) => x.fits), 'model names do not fit: ' + JSON.stringify(real)); ok(long.h < 40 && long.timeInside && !long.wide, 'the 52-character name overflows: ' + JSON.stringify(long)); return `folded ${a.h}px, open ${b.h}px; slow-state fit by name length ${JSON.stringify(real)}; 52-char name: ${long.timeInside && !long.wide ? 'fits' : 'OVERFLOWS (time past the edge, sideways scroll)'}`;
    });
    await ctx.close();
  }
  writeFileSync(join(OUT, 'w45b.json'), JSON.stringify(rows, null, 1));
  console.log(NL + `${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
  await finish(0);
} catch (e) { console.log('HARNESS ERROR', e.stack); await finish(1); }
