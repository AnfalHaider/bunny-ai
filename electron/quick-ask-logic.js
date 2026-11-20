// W4-8: the quick-ask bar's pure rules (no Electron here, so they can be tested).
import { looksSecret } from '../src/server/secretLike.js';

/**
 * QUICK-UI 9: what the bar may be told about Bunny's looks when it opens: a theme name, a font key from this fixed list, whether motion is reduced, and the name of the model that will
 * answer. Never a path, a url or any text the page could use: the page has its own fixed table for each key (and the font files are bundled in src/ui/fonts).
 */
export const BAR_THEMES = ['light', 'dark', 'system'];
export const BAR_FONT_KEYS = ['system', 'serif', 'sans', 'mono', 'inter', 'source-sans-3', 'ibm-plex-sans', 'atkinson-hyperlegible', 'lexend', 'nunito', 'quicksand', 'lora', 'literata', 'source-serif-4', 'noto-serif', 'jetbrains-mono', 'ibm-plex-mono'];

/** The settings the bar is told when it opens, cleaned: unknown values become the safe default. */
export function barLook(settings = {}) {
  const model = String(settings?.model ?? '').replace(/[^A-Za-z0-9 ._:+/-]/g, '').split('/').pop().trim().slice(0, 60);
  return {
    theme: BAR_THEMES.includes(settings?.theme) ? settings.theme : 'system',
    font: BAR_FONT_KEYS.includes(settings?.interfaceFont) ? settings.interfaceFont : 'system',
    motion: settings?.motion === 'reduced' ? 'reduced' : '',
    pcSearch: settings?.pcSearchEnabled === true, // SEARCH-PC: the + menu offers Search this PC only when the switch is on
    model,
  };
}

export const DEFAULT_SHORTCUT = 'Ctrl+Alt+Space';
export const MAX_TEXT = 20_000;
export const MAX_SHOT_BYTES = 8 * 1024 * 1024; // the most the bar will read of any file
// What the chat accepts (src/server/attachments.js): a picture up to 4 MB as a data address (3 MB of bytes), text up to 256 KB, a PDF up to 30 MB. The bar refuses what the chat would, in plain words, before it is added.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 128 * 1024; // half the chat's limit: the key check (looksSecret) reads at most 128 KB
export const TAKEN_MESSAGE = 'That shortcut is already used by another app';

const MODIFIERS = new Map([
  ['ctrl', 'Ctrl'], ['control', 'Ctrl'], ['commandorcontrol', 'Ctrl'], ['cmdorctrl', 'Ctrl'],
  ['alt', 'Alt'], ['option', 'Alt'], ['shift', 'Shift'],
  ['win', 'Super'], ['super', 'Super'], ['meta', 'Super'],
]);
const NAMED_KEYS = new Map([
  ['space', 'Space'], ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'],
  ['home', 'Home'], ['end', 'End'], ['pageup', 'PageUp'], ['pagedown', 'PageDown'], ['insert', 'Insert'],
]);

