// BANNER-NOTICE (Security's BN ruling: the tray tooltip mirrors the chip, including the newest event's words). The page sends FIXED fields only: a kind from a short list and a device's name.
// The words are made here, not taken from the page, and the name is cut and stripped of control characters, so a page can never put its own sentence in the tray.
const KINDS = new Set(['signin', 'everything', 'setting', 'shutoff']);

/** The event a page may report: { kind, label } or null. Anything else is dropped. */
export function cleanTrayEvent(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind)) return null;
  const label = typeof raw.label === 'string' ? raw.label.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return { kind: raw.kind, label: label || 'A device' };
}

/** The tray's words: the state, and the newest event after it. */
export function trayTooltip(enabled, event) {
  const state = enabled ? 'Bunny AI: Open to other devices' : 'Bunny AI';
  if (!event) return state;
  const words = event.kind === 'signin' ? `New: ${event.label} signed in`
    : event.kind === 'everything' ? `${event.label} has Everything`
    : event.kind === 'setting' ? `${event.label} changed a setting`
    : 'Closed to the internet: too many wrong passcodes';
  return `${state} · ${words}`;
}
