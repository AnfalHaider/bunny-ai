// QA probe: does the real Electron window flag a misspelled word that is TYPED (key events inside the page), and what does the right-click menu hold?
// Invented profile, real Electron. No operating-system keys are sent: Playwright types inside the page only.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-spell-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-spell-user-'));
const SHOTS = process.env.SHOTS || DATA;
const app = await _electron.launch({ executablePath: exe, args: [root, `--user-data-dir=${USER}`], env: { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }, timeout: 60000 });
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500);
await app.evaluate(({ Menu }) => { globalThis.__menus = []; const orig = Menu.prototype.popup; Menu.prototype.popup = function () { globalThis.__menus.push(this.items.map((i) => i.label || i.role || i.type)); return orig.apply(this, arguments); }; });
const spellOn = await app.evaluate(({ session }) => ({ enabled: session.defaultSession.isSpellCheckerEnabled(), langs: session.defaultSession.getSpellCheckerLanguages() }));
console.log('spell checker:', JSON.stringify(spellOn));
const attr = await win.evaluate(() => ({ spellcheck: document.getElementById('input').spellcheck, attr: document.getElementById('input').getAttribute('spellcheck') }));
console.log('message box spellcheck attribute:', JSON.stringify(attr));
await win.locator('#input').click();
await win.keyboard.type('I wrote teh ', { delay: 60 });
await win.waitForTimeout(3500);
const box = await win.locator('#input').boundingBox();
// find where the word "teh" is: measure with a range in a mirror span
const x = await win.evaluate(() => { const t = document.getElementById('input'); const cs = getComputedStyle(t); const m = document.createElement('span'); m.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`; m.textContent = 'I wrote '; document.body.append(m); const w = m.getBoundingClientRect().width; const m2 = document.createElement('span'); m2.style.cssText = m.style.cssText; m2.textContent = 'teh'; document.body.append(m2); const w2 = m2.getBoundingClientRect().width; m.remove(); m2.remove(); return { start: w, width: w2, padLeft: parseFloat(cs.paddingLeft) }; });
await win.mouse.click(box.x + x.padLeft + x.start + x.width / 2, box.y + 14, { button: 'right' });
await win.waitForTimeout(1200);
const menu = await app.evaluate(() => globalThis.__menus.at(-1) ?? null);
await win.keyboard.press('Escape');
console.log('right-click on the typed misspelled word:', JSON.stringify(menu));
await win.screenshot({ path: join(SHOTS, 'spell-typed.png') });
await app.close().catch(() => {});
