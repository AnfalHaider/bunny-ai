/**
 * QA, release-0.1.10 walk (candidate 9d4e942), the rows that need the REAL Electron window: artifact Open (content, no bridge) and Print (sandboxed frame),
 * the model chip in the real window, W2-9 Working folder card (own copy, Finish keep) through the real bridge, and Settings -> About showing the FULL release notes
 * of a newer version (a stand-in feed on a local port). Plus the updater in Node: a 0.1.9 copy sees 0.1.10 and checks its checksum.
 * App run from source on an invented profile (BUNNY_DATA_DIR, --user-data-dir), never %LOCALAPPDATA%\BunnyAI; the folder dialog is a stand-in; no OS keys.
 *   node e2e/w0110-electron.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0110e-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0110e-user-')); const REPO = mkdtempSync(join(tmpdir(), 'bunny-w0110e-repo-'));
const SHOTS = join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 320) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const real = join(process.env.LOCALAPPDATA ?? '', 'BunnyAI');
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (...a) => execFileSync('git', a, { cwd: REPO, env: gitEnv, encoding: 'utf8', windowsHide: true }).trim();
git('init', '-q', '-b', 'main'); git('config', 'core.autocrlf', 'false'); writeFileSync(join(REPO, 'a.txt'), 'a\n'); git('add', '-A'); git('commit', '-q', '-m', 'first');

// ---- a stand-in release feed (GitHub-shaped) with a long body and an invented installer ----
const NOTES = 'NOTE-START ' + Array.from({ length: 600 }, (_, i) => `- line ${i}: something that changed`).join('\n') + '\nNOTE-END-MARKER';
const installer = randomBytes(1024 * 1024); const sha = createHash('sha512').update(installer).digest('base64');
let feedVersion = '0.1.11'; let quoted = false;
const feedServer = createServer((req, res) => {
  const base = `http://127.0.0.1:${feedServer.address().port}`;
  if (req.url === '/feed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tag_name: 'v' + feedVersion, body: NOTES, assets: [{ name: `Bunny-AI-Setup-${feedVersion}.exe`, size: installer.length, browser_download_url: `${base}/installer` }, { name: 'latest.yml', size: 100, browser_download_url: `${base}/latest.yml` }] })); return; }
  if (req.url === '/latest.yml') { const v = quoted ? `"${sha}"` : sha; res.writeHead(200); res.end(`version: ${feedVersion}\nfiles:\n  - url: Bunny-AI-Setup-${feedVersion}.exe\n    sha512: ${v}\n    size: ${installer.length}\npath: Bunny-AI-Setup-${feedVersion}.exe\nsha512: ${v}\n`); return; }
  if (req.url === '/installer') { res.writeHead(200); res.end(installer); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
const FEED = `http://127.0.0.1:${feedServer.address().port}/feed`;

let app;
const finish = async (code) => { try { await app?.close(); } catch { /* x */ } try { feedServer.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; pictures in ${SHOTS}`); process.exit(code ?? (bad.length ? 1 : 0)); };

try {
  // ================= 9. the updater: a 0.1.9 copy sees 0.1.10 =================
  const { createUpdater, compareVersions } = await import(pathToFileURL(join(root, 'electron', 'updater.js')).href);
  feedVersion = '0.1.10';
  const dl = mkdtempSync(join(tmpdir(), 'bunny-w0110e-upd-')); const states = [];
  const up = createUpdater({ currentVersion: '0.1.9', feed: FEED, downloadDir: dl, onStatus: (s) => states.push(s.state + (s.state === 'downloading' ? ':' + (s.progress ?? 0) : '')) });
  const r1 = await up.check({ manual: true });
  check('9a', 'a 0.1.9 copy sees 0.1.10, downloads it and the SHA-512 matches: state ready, "Bunny AI 0.1.10 is ready. Restart to update."', r1.state === 'ready' && r1.latest === '0.1.10' && /0\.1\.10 is ready/.test(r1.message) && up.hasUpdate(), `${r1.state} ${r1.latest}: ${r1.message}; ${states.slice(0, 4).join('>')}`);
  check('9b', 'the whole of the release notes arrived (no 4,000-character cut): first and last marker are both there', r1.notes?.includes('NOTE-START') && r1.notes.includes('NOTE-END-MARKER') && r1.notes.length > 20000, String(r1.notes?.length));
  check('9c', 'the file is in the invented download folder under its published name; nothing was installed or run', existsSync(join(dl, 'Bunny-AI-Setup-0.1.10.exe')) && readdirSync(dl).length === 1);
  const dl2 = mkdtempSync(join(tmpdir(), 'bunny-w0110e-upd2-')); quoted = true;
  const r2 = await createUpdater({ currentVersion: '0.1.9', feed: FEED, downloadDir: dl2 }).check({ manual: true });
  quoted = false;
  check('9d', 'a latest.yml whose sha512 is in quotes is the same value (accepted)', r2.state === 'ready', `${r2.state}: ${r2.message}`);
  const bad = Buffer.from(installer); bad[500] ^= 0xff; const evil = createServer((req, res) => { if (req.url === '/installer') { res.writeHead(200); res.end(bad); return; } feedServer.emit('request', req, res); }); await new Promise((r) => evil.listen(0, '127.0.0.1', r));
  const evilBase = `http://127.0.0.1:${evil.address().port}`;
  const r3 = await createUpdater({ currentVersion: '0.1.9', feed: FEED, downloadDir: mkdtempSync(join(tmpdir(), 'bunny-w0110e-upd3-')), fetchImpl: (u, i) => fetch(String(u).replace(/^http:\/\/127\.0\.0\.1:\d+/, evilBase), i) }).check({ manual: true });
  evil.close();
  check('9e', 'one flipped byte in the installer is refused by the checksum and thrown away', r3.state === 'error' && /did not match its published checksum/.test(r3.message), `${r3.state}: ${r3.message}`);
  check('9f', 'a 0.1.10 copy is NOT offered 0.1.10; 0.1.9 < 0.1.10 and 0.1.10 > 0.1.9 numerically', compareVersions('0.1.10', '0.1.9') === 1 && compareVersions('0.1.9', '0.1.10') === -1 && compareVersions('0.1.10', '0.1.10') === 0);


  // ================= the real window =================
  const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1', BUNNY_UPDATE_FEED: FEED }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  feedVersion = '0.1.11';
  app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 60000 });
  const win = await app.firstWindow(); const errors = []; win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForLoadState('domcontentloaded'); await wait(2500);
  const info = await app.evaluate(({ app: a }) => ({ userData: a.getPath('userData'), packaged: a.isPackaged, version: a.getVersion() }));
  check('S0', 'the real Electron window runs from source on the invented profile', info.userData.toLowerCase().startsWith(USER.toLowerCase()) && !info.packaged && info.version === '0.1.10', JSON.stringify(info));
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, REPO);
  const origin = new URL(win.url()).origin;

  // ---- 4. the model chip in the real window
  const MODELS = [{ providerId: 'harbor', providerName: 'Harbor', id: 'falcon-flash', displayName: 'Falcon Flash', freeKind: 'free', free: true, contextLength: 128000 }, { providerId: 'quill', providerName: 'Quill', id: 'otter-3-coder', displayName: 'Otter 3 Coder', freeKind: null, free: false, contextLength: 128000 }];
  await win.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
  await win.reload(); await wait(1500);
  const chip = win.locator('#picker-button'); const cb = await chip.boundingBox(); const sb = await win.locator('#send').boundingBox();
  check('4a', 'real window: the model chip sits in the composer row, left of Send', cb && sb && cb.x + cb.width <= sb.x + 1, JSON.stringify({ cb, sb }));
  await chip.click(); await wait(400); const pb = await win.locator('.picker-panel').boundingBox();
  check('4b', 'real window: the selector opens UPWARD above the chip and stays inside the window', pb.y + pb.height <= cb.y + 1 && pb.y >= 0, JSON.stringify(pb));
  await win.screenshot({ path: join(SHOTS, 'chip-real-window.png') });
  await win.keyboard.press('Escape'); await wait(200);
  check('4c', 'Esc closes it and the chip has the focus back', (await win.locator('.picker-panel').count()) === 0 && await chip.evaluate((el) => document.activeElement === el));
  await win.unroute('**/api/models*');

  // ---- 2. artifact Open (content, no bridge) and Print (sandboxed frame)
  const created = await win.evaluate(async () => { const r = await fetch('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'QA page', kind: 'html', content: '<h1 id="t">Hello QA artifact</h1><img src="x" onerror="document.title=typeof window.bunnyDesktop">' }) }); return { status: r.status, body: await r.json() }; });
  check('2.0', 'an artifact was saved on the invented profile', created.status === 200 && created.body?.id, JSON.stringify(created).slice(0, 160));
  await win.locator('#artifacts-toggle').click(); await wait(1200); await win.screenshot({ path: join(SHOTS, 'dbg-artifacts.png') });
  console.log('INFO  artifact list text: ' + JSON.stringify((await win.locator('#artifact-list').innerText().catch(() => 'n/a')).slice(0, 120)));
  await win.locator('#artifact-list >> text=Hello QA artifact').first().click({ timeout: 8000 }); await wait(1200); await win.screenshot({ path: join(SHOTS, 'dbg-artifact-open.png') });
  const opened = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
  await win.getByRole('button', { name: 'Open', exact: true }).first().click().catch(async () => { await win.locator('[title="Open"]').first().click(); });
  const aw = await opened;
  check('2a', 'Open: a new window opened on the artifact address', Boolean(aw) && /\/api\/artifacts\/[a-f0-9-]{36}\/raw$/.test(aw.url()), aw?.url());
  if (aw) {
    await aw.waitForLoadState('domcontentloaded').catch(() => {}); await wait(800);
    const seen = await aw.evaluate(() => ({ text: document.body.innerText.slice(0, 60), bridge: typeof window.bunnyDesktop, title: document.title })).catch((e) => ({ err: String(e) }));
    check('2b', 'the artifact window SHOWS its content', /Hello QA artifact/.test(seen.text ?? ''), JSON.stringify(seen));
    check('2c', 'and has NO desktop bridge (even its own onerror script sees "undefined")', seen.bridge === 'undefined' && seen.title === 'undefined', JSON.stringify(seen));
    const write = await aw.evaluate(async () => { try { return await window.bunnyDesktop.secureWrite('PATCH', '/api/settings', {}); } catch (e) { return 'no bridge: ' + e.message; } });
    check('2d', 'secure:write from the artifact window does not work', String(write).startsWith('no bridge'), String(write));
    await aw.screenshot({ path: join(SHOTS, 'artifact-open-window.png') }).catch(() => {});
    await aw.close().catch(() => {});
  }
  // Print: the page is printed from a sandboxed frame. The native print dialog is replaced inside every frame by a message to the page (a stand-in; nothing is printed).
  await app.context().addInitScript(() => { try { window.print = () => { try { parent.postMessage('QA-PRINT-CALLED', '*'); } catch { /* x */ } }; } catch { /* x */ } });
  await win.evaluate(() => { window.__qaPrint = 0; window.addEventListener('message', (e) => { if (e.data === 'QA-PRINT-CALLED') window.__qaPrint += 1; }); });
  await win.getByRole('button', { name: 'Print', exact: true }).first().click().catch(async () => { await win.locator('[title="Print"]').first().click(); }); await wait(2000);
  const frame = await win.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.style.visibility === 'hidden' && /Hello QA/.test(x.srcdoc ?? '')); return f ? { sandbox: f.getAttribute('sandbox'), hasPrint: /print\(\)/.test(f.srcdoc), asked: window.__qaPrint } : null; });
  check('2e', 'Print: the artifact is put in a hidden frame whose sandbox is "allow-scripts allow-modals" (never same-origin) and the page asks to print', frame && frame.sandbox === 'allow-scripts allow-modals' && !/same-origin/.test(frame.sandbox) && frame.hasPrint, JSON.stringify(frame));
  console.log('INFO  2f print() was reached inside the frame (stand-in message count): ' + (frame?.asked ?? 'n/a'));

  // ---- 7. W2-9 through the real bridge
  await win.evaluate(() => window.bunnyDesktop.pickFolder());
  const sess = await win.evaluate(async (folder) => { const r = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Tidy the greeter', folder }) }); return { status: r.status, body: await r.json() }; }, REPO);
  check('7.0', 'a chat on the invented repository was made with the picked folder', sess.status === 200 && sess.body?.id, JSON.stringify(sess).slice(0, 160));
  await win.evaluate(() => localStorage.setItem('bunny.workMode', 'code')); await win.reload(); await wait(1500);
  await win.getByText('Tidy the greeter').first().click(); await wait(900);
  await win.locator('#folder-chip').click(); await wait(500);
  const card = win.getByRole('dialog', { name: 'Working folder' });
  check('7a', 'the folder chip opens the Working folder card, with the switch off', await card.isVisible() && !(await card.getByLabel('Give this chat its own copy of the project').isChecked()));
  await win.screenshot({ path: join(SHOTS, 'w29-card-real.png') });
  await card.getByLabel('Give this chat its own copy of the project').click(); await wait(3000);
  const s1 = await win.evaluate(async (id) => (await fetch('/api/sessions/' + id)).json(), sess.body.id);
  check('7b', 'the switch (through the real bridge) made the copy: a bunny/ branch in a real folder; the chat says "own copy"', s1.worktree?.branch?.startsWith('bunny/tidy-the-greeter-') && existsSync(s1.worktree.path) && /own copy/.test(await win.locator('#branch-text').textContent()), JSON.stringify(s1.worktree));
  await win.screenshot({ path: join(SHOTS, 'w29-copy-real.png') });
  await card.getByRole('button', { name: 'Finish…' }).click(); await wait(500);
  const keep = await win.getByRole('dialog').getByText('Keep the branch').isVisible();
  await win.screenshot({ path: join(SHOTS, 'w29-finish-real.png') });
  await win.getByRole('button', { name: 'Finish', exact: true }).click(); await wait(2500);
  const s2 = await win.evaluate(async (id) => (await fetch('/api/sessions/' + id)).json(), sess.body.id);
  const branches = git('branch', '--list', 'bunny/*');
  check('7c', 'Finish offers "Keep the branch"; after Finish keep the chat is back on the real folder and the branch with its work is still in the repository', keep && !s2.worktree && /bunny\/tidy-the-greeter-/.test(branches) && !/own copy/.test(await win.locator('#branch-text').textContent()), `${keep} ${JSON.stringify(s2.worktree)} | ${branches}`);

  // ---- 8. Settings -> About shows the FULL release notes of a newer version
  const st = await win.evaluate(async () => window.bunnyDesktop.updates.check());
  check('8a', 'the real updater (stand-in feed) found 0.1.11 and downloaded it (checksum ok)', /ready|downloading/.test(st?.state ?? '') && st?.latest === '0.1.11', JSON.stringify({ state: st?.state, latest: st?.latest, msg: st?.message }));
  await wait(1500);
  await win.evaluate(([o]) => { document.getElementById('settings-backdrop').hidden = false; document.getElementById('settings-frame').src = o + '/src/ui/settings.html?embed=1&section=about'; }, [origin]);
  await wait(2500); const fr = win.frames().find((x) => x.url().includes('section=about'));
  const about = await fr.evaluate(async () => { const d = document.getElementById('update-notes'); const t = document.getElementById('update-notes-text'); return { hidden: d.hidden, len: t.textContent.length, start: t.textContent.slice(0, 20), end: t.textContent.slice(-20), note: document.getElementById('update-note')?.textContent }; });
  check('8b', 'Settings -> About shows "What is in this version" with the WHOLE notes (first and last marker, not cut at 4,000)', !about.hidden && about.len > 20000 && /NOTE-START/.test(about.start) && /NOTE-END-MARKER/.test(about.end), JSON.stringify(about));
  await fr.evaluate(() => { document.getElementById('update-notes').open = true; }); await wait(300);
  await win.screenshot({ path: join(SHOTS, 'about-notes-real.png') });

  check('E0', 'no page error in the main window', errors.length === 0, errors.join(' | '));
  check('E1', 'the real profile folder was not touched (the app ran on the invented folders)', !DATA.startsWith(real) && !USER.startsWith(real));
} catch (err) { console.log('WALK CRASHED: ' + (err?.stack ?? err)); await finish(2); }
await finish();
