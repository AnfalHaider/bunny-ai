// DEVICE-FULL (owner approved Design's drawing, version 5): what Bunny's window shows about the access level of each signed-in device.
//  - the choice when a device first signs in, and the same choice from Settings → Change (one dialog, the warning before Everything every time)
//  - the line that names the devices that have Everything
//  - the Activity view (what a device did, by name; the limit of that record is said under the list)
// The wording of WARNING and IDLE_NOTE is Security's (R-DF1). Only Bunny's window sets a level; a device never reaches any of this.

export const WARNING = "Everything lets this device do anything you can do on this PC: run programs, change settings, read your files and saved keys. The connection is not encrypted, so on a network you don't fully trust, someone could take over this device's access. Give it only on your own home network, to a device you own. Signing the device out stops it, but does not undo what it already did.";
export const IDLE_NOTE = 'Everything ends by itself after 30 minutes without use, and when the device signs out or Bunny restarts.';
export const IDLE_SHORT = 'Ends after 30 min idle';
export const ACTIVITY_INTRO = "What this device did, newest first. Names only: never the details of a command, a file or a setting. Kept for the last 500 entries or 30 days. Only visible in Bunny's window.";
export const ACTIVITY_LIMIT_TITLE = 'What this list can and cannot tell you';
export const ACTIVITY_LIMIT = 'This shows what devices did, unless one set out to hide it. A device with Everything can run commands, so it could change this record. Use it to notice something odd, not as proof that nothing happened.';
export const DEVICE_ACCESS_SENTENCE = "Only Bunny's window can change device access.";
export const LEVEL_NAMES = { chats: 'Chats', everything: 'Everything' };
export const LEVEL_HELP = {
  chats: 'Chats with tools. Not computer control, installs, connectors, schedules, memory or settings.',
  everything: 'The same as this window: every tool and every setting. Ends after 30 minutes idle.',
};

/** The names of the devices that have Everything, from the status the server gives the window. */
export const everythingDevices = (status) => (Array.isArray(status?.devices) ? status.devices.filter((d) => d.level === 'everything') : []);

/** The window's status line, as parts: the usual text, and (when a device has Everything) the part that names them, shown in bold. */
export function statusParts(status, autoSuffix = '') {
  const auto = status?.autoChats?.length ?? 0;
  const base = `Open to other devices · ${status?.signedIn ?? 0} signed in${auto ? ` · ${auto} chat${auto === 1 ? '' : 's'} on Auto from a device${autoSuffix}` : ''}`;
  const names = everythingDevices(status).map((d) => d.label);
  if (!names.length) return { base, strong: '' };
  return { base, strong: names.length === 1 ? `${names[0]} has Everything` : `Everything: ${names.join(', ')}` };
}

/** Time of day as the drawing shows it (14:12); anything that is not a date is empty. */
export function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** One log entry, said in the drawing's words: { when, what, note, bad }. Never an argument or a value: the server never keeps them. */
export function describeAction(e) {
  const when = clock(e.at);
  const level = LEVEL_NAMES[e.level] ?? e.level ?? '';
  if (e.kind === 'signin') return { when, what: 'Signed in', note: `At the ${LEVEL_NAMES.chats} level`, bad: false };
  if (e.kind === 'idle-signout') return { when, what: 'Signed out', note: e.level === 'everything' ? 'Ended: 30 minutes idle' : 'Ended: idle for 2 hours', bad: false };
  if (e.kind === 'level') return { when, what: `Level changed to ${level}`, note: "By Bunny's window", bad: e.level === 'everything' };
  if (e.kind === 'tool') return { when, what: `Tool: ${e.tool ?? 'unknown'}`, note: 'Run by this device', bad: e.tool === 'run_command' };
  if (e.kind === 'route') {
    if (e.method === 'PUT' && e.path === '/api/settings') return { when, what: 'Setting changed', note: 'PUT /api/settings (a setting; no value shown)', bad: true };
    return { when, what: 'Changed something in Bunny', note: `${e.method ?? ''} ${e.path ?? ''}`.trim(), bad: true };
  }
  return { when, what: 'Did something', note: '', bad: false };
}

