// BANNER-NOTICE (v0.1.14; the owner: "No banner on top is required", everywhere; Security's BN-2 and BN-4 to BN-9): there is NO banner or notice for device access, in the window, in a browser page
// on this PC or on a device's page. One small chip in the top bar does the whole job, for as long as access is open:
//  - it says the STATE ("Open to devices · N", in the warning colour and in words while a device has Everything);
//  - when something NEW happens (a device signs in, a device is raised to Everything, a device changes a setting) it says what happened ("New: Pixel 8 signed in"), with a count badge
//    when more than one thing is waiting, is announced once (aria-live polite) and may pulse (never with reduced motion, and never as the only sign);
//  - it does not go back by itself: a click opens the devices list (or that device's Activity for a setting change) and clears what waited. Nothing is stored (BN-4): a reload shows the state words.
// This file holds the words and the rules (plain functions, tested in node) and the drawing of the chip.
import { everythingDevices } from './device-access.js';

/** The chip's state words: { text, short, bad }. `short` is what a narrow window shows. Never empty while access is open. */
export function chipText(status) {
  const every = everythingDevices(status);
  if (every.length === 1) return { text: `${every[0].label} has Everything`, short: 'Everything', bad: true };
  if (every.length > 1) return { text: `Everything: ${every.length} devices`, short: 'Everything', bad: true };
  const n = status?.signedIn ?? 0;
  return { text: n ? `Open to devices · ${n}` : 'Open to devices', short: n ? `Open · ${n}` : 'Open', bad: false };
}

/** What a waiting event says: { text, short, bad }. kinds: 'signin', 'everything', 'setting', and 'shutoff' (the internet route's flood shut-off; OPEN-SIGNIN supplies it, see below). */
export function eventText(ev) {
  const who = ev?.label || 'A device';
  if (ev?.kind === 'shutoff') return { text: 'Closed to the internet: too many wrong passcodes', short: 'Closed: wrong passcodes', bad: true };
  if (ev?.kind === 'setting') return { text: `${who} changed a setting`, short: 'Setting changed', bad: true };
  if (ev?.kind === 'everything') return { text: `${who} has Everything`, short: 'Everything', bad: true };
  return { text: `New: ${who} signed in`, short: 'New sign-in', bad: false };
}

/**
 * The new things between what the window last saw (`prev`, null at the first look) and what it sees now: a device id that was not there before is a sign-in (BN-L1: ids, not the count, so one
 * signing out and another signing in between two looks still counts); a device newly at Everything is its own event. The first look, and access just turned on, give none: they show the state words.
 */
export function newEvents(prev, now) {
  if (!now?.enabled || !prev?.enabled) return [];
  const out = [];
  const known = new Set((prev.devices ?? []).map((d) => d.id));
  const before = new Set(everythingDevices(prev).map((d) => d.id));
  const everyNow = new Set(everythingDevices(now).map((d) => d.id));
  for (const d of now.devices ?? []) {
    if (!known.has(d.id)) out.push({ kind: 'signin', device: d.id, label: d.label });
    if (everyNow.has(d.id) && !before.has(d.id)) out.push({ kind: 'everything', device: d.id, label: d.label });
  }
  return out;
}

/**
 * OPEN-SIGNIN hook (BN-7): the internet route's flood shut-off is an event that stays visible even when no access is open any more. It comes from the SAVED `status.shutoffAt` (a timestamp the server
 * keeps), never from a saved dismissal: `acknowledged` is a variable of the page, so a click clears it for that page only and a reload shows it again until the window's Settings row clears it.
 * Returns the events to show: the waiting ones, then the shut-off (the most important last, so it is the one the chip says).
 */
export function shownEvents(status, events = [], acknowledged = false) {
  return status?.shutoffAt && !acknowledged ? [...events, { kind: 'shutoff' }] : events;
}

/** What the chip shows given the state and the waiting events: { text, short, bad, count, kind }. The newest event wins; the state words when nothing waits. */
export function chipView(status, events = []) {
  if (!events.length) return { ...chipText(status), count: 0, kind: null };
  const latest = events[events.length - 1];
  const w = eventText(latest);
  // a device at Everything keeps the chip red whatever the event says
  return { ...w, bad: w.bad || chipText(status).bad, count: events.length, kind: latest.kind };
}

/** The chip, in the top bar (left of Export). Returns the chip, or null while access is off. Redrawn only when its words change, so a screen reader hears each event once. */
export function paintChip(doc, status, { events = [], onClick, reducedMotion = false } = {}) {
  let chip = doc.getElementById('remote-chip');
  const shut = events.some((e) => e.kind === 'shutoff');
  if (!status?.enabled && !shut) { chip?.remove(); return null; } // a shut-off stays on the chip even with access closed
  const v = chipView(status, events);
  const sig = `${v.text}|${v.count}|${v.bad}|${v.kind}`;
  if (!chip) {
    chip = doc.createElement('button');
    chip.id = 'remote-chip';
    chip.type = 'button';
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    const bar = doc.querySelector('.topbar');
    const toolbar = bar?.querySelector('.toolbar');
    if (bar && toolbar) bar.insertBefore(chip, toolbar); else (bar ?? doc.body).append(chip);
  }
  chip.onclick = () => onClick?.();
  if (chip.dataset.sig === sig) return chip;
  chip.dataset.sig = sig;
  chip.className = `remote-chip${v.bad ? ' is-bad' : ''}${v.count && !reducedMotion ? ' is-new' : ''}`;
  chip.dataset.level = v.bad ? 'everything' : 'open';
  chip.dataset.event = v.kind ?? '';
  chip.title = v.count ? `${v.text}: click for details` : 'Open to other devices: click for details';
  chip.setAttribute('aria-label', `${v.text}${v.count > 1 ? `, ${v.count} new` : ''}. Press for details.`);
  chip.replaceChildren();
  const long = doc.createElement('span'); long.className = 'lg'; long.textContent = v.text;
  const short = doc.createElement('span'); short.className = 'sh'; short.textContent = v.short;
  chip.append(long, short);
  if (v.count > 1) { const badge = doc.createElement('span'); badge.className = 'rc-badge'; badge.textContent = String(v.count); chip.append(badge); }
  return chip;
}
