// Makes the web app icons from the app's existing icon (build/icons/icon-512.png): no new art.
//   node_modules/.bin/electron scripts/make-web-icons.cjs        (writes src/ui/icons/*.png)
// Plain icons are the app icon at 192 and 512 px. Maskable icons (and the iPhone touch icon) are the same icon at 80 % centred on a full square of its own purple, so a round
// or squircle mask never cuts the mark. Needs Electron only for its image functions; nothing else is read or written.
const { app, nativeImage } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const out = join(root, 'src', 'ui', 'icons');
const source = nativeImage.createFromPath(join(root, 'build', 'icons', 'icon-512.png'));

/** The icon's own purple, read from a pixel inside the rounded square (left of the mark). */
function purple() {
  const { width } = source.getSize();
  const bmp = source.toBitmap(); // BGRA
  const at = (x, y) => { const i = (y * width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i], bmp[i + 3]]; };
  return at(60, 256);
}

/** The icon scaled to `inner` px centred on a full `size` square of `colour` (alpha-over, so the icon's own rounded corners blend into the same colour). */
function onSquare(size, inner, colour) {
  const scaled = source.resize({ width: inner, height: inner, quality: 'best' });
  const small = scaled.toBitmap();
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) { buf[i * 4] = colour[2]; buf[i * 4 + 1] = colour[1]; buf[i * 4 + 2] = colour[0]; buf[i * 4 + 3] = 255; }
  const off = Math.floor((size - inner) / 2);
  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const s = (y * inner + x) * 4;
      const d = ((y + off) * size + (x + off)) * 4;
      const a = small[s + 3] / 255;
      for (let c = 0; c < 3; c += 1) buf[d + c] = Math.min(255, Math.round(small[s + c] + buf[d + c] * (1 - a))); // Electron's bitmaps are premultiplied
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

app.whenReady().then(() => {
  mkdirSync(out, { recursive: true });
  const colour = purple();
  const files = {
    'icon-192.png': source.resize({ width: 192, height: 192, quality: 'best' }),
    'icon-512.png': source,
    'maskable-192.png': onSquare(192, 154, colour),
    'maskable-512.png': onSquare(512, 410, colour),
    'apple-touch-icon.png': onSquare(180, 150, colour),
  };
  for (const [name, image] of Object.entries(files)) writeFileSync(join(out, name), image.toPNG());
  console.log('wrote', Object.keys(files).join(', '), 'purple', colour.join(','));
  app.exit(0);
});