const css = (el, text) => { el.style.cssText = text; return el; };
const make = (doc, tag, props = {}, ...kids) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') el.textContent = v;
    else if (k === 'style') css(el, v);
    else if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.filter(Boolean));
  return el;
};
const BAD = 'var(--bad,#cf3f55)';
const BAD_SOFT = 'var(--bad-soft,rgba(207,63,85,.10))';
const ACCENT = 'var(--accent,#6a4fd8)';
const LINE = 'var(--line,#e6e2da)';
const DIM = 'var(--text-dim,#62666f)';

/** The level pill drawn beside a device's name. */
export function levelPill(doc, level) {
  const all = level === 'everything';
  return make(doc, 'span', { class: 'level-pill', 'data-level': level, text: LEVEL_NAMES[level] ?? level, style: `display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;border-radius:999px;padding:1px 9px;border:1px solid ${all ? BAD : ACCENT};color:${all ? BAD : ACCENT};background:${all ? BAD_SOFT : 'var(--accent-soft,rgba(106,79,216,.08))'};white-space:nowrap` });
}

/** The red box with Security's warning. */
export function warningBox(doc, { title = 'A device has Everything', idle = false } = {}) {
  const box = make(doc, 'div', { class: 'everything-warning', role: 'note', style: `border:1px solid ${BAD};background:${BAD_SOFT};border-radius:10px;padding:9px 12px;font-size:13px;display:grid;gap:4px;margin-top:8px;text-align:left` });
  box.append(make(doc, 'b', { text: title, style: `color:${BAD}` }), make(doc, 'div', { text: WARNING }));
  if (idle) box.append(make(doc, 'div', { style: 'margin-top:4px' }, make(doc, 'b', { text: "Ends after 30 minutes idle. " }), IDLE_NOTE));
  return box;
}

/**
 * The choice: "<device> signed in. What may it do?" (first sign-in) or "What may <device> do?" (Settings → Change).
 * Resolves 'chats' (Keep Chats), 'everything' (Give Everything, only after the warning was on screen) or null (Not now, Escape).
 */
