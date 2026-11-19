// BANNER-NOTICE, the chip's tap panel (Design's drawing, approved): a small panel under the top bar with who is signed in and at which level, when they were last seen, a way to each device's Activity,
// and Turn off and Settings. Under 480 px it is 12 px in from each side; wider it is a 320 px panel under the chip. It is a panel the person asks for (a tap), never a notice that appears by itself.
// The event the chip was saying is said at the top: a setting changed from a device offers that device's Activity; the internet shut-off says why the route closed.
// Names and times only. It writes nothing and stores nothing: Turn off is the window's own existing call (made by the caller).
import { LEVEL_NAMES, clock } from './device-access.js';
import { eventText } from './remote-notice.js';

const el = (doc, tag, props = {}, ...kids) => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v); }
  e.append(...kids);
  return e;
};

/** Close the panel if it is open. Returns true when it was. */
export function closePanel(doc) {
  const p = doc.getElementById('remote-panel');
  if (!p) return false;
  p.remove();
  doc.getElementById('remote-chip')?.setAttribute('aria-expanded', 'false');
  return true;
}

/**
 * Open the panel. `event` is what the chip was saying ({ kind, device, label } or null). Callbacks: onActivity(deviceId), onSettings(), onTurnOff(), onClose().
 * Returns the panel element.
 */
export function openPanel(doc, status, { event = null, onActivity, onSettings, onTurnOff, onClose } = {}) {
  closePanel(doc);
  const devices = status?.devices ?? [];
  const panel = el(doc, 'div', { id: 'remote-panel', class: 'remote-panel', role: 'region', 'aria-label': 'Devices' });
  const shut = event?.kind === 'shutoff';
  panel.append(el(doc, 'b', { class: 'rp-title', text: shut ? 'Closed to the internet' : status?.enabled ? 'Open to devices' : 'Not open to devices' }));
  if (event) {
    const words = eventText(event);
    const line = el(doc, 'div', { class: `rp-event${words.bad ? ' is-bad' : ''}`, text: words.text });
    if (event.kind === 'setting' && event.device) line.append(' ', el(doc, 'button', { type: 'button', class: 'rp-link', 'data-act': 'activity', text: 'See Activity' }));
    panel.append(line);
  }
  if (status?.enabled) {
    const list = el(doc, 'div', { class: 'rp-list' });
    for (const d of devices) {
      const every = d.level === 'everything';
      const when = clock(d.lastSeen);
      list.append(el(doc, 'div', { class: 'rp-dev', 'data-device': d.id },
        el(doc, 'div', { class: 'rp-line' }, el(doc, 'span', { class: 'rp-name', text: d.label ?? 'A device' }), el(doc, 'span', { class: `rp-level${every ? ' is-bad' : ''}`, text: LEVEL_NAMES[d.level] ?? d.level ?? '' })),
        el(doc, 'div', { class: 'rp-sub' }, el(doc, 'span', { text: when ? `Last seen ${when}` : 'Signed in' }), ' · ', el(doc, 'button', { type: 'button', class: 'rp-link', 'data-act': 'device-activity', 'data-device': d.id, text: 'Activity' }))));
    }
    if (!devices.length) list.append(el(doc, 'div', { class: 'rp-sub', text: 'No device is signed in yet.' }));
    panel.append(list);
  }
  const actions = el(doc, 'div', { class: 'rp-actions' });
  if (status?.enabled) actions.append(el(doc, 'button', { type: 'button', class: 'rp-btn', 'data-act': 'turn-off', text: 'Turn off' }));
  actions.append(el(doc, 'button', { type: 'button', class: 'rp-btn rp-quiet', 'data-act': 'settings', text: 'Settings' }));
  panel.append(actions);
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'turn-off') { Promise.resolve(onTurnOff?.()).finally(() => { closePanel(doc); onClose?.(); }); return; }
    closePanel(doc); onClose?.();
    if (act === 'activity') onActivity?.(event.device);
    else if (act === 'device-activity') onActivity?.(b.dataset.device);
    else onSettings?.();
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(doc); onClose?.(); doc.getElementById('remote-chip')?.focus(); } });
  doc.body.append(panel);
  doc.getElementById('remote-chip')?.setAttribute('aria-expanded', 'true');
  panel.querySelector('button')?.focus?.();
  return panel;
}
