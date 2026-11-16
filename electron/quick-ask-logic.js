// W4-8: the quick-ask bar's pure rules (no Electron here, so they can be tested).

export const DEFAULT_SHORTCUT = 'Ctrl+Alt+Space';
export const MAX_TEXT = 20_000;
export const MAX_SHOT_BYTES = 8 * 1024 * 1024;
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
  return { ok: true, accelerator: [...mods, key].join('+') };
}

/**
 * Quick ask needs Bunny to keep running in the tray. Apply a change to the desktop preferences and say why when one is changed for the person.
 * Turning Quick ask on turns the tray on; turning the tray off turns Quick ask off (with a note).
 */
export function applyTrayRule(current, patch) {
  const next = { ...current };
  let note = null;
  if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
  if (typeof patch.quickAskEnabled === 'boolean') next.quickAskEnabled = patch.quickAskEnabled;
  if (typeof patch.quickAskShortcut === 'string') next.quickAskShortcut = patch.quickAskShortcut;
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

/** Check what the bar sends. Returns { ok: true, text, shot } (shot is a Buffer or null) or { ok: false, message }. */
export function validateSubmission(text, attachments) {
  if (typeof text !== 'string') return { ok: false, message: 'Type something to ask.' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: 'Type something to ask.' };
  if (trimmed.length > MAX_TEXT) return { ok: false, message: `That is too long. The limit is ${MAX_TEXT.toLocaleString('en-US')} characters.` };
  const list = attachments == null ? [] : attachments;
  if (!Array.isArray(list) || list.length > 1) return { ok: false, message: 'Only one screenshot can be added.' };
  let shot = null;
  if (list.length === 1) {
    const a = list[0];
    const m = a && typeof a === 'object' && typeof a.data === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(a.data) : null;
    if (!m) return { ok: false, message: 'The screenshot was not valid.' };
    if (m[1].length > Math.ceil(MAX_SHOT_BYTES * 4 / 3) + 4) return { ok: false, message: 'The screenshot is over 8 MB.' };
    shot = Buffer.from(m[1], 'base64');
    if (shot.length > MAX_SHOT_BYTES) return { ok: false, message: 'The screenshot is over 8 MB.' };
    if (shot.length < PNG_SIGNATURE.length || !shot.subarray(0, 8).equals(PNG_SIGNATURE)) return { ok: false, message: 'The screenshot was not valid.' };
  }
  return { ok: true, text: trimmed, shot };
}

/** The request handed to Bunny's window: a NEW chat in Chat mode, no folder, the message as plain data, the screenshot as an ordinary image attachment. */
export function buildNewChatRequest(text, shot) {
  return {
    text,
    workMode: 'chat',
    folder: null,
    files: shot ? [{ name: 'Screenshot.png', mime: 'image/png', kind: 'image', data: `data:image/png;base64,${shot.toString('base64')}`, size: shot.length }] : [],
  };
}