const SYSTEM_EDIT_KEYS = new Set(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Insert', 'Shift+Insert', 'Ctrl+Shift+V', 'Ctrl+Shift+Z', 'Ctrl+Shift+C']);

/** Check a shortcut the person typed. Returns { ok: true, accelerator } (Electron's spelling) or { ok: false, message }. */
export function validateAccelerator(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { ok: false, message: 'Choose a shortcut.' };
  if (raw.length > 40) return { ok: false, message: 'That shortcut is not valid.' };
  const parts = raw.split('+').map((p) => p.trim());
  if (parts.some((p) => !p)) return { ok: false, message: 'That shortcut is not valid.' };
  const mods = [];
  let key = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS.has(lower)) {
      const m = MODIFIERS.get(lower);
      if (!mods.includes(m)) mods.push(m);
      continue;
    }
    if (key) return { ok: false, message: 'Use one key with Ctrl, Alt or Win.' };
    if (/^[a-z0-9]$/i.test(part)) key = part.toUpperCase();
    else if (/^f([1-9]|1\d|2[0-4])$/i.test(part)) key = part.toUpperCase();
    else if (NAMED_KEYS.has(lower)) key = NAMED_KEYS.get(lower);
    else return { ok: false, message: 'That key cannot be used.' };
  }
  if (!key) return { ok: false, message: 'Add a key, such as Space.' };
  if (!mods.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Super')) return { ok: false, message: 'Use Ctrl, Alt or Win with another key' };
  const order = ['Ctrl', 'Alt', 'Shift', 'Super'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // v0.1.14.2 (QA): a registered global shortcut is taken away from every app, so the keys every app uses for Copy, Paste, Cut, Select all, Undo and Redo are refused
  const accelerator = [...mods, key].join('+');
  if (SYSTEM_EDIT_KEYS.has(accelerator)) return { ok: false, message: 'That shortcut is Copy, Paste, Cut, Select all, Undo or Redo in every app, and Quick ask would take it away from them. Choose another.' };
  return { ok: true, accelerator };
}

/**
 * Quick ask needs Bunny to keep running in the tray. Apply a change to the desktop preferences and say why when one is changed for the person.
 * Turning Quick ask on turns the tray on; turning the tray off turns Quick ask off (with a note).
 */
export function applyTrayRule(current, patch) {
  // Every preference the person changed is kept, not only the three this rule is about: this used to copy just those three, so "Start when I sign in" and
  // "Keep the same address after restart" were thrown away on every save and never came back after a restart.
  const next = { ...current, ...patch };
  let note = null;
  if (patch.quickAskEnabled === true && !next.closeToTray) {
    next.closeToTray = true;
    note = 'Quick ask needs Bunny to keep running in the tray, so that is on now.';
  }
  if (patch.closeToTray === false && next.quickAskEnabled && patch.quickAskEnabled !== true) {
    next.quickAskEnabled = false;
    note = 'Quick ask is off because it needs Bunny to keep running in the tray.';
  }
  return { prefs: next, note };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * W4-8b: "Add a file…". The type is decided HERE from the extension, never by the page that sends it, and the bytes must agree with it:
 * png, jpeg, gif and webp by their first bytes, pdf by %PDF-, and plain text only when it is valid UTF-8 with no NUL byte. At most 8 MB.
 */
// The source-code and plain-text extensions, written out in full (Security, W4-8b). Anything not in this list is refused.
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'rst', 'json', 'jsonc', 'csv', 'tsv', 'log', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'php', 'lua', 'r', 'dart', 'scala', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg', 'yaml', 'yml', 'toml', 'ini', 'sh', 'bash', 'ps1', 'bat', 'sql', 'vue', 'svelte'];
// Never attached whatever else is true: keys, certificates, password stores. (A file with no extension, or a name that starts with .env, is refused too.)
const NEVER_EXTENSIONS = new Set(['env', 'pem', 'key', 'p12', 'pfx', 'ppk', 'kdbx', 'crt', 'cer', 'jks', 'keystore', 'gpg', 'asc']);
const NEVER_NAMES = /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\..*)?|\.npmrc|\.netrc|credentials)$/i;
export const SECRET_FILE_MESSAGE = 'This file looks like it holds a key or password, so it was not attached.';
export const FILE_TYPES = new Map([
  ['png', { mime: 'image/png', kind: 'image' }], ['jpg', { mime: 'image/jpeg', kind: 'image' }], ['jpeg', { mime: 'image/jpeg', kind: 'image' }],
  ['gif', { mime: 'image/gif', kind: 'image' }], ['webp', { mime: 'image/webp', kind: 'image' }], ['pdf', { mime: 'application/pdf', kind: 'pdf' }],
  ...TEXT_EXTENSIONS.map((e) => [e, { mime: 'text/plain', kind: 'text' }]),
]);
export const FILE_DIALOG_FILTERS = [
  { name: 'Pictures, PDFs and text', extensions: [...FILE_TYPES.keys()] },
];

/** The file's own name: no folders, no control characters, at most 120 characters. */
export function cleanFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f\p{Cf}]/gu, '').trim(); // \p{Cf} takes out look-alike tricks such as U+202E (right-to-left override)
  return (base || 'file').slice(0, 120);
}

