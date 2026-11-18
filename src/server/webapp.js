/**
 * Bunny as a web app: the files a browser needs to offer "install" (the manifest, the icons, the service worker, the offline page).
 *
 * They are served at exact paths from the root, so the app's scope is "/", and they need no token and no sign-in: they hold no secret (no page, no token, no chat).
 * Nothing else is added to what a browser, or a device that has not signed in, may read: the sign-in page and exactly these files, by exact path.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const png = 'image/png';

/** exact path -> { file in src/ui, type, headers } */
export const WEBAPP_FILES = Object.freeze({
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/sw.js': { file: 'bunny-sw.js', type: 'text/javascript; charset=utf-8', worker: true },
  '/offline.html': { file: 'offline.html', type: 'text/html; charset=utf-8', csp: "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'" },
  '/icons/icon-192.png': { file: 'icons/icon-192.png', type: png },
  '/icons/icon-512.png': { file: 'icons/icon-512.png', type: png },
  '/icons/maskable-192.png': { file: 'icons/maskable-192.png', type: png },
  '/icons/maskable-512.png': { file: 'icons/maskable-512.png', type: png },
  '/icons/apple-touch-icon.png': { file: 'icons/apple-touch-icon.png', type: png },
});

/** What a device that has NOT signed in may also fetch (besides its sign-in page): the manifest and the icons, so the sign-in page can be added to a home screen. */
export const WEBAPP_PUBLIC_PATHS = Object.freeze(Object.keys(WEBAPP_FILES).filter((p) => p === '/manifest.webmanifest' || p.startsWith('/icons/')));

export const isWebappPath = (path) => Object.hasOwn(WEBAPP_FILES, path);

/** The service worker's source with the app's version in place of its marker: an update gets a new cache, and the old one is deleted. */
export function serviceWorkerSource(source, version) {
  return String(source).replace('__BUNNY_VERSION__', String(version).replace(/[^\w.-]/g, ''));
}

/** The headers and body of one of the web app files. `version` is the app's version. Returns null for any other path. */
export async function webappResponse(path, version) {
  const entry = WEBAPP_FILES[path];
  if (!entry || !Object.hasOwn(WEBAPP_FILES, path)) return null;
  let body = await readFile(join(UI, entry.file));
  const headers = {
    'content-type': entry.type,
    'x-content-type-options': 'nosniff',
    // the worker and the manifest are looked at again every time; icons may be kept a day
    'cache-control': entry.worker || entry.type.startsWith('application/manifest') || entry.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400',
  };
  if (entry.worker) { body = Buffer.from(serviceWorkerSource(body.toString('utf8'), version)); headers['service-worker-allowed'] = '/'; }
  if (entry.csp) headers['content-security-policy'] = entry.csp;
  return { headers, body };
}
