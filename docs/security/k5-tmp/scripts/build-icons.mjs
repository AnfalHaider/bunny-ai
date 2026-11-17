// Renders src/ui/icon.svg to PNGs and a Windows .ico for the desktop app.
// Output: build/icons/icon-<size>.png, build/icon.png (512), build/icon.ico
// Run: npm run build:icons   (uses the Playwright Chromium already installed for tests)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'src/ui/icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
mkdirSync(join(root, 'build/icons'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = {};
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
  pngs[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(join(root, `build/icons/icon-${size}.png`), pngs[size]);
}
await browser.close();
writeFileSync(join(root, 'build/icon.png'), pngs[512]);

// .ico with PNG-compressed entries (supported since Windows Vista); 256 is stored as width/height 0.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
const dir = Buffer.alloc(16 * icoSizes.length);
let offset = 6 + dir.length;
icoSizes.forEach((s, i) => {
  const data = pngs[s];
  const e = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(data.length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
writeFileSync(join(root, 'build/icon.ico'), Buffer.concat([header, dir, ...icoSizes.map((s) => pngs[s])]));
console.log(`wrote build/icon.png, build/icon.ico and ${SIZES.length} PNGs`);