const startsWith = (bytes, ...sig) => sig.every((b, i) => bytes[i] === b);
function bytesAgree(kind, ext, bytes) {
  if (kind === 'pdf') return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (kind === 'image') {
    if (ext === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
    if (ext === 'jpg' || ext === 'jpeg') return startsWith(bytes, 0xff, 0xd8, 0xff);
    if (ext === 'gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('latin1'));
    if (ext === 'webp') return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    return false;
  }
  if (bytes.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/** A path from the dialog: a local drive path only. A share (\\\\server\\x leaks the Windows sign-in) and device paths (\\\\.\\ and \\\\?\\) are refused. */
export function checkPath(path) {
  if (typeof path !== 'string' || !path || /^[\\/]{2}/.test(path) || path.includes('\u0000')) return { ok: false, message: 'Only a file on this computer can be added.' };
  return { ok: true };
}

/** Check one file: { name, bytes (a Buffer) }. Returns { ok: true, file: { name, mime, kind, size, data } } or { ok: false, message }. */
export function checkFile(name, bytes) {
  const clean = cleanFileName(name);
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  if (NEVER_EXTENSIONS.has(ext) || NEVER_NAMES.test(clean) || clean.toLowerCase().startsWith('.env')) return { ok: false, message: SECRET_FILE_MESSAGE };
  const type = FILE_TYPES.get(ext);
  if (!type) return { ok: false, message: 'That kind of file cannot be added. Pictures, PDFs and plain text can.' };
  if (!Buffer.isBuffer(bytes) || !bytes.length) return { ok: false, message: 'That file is empty.' };
  if (bytes.length > MAX_SHOT_BYTES) return { ok: false, message: 'The file is over 8 MB.' };
  if (type.kind === 'image' && bytes.length > MAX_IMAGE_BYTES) return { ok: false, message: 'The picture is over 3 MB.' };
  if (type.kind === 'text' && bytes.length > MAX_TEXT_FILE_BYTES) return { ok: false, message: 'The text file is over 128 KB.' };
  if (!bytesAgree(type.kind, ext, bytes)) return { ok: false, message: 'That file is not what its name says.' };
  if (type.kind === 'text' && looksSecret(bytes.toString('utf8'))) return { ok: false, message: SECRET_FILE_MESSAGE }; // W6-18's check, on the text
  return { ok: true, file: { name: clean, mime: type.mime, kind: type.kind, size: bytes.length, data: `data:${type.mime};base64,${bytes.toString('base64')}` } };
}

/**
 * Check what the bar sends. Returns { ok: true, text, shot, file } (shot is a Buffer or null; file is the file main is holding or null) or { ok: false, message }.
 * A file is never sent back by the page: it names the id main gave it, and `held` ({ id, file }) is what main kept. An id main never gave out is refused.
 */
export function validateSubmission(text, attachments, held = null) {
  if (typeof text !== 'string') return { ok: false, message: 'Type something to ask.' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: 'Type something to ask.' };
  if (trimmed.length > MAX_TEXT) return { ok: false, message: `That is too long. The limit is ${MAX_TEXT.toLocaleString('en-US')} characters.` };
  const list = attachments == null ? [] : attachments;
  if (!Array.isArray(list) || list.length > 1) return { ok: false, message: 'Only one screenshot or file can be added.' };
  let shot = null;
  let file = null;
  if (list.length === 1 && list[0] && typeof list[0] === 'object' && list[0].kind === 'file') {
    // a file: only the id main gave it. What was read and checked at pick time is what is sent, whatever the file is by now.
    if (!held || typeof list[0].id !== 'string' || list[0].id !== held.id) return { ok: false, message: 'The file was not valid.' };
    file = held.file;
  } else if (list.length === 1) {
    const a = list[0];
    const m = a && typeof a === 'object' && typeof a.data === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(a.data) : null;
    if (!m) return { ok: false, message: 'The screenshot was not valid.' };
    if (m[1].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) return { ok: false, message: 'The screenshot is over 3 MB.' };
    shot = Buffer.from(m[1], 'base64');
    if (shot.length > MAX_IMAGE_BYTES) return { ok: false, message: 'The screenshot is over 3 MB.' };
    if (shot.length < PNG_SIGNATURE.length || !shot.subarray(0, 8).equals(PNG_SIGNATURE)) return { ok: false, message: 'The screenshot was not valid.' };
  }
  return { ok: true, text: trimmed, shot, file };
}

/** The request handed to Bunny's window: a NEW chat in Chat mode, no folder, the message as plain data, the screenshot as an ordinary image attachment. */
export function buildNewChatRequest(text, shot, file = null) {
  return {
    text,
    workMode: 'chat',
    folder: null,
    files: file ? [{ name: file.name, mime: file.mime, kind: file.kind, data: file.data, size: file.size }]
      : shot ? [{ name: 'Screenshot.png', mime: 'image/png', kind: 'image', data: `data:image/png;base64,${shot.toString('base64')}`, size: shot.length }] : [],
  };
}