export function chooseLevel(doc, { label, current = 'chats', first = true } = {}) {
  return new Promise((resolve) => {
    let picked = current === 'everything' ? 'everything' : 'chats';
    const previous = doc.activeElement;
    const scrim = make(doc, 'div', { id: 'level-dialog', style: 'position:fixed;inset:0;z-index:2147482000;background:rgba(20,21,24,.45);display:grid;place-items:center;padding:14px' });
    const dlg = make(doc, 'div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'level-title', style: 'width:460px;max-width:100%;max-height:100%;overflow:auto;background:var(--surface,#fff);color:var(--text,#1f2023);border:1px solid var(--line,#e6e2da);border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.35);padding:18px 20px;display:grid;gap:10px;font:14px/1.5 var(--font-sans,system-ui,sans-serif);text-align:left' });
    dlg.append(make(doc, 'h4', { id: 'level-title', text: first ? `${label} signed in. What may it do?` : `What may ${label} do?`, style: 'margin:0;font-size:16px' }));
    dlg.append(make(doc, 'div', { text: first ? 'It works as Chats right now. You can change this at any time in Settings.' : 'You can change this at any time. Chats takes effect at once.', style: `color:${DIM};font-size:13px` }));
    const group = make(doc, 'div', { role: 'radiogroup', 'aria-label': 'What this device may do', style: 'display:grid;gap:8px' });
    const warn = make(doc, 'div');
    const acts = make(doc, 'div', { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px' });
    const notNow = make(doc, 'button', { type: 'button', class: 'btn', id: 'level-not-now', text: 'Not now' });
    const go = make(doc, 'button', { type: 'button', class: 'btn', id: 'level-go' });
    const options = {};
    const paint = () => {
      for (const [level, o] of Object.entries(options)) {
        const on = level === picked;
        o.input.checked = on;
        o.label.style.borderColor = on ? ACCENT : LINE;
        o.label.style.background = on ? 'var(--accent-soft,rgba(106,79,216,.08))' : 'var(--bg,#faf9f6)';
      }
      warn.replaceChildren();
      if (picked === 'everything') warn.append(warningBox(doc, { title: 'Before you give Everything', idle: true }));
      go.textContent = picked === 'everything' ? 'Give Everything' : (first ? 'Keep Chats' : 'Use Chats');
      go.style.cssText = picked === 'everything' ? `border-color:${BAD};color:${BAD}` : 'background:var(--ink,#1f2023);color:var(--on-ink,#faf9f6);border-color:var(--ink,#1f2023)';
    };
    for (const level of ['chats', 'everything']) {
      const input = make(doc, 'input', { type: 'radio', name: 'device-level', value: level, style: 'margin-top:3px' });
      const pill = levelPill(doc, level);
      pill.textContent = level === 'chats' ? 'Default' : 'Full access';
      const text = make(doc, 'div', {}, make(doc, 'b', { text: `${LEVEL_NAMES[level]} `, style: 'font-size:14px' }, pill), make(doc, 'div', { text: LEVEL_HELP[level], style: `font-size:12.5px;color:${DIM}` }));
      const lab = make(doc, 'label', { style: `border:1px solid ${LINE};border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start;cursor:pointer` }, input, text);
      input.addEventListener('change', () => { picked = level; paint(); });
      options[level] = { input, label: lab };
      group.append(lab);
    }
    const done = (value) => { scrim.remove(); doc.removeEventListener('keydown', onKey, true); previous?.focus?.(); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    notNow.addEventListener('click', () => done(null));
    go.addEventListener('click', () => done(picked));
    acts.append(notNow, go);
    dlg.append(group, warn, acts);
    scrim.append(dlg);
    paint();
    doc.body.append(scrim);
    doc.addEventListener('keydown', onKey, true);
    options[picked].input.focus();
  });
}

/** The status line's text: the usual words, then (bold) who has Everything. Replaces the children of `host`. */
export function paintStatus(doc, host, status, autoSuffix = '') {
  const { base, strong } = statusParts(status, autoSuffix);
  host.replaceChildren(base);
  if (strong) host.append(' · ', make(doc, 'b', { class: 'everything-names', text: strong }));
}

/** The Activity view for one device: the log, newest first, and what it cannot tell you. Pass `entries` already filtered to the device. */
export function activityView(doc, { label, entries, onBack }) {
  const root = make(doc, 'div', { class: 'device-activity', style: 'display:grid;gap:8px;text-align:left' });
  const head = make(doc, 'div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, make(doc, 'b', { text: `Activity · ${label}` }), make(doc, 'button', { type: 'button', class: 'btn', text: 'Back to devices', onclick: onBack }));
  root.append(head, make(doc, 'div', { class: 'desc', text: ACTIVITY_INTRO }));
  const list = make(doc, 'div', { role: 'list', style: `border:1px solid ${LINE};border-radius:10px;overflow:hidden` });
  if (!entries.length) list.append(make(doc, 'div', { class: 'desc', text: 'Nothing yet.', style: 'padding:9px 12px' }));
  entries.forEach((e, i) => {
    const a = describeAction(e);
    list.append(make(doc, 'div', { role: 'listitem', style: `display:flex;gap:14px;align-items:center;padding:9px 12px;font-size:13px;${i ? `border-top:1px solid ${LINE}` : ''}` },
      make(doc, 'span', { text: a.when, style: `width:52px;color:${DIM};font:12px var(--font-mono,monospace)` }),
      make(doc, 'div', { style: 'flex:1;min-width:0' }, make(doc, 'b', { text: a.what, style: a.bad ? `color:${BAD}` : '' }), make(doc, 'div', { text: a.note, style: `color:${DIM};font-size:12px` }))));
  });
  const limit = make(doc, 'div', { role: 'note', style: 'border:1px solid var(--warn,#c07a12);background:var(--warn-soft,rgba(192,122,18,.10));border-radius:10px;padding:9px 12px;font-size:13px;display:grid;gap:4px;margin-top:2px' }, make(doc, 'b', { text: ACTIVITY_LIMIT_TITLE, style: 'color:var(--warn,#c07a12)' }), make(doc, 'div', { text: ACTIVITY_LIMIT }));
  root.append(list, limit);
  return root;
}
