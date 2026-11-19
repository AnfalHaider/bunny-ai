// BANNER-NOTICE (v0.1.14, the owner's go; Design's drawing v3, Security's BN-1 to BN-5): the "Open to other devices" banner is a notification the person can dismiss, and the STATE is never hidden:
//  - Bunny's window keeps a small chip in its top bar for as long as access is open ("Open to devices · N"; in the warning colour and in words while a device has Everything);
//  - the banner comes back by itself when a device signs in, when a device is raised to Everything, when access is turned on or reopened, and whenever the window starts or reloads;
//  - a dismissal lives only in the page's memory: nothing is saved (no setting, localStorage, cookie or file), and no server route is added or used for it (BN-4, BN-5).
// This file holds the words and the rules (plain functions, tested in node) and the drawing of the chip and the notification.
import { everythingDevices } from './device-access.js';

export const AUTO_HIDE_MS = 10_000; // the plain banner hides itself after this; one with Everything in it never does

/** The chip's words: { text, short, bad }. `short` is what a narrow window shows. Never empty while access is open. */
export function chipText(status) {
  const every = everythingDevices(status);
  if (every.length === 1) return { text: `${every[0].label} has Everything`, short: 'Everything', bad: true };
  if (every.length > 1) return { text: `Everything: ${every.length} devices`, short: 'Everything', bad: true };
  const n = status?.signedIn ?? 0;
  return { text: n ? `Open to devices · ${n}` : 'Open to devices', short: n ? `Open · ${n}` : 'Open', bad: false };
}

/** The notification's words: { title, message, bad }. */
export function bannerText(status) {
  const every = everythingDevices(status);
  if (every.length) {
    const lead = every.length === 1 ? every[0].label : `${every.length} devices`;
    return { title: every.length === 1 ? `${lead} has Everything` : `Everything: ${lead}`, message: `${every.length === 1 ? 'It can' : 'They can'} run programs and change settings. Ends after 30 minutes idle.`, bad: true };
  }
  const n = status?.signedIn ?? 0;
  return { title: `Open to other devices${n ? ` · ${n} signed in` : ''}`, message: n ? `${status.devices?.at?.(-1)?.label ?? 'A device'} signed in. It works as Chats. Change this in Settings.` : 'No device is signed in yet.', bad: false };
}

/**
 * Must the notification show again, given what the window last saw (`prev`, null at the first look) and what it sees now?
 * Yes: the first look (the window started or reloaded); access just turned on or reopened; a device signed in; a device is newly at Everything.
 */
export function bannerReturns(prev, now) {
  if (!now?.enabled) return false;
  if (!prev?.enabled) return true;
  // BN-L1: a new sign-in is a device id that was not there before (not a higher count: one signing out and another signing in between two looks keeps the count the same)
  const known = new Set((prev.devices ?? []).map((d) => d.id));
  if ((now.devices ?? []).some((d) => !known.has(d.id))) return true;
  if ((now.signedIn ?? 0) > (prev.signedIn ?? 0) && !(now.devices ?? []).length) return true; // a status that carries no list: the count is all there is
  const before = new Set(everythingDevices(prev).map((d) => d.id));
  return everythingDevices(now).some((d) => !before.has(d.id));
}

/** The chip, in the window's top bar (left of Export). A click brings the notification back. Returns the chip, or null while access is off. */
export function paintChip(doc, status, { onClick }) {
  let chip = doc.getElementById('remote-chip');
  if (!status?.enabled) { chip?.remove(); return null; }
  const words = chipText(status);
  if (!chip) {
    chip = doc.createElement('button');
    chip.id = 'remote-chip';
    chip.type = 'button';
    chip.setAttribute('role', 'status');
    chip.addEventListener('click', () => onClick());
    const bar = doc.querySelector('.topbar');
    const toolbar = bar?.querySelector('.toolbar');
    if (bar && toolbar) bar.insertBefore(chip, toolbar); else (bar ?? doc.body).append(chip);
  }
  chip.className = `remote-chip${words.bad ? ' is-bad' : ''}`;
  chip.dataset.level = words.bad ? 'everything' : 'open';
  chip.title = 'Open to other devices: click for details';
  chip.setAttribute('aria-label', `${words.text}. Press for details.`);
  chip.replaceChildren();
  const long = doc.createElement('span'); long.className = 'lg'; long.textContent = words.text;
  const short = doc.createElement('span'); short.className = 'sh'; short.textContent = words.short;
  chip.append(long, short);
  return chip;
}

/** The notification under the top bar, with × (and Esc while it has focus). `actions` are { label, run } buttons. Returns the element. */
export function paintNote(doc, status, { actions = [], onDismiss, autoHide = false }) {
  doc.getElementById('remote-note')?.remove();
  const words = bannerText(status);
  const box = doc.createElement('div');
  box.id = 'remote-note';
  box.className = `remote-note${words.bad ? ' is-bad' : ''}`;
  box.setAttribute('role', 'status');
  box.dataset.level = words.bad ? 'everything' : 'open';
  const head = doc.createElement('div'); head.className = 'rn-head';
  const title = doc.createElement('span'); title.textContent = words.title;
  const x = doc.createElement('button'); x.type = 'button'; x.className = 'rn-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Dismiss'); x.title = 'Dismiss';
  x.addEventListener('click', () => onDismiss());
  head.append(title, x);
  const msg = doc.createElement('span'); msg.className = 'rn-msg'; msg.textContent = words.message;
  const row = doc.createElement('div'); row.className = 'rn-actions';
  for (const a of actions) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = a.label; b.addEventListener('click', () => a.run()); row.append(b); }
  box.append(head, msg, row);
  if (autoHide) { const bar = doc.createElement('div'); bar.className = 'rn-countdown'; bar.style.animationDuration = `${AUTO_HIDE_MS}ms`; box.append(bar); }
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss(); } });
  doc.body.append(box);
  return box;
}
