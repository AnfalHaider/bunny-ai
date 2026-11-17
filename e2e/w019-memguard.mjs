/**
 * QA, v0.1.9 on the candidate head: Security's memory guard for request bodies (591bf83): a body declared over the cap is refused before it is read; only one body over
 * 1 MB is read at a time (a second gets 429 "Another large message is being sent"); a sender that does not stop is cut off; ordinary small requests are unaffected.
 * Real server (in process, invented data folder), raw HTTP over a socket, on the profile photo route (15 MB cap). Nothing is stored.
 *   node e2e/w019-memguard.mjs
 */
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp } = await imp('test/helpers.js');
const NL = String.fromCharCode(10); const CRLF = String.fromCharCode(13, 10); const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const { base } = await startApp(t, { fake: false }); const port = +new URL(base).port; const MB = 1024 * 1024;
const head = (declared) => 'POST /api/profile/photo HTTP/1.1' + CRLF + 'Host: 127.0.0.1:' + port + CRLF + 'Content-Type: application/json' + CRLF + 'Content-Length: ' + declared + CRLF + 'Connection: close' + CRLF + CRLF;
const status = (d) => { const m = /^HTTP\/1\.1 (\d+)/.exec(d); return m ? Number(m[1]) : 0; };
/** Send the head and `bytes` of body, keep the socket open, resolve with the socket after the bytes are written. */
const hold = (declared, bytes) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); let sent = 0; s.on('error', () => {}); s.write(head(declared)); const piece = Buffer.alloc(256 * 1024, 0x20); const pump = () => { if (sent >= bytes) { resolve(s); return; } s.write(piece); sent += piece.length; setImmediate(pump); }; pump(); });
/** Send only the head (declaring a size) and read the answer for a moment. */
const probe = (declared) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); let d = ''; s.on('data', (x) => { d += x; }); s.on('error', () => {}); s.write(head(declared)); setTimeout(() => { resolve({ status: status(d), body: d.split(CRLF + CRLF)[1] ?? '' }); s.destroy(); }, 600); });
const small = async () => (await fetch(base + '/api/health')).status;

const t0 = Date.now(); const over = await probe(40 * MB);
check('M1', 'a body DECLARED far over the cap (40 MB for a 15 MB route) is refused at once with a too-large answer, before any body is sent', over.status === 413 && Date.now() - t0 < 2500, 'HTTP ' + over.status + ' in ' + (Date.now() - t0) + ' ms; ' + over.body.slice(0, 100));
check('M2', 'an ordinary small request still works', (await small()) === 200, '');
const h1 = await hold(3 * MB, 1.3 * MB); await new Promise((r) => setTimeout(r, 500));
const second = await probe(3 * MB);
check('M3', 'while one large body (over 1 MB) is being sent, a SECOND large body is answered 429 "Another large message is being sent; try again in a moment."', second.status === 429 && /Another large message/.test(second.body), 'HTTP ' + second.status + '; ' + second.body.slice(0, 140));
check('M4', 'and ordinary small requests are not blocked while the large one is open', (await small()) === 200, '');
h1.destroy(); await new Promise((r) => setTimeout(r, 900));
const freed = await probe(3 * MB);
check('M5', 'when the holder disconnects the slot is free again: the next large body is no longer answered 429', freed.status !== 429, 'HTTP ' + freed.status);
// a body over 1 MB but declared under the cap, then abandoned half way, must not leave the slot taken (same as M5 from the other side)
const h2 = await hold(3 * MB, 1.3 * MB); await new Promise((r) => setTimeout(r, 300)); h2.destroy(); await new Promise((r) => setTimeout(r, 900));
const after = await probe(3 * MB); check('M6', 'an abandoned large upload does not leave the app stuck busy', after.status !== 429, 'HTTP ' + after.status);
// a sender that does not stop: 40 MB streamed to a route capped at 15 MB while declaring 20 MB
const flood = await new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); let d = ''; let sent = 0; let closed = false; s.on('data', (x) => { d += x; }); s.on('error', () => { closed = true; }); s.on('close', () => { closed = true; resolve({ status: status(d), closed, sent }); });
  s.write(head(20 * MB)); const piece = Buffer.alloc(1 * MB, 0x20); const pump = () => { if (closed || sent >= 40 * MB) { if (!closed) setTimeout(() => { s.destroy(); }, 1500); return; } s.write(piece); sent += piece.length; setImmediate(pump); }; pump(); setTimeout(() => { s.destroy(); }, 15000); });
check('M7', 'a sender that does not stop is refused or cut off before 40 MB is accepted', flood.status >= 400 || flood.closed, 'HTTP ' + flood.status + '; connection closed ' + flood.closed + '; sent ' + (flood.sent / MB).toFixed(1) + ' MB of 40');
for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((x) => !x.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed'); process.exit(bad.length ? 1 : 0);
