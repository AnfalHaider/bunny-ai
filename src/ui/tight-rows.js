// TIGHT-ROWS (v0.1.14, the owner's go; Design's drawing 5e0f5a4): one row of about 52 px per item, the same on Customize (Connectors, Skills, Plugins) and Automation: a small logo, the name
// with a one-line dim description under it, the switch on the same line at the right, and everything else folded into a "..." menu. Words that only say "Not checked" are gone: a chip shows
// only when something needs the person. Every action a row had is still there, one tap further.
// This file builds the row and the menu (plain DOM, nothing page-specific); the pages say what each row holds.

const make = (doc, tag, props = {}, ...kids) => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'className') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
};

/** The first letter or digit of a name, for the small logo. */
export const initial = (name) => (String(name).match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase();

let openMenu = null; // the one menu that is open: opening another, pressing Esc or clicking elsewhere closes it
const closeOpen = () => { if (openMenu) { openMenu.close(); openMenu = null; } };

/**
 * The "..." button and its menu. `items` are { label, hint, danger, checked, disabled, run } or '-' for a line. A menu item that runs closes the menu.
 * Keyboard: Enter or Space opens it, Down and Up move, Esc closes and gives the focus back to the button.
 */
export function actionMenu(doc, { name, items }) {
  const shown = items.filter(Boolean);
  const wrap = make(doc, 'span', { className: 'tr-more' });
  const button = make(doc, 'button', { type: 'button', className: 'tr-mn', 'aria-label': `More for ${name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', text: '···' });
  wrap.append(button);
  let menu = null;
  const close = () => { menu?.remove(); menu = null; button.setAttribute('aria-expanded', 'false'); };
  const focusItem = (step) => {
    const all = [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
    if (!all.length) return;
    const at = all.indexOf(doc.activeElement);
    all[(at + step + all.length) % all.length].focus();
  };
  const open = () => {
    closeOpen();
    menu = make(doc, 'div', { className: 'tr-menu', role: 'menu', 'aria-label': `Actions for ${name}` });
    for (const it of shown) {
      if (it === '-') { menu.append(make(doc, 'hr')); continue; }
      const b = make(doc, 'button', { type: 'button', role: 'menuitem', className: it.danger ? 'is-danger' : '', disabled: it.disabled ? '' : null },
        make(doc, 'span', { text: `${it.checked ? '✓ ' : ''}${it.label}` }), it.hint ? make(doc, 'small', { text: it.hint }) : null);
      b.addEventListener('click', async (e) => { e.stopPropagation(); close(); openMenu = null; await it.run?.(e); });
      menu.append(b);
    }
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(-1); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); openMenu = null; button.focus(); }
      else if (e.key === 'Tab') { close(); openMenu = null; }
    });
    wrap.append(menu);
    button.setAttribute('aria-expanded', 'true');
    openMenu = { close };
    focusItem(1);
  };
  button.addEventListener('click', (e) => { e.stopPropagation(); if (menu) { close(); openMenu = null; } else open(); });
  if (!doc.__trMenuClose) {
    doc.__trMenuClose = true;
    doc.addEventListener('click', (e) => { if (openMenu && !e.target.closest?.('.tr-more')) closeOpen(); });
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOpen(); });
  }
  return wrap;
}

/**
 * One row. `chips` are { text, tone } ('warn' | 'bad' | '' ): shown only when something needs the person, and for "Plugin". `dim` is the one dim line under the name (cut with an ellipsis;
 * the whole text is its tooltip). `primary` is { label, run } (a button that stays visible while something needs doing: Sign in, Cancel, Add); `switch` is { on, label, change }.
 * `extra` is a node under the dim line (the client-ID box of a sign-in). `items` fill the "..." menu; none, no menu.
 */
export function tightRow(doc, { className = '', role = 'row', checkbox = null, name, tile = name, chips = [], dim = '', extra = null, primary = null, status = null, toggle = null, toggleNode = null, items = [], boxSpace = true }) {
  const row = make(doc, 'div', { className: `tr-row ${className}`.trim(), role, 'data-name': name });
  if (checkbox) row.append(checkbox); else if (boxSpace) row.append(make(doc, 'span', { className: 'tr-cb-space', 'aria-hidden': 'true' })); else row.classList.add('tr-nobox');
  row.append(make(doc, 'span', { className: 'tr-tile', 'aria-hidden': 'true', text: initial(tile) }));
  const l1 = make(doc, 'div', { className: 'tr-l1' }, make(doc, 'b', { text: name }),
    ...chips.map((c) => make(doc, 'span', { className: `tr-chip${c.tone ? ` is-${c.tone}` : ''}`, text: c.text })));
  const text = make(doc, 'div', { className: 'tr-name' }, l1, dim ? make(doc, 'div', { className: 'tr-l2', title: dim, text: dim }) : null, extra);
  row.append(text);
  const right = make(doc, 'div', { className: 'tr-right' });
  if (primary) right.append(make(doc, 'button', { type: 'button', className: 'tr-primary', text: primary.label, onclick: (e) => primary.run(e) }));
  if (status) right.append(status);
  if (toggle) {
    right.append(make(doc, 'button', {
      type: 'button', className: 'toggle tr-switch', role: 'switch', 'aria-checked': String(Boolean(toggle.on)), 'aria-label': toggle.label,
      onclick: async (e) => { e.currentTarget.disabled = true; await toggle.change(!toggle.on); },
    }));
  }
  if (toggleNode) right.append(toggleNode); // a page's own switch (Automation keeps its checkbox switch)
  if (items.filter(Boolean).length) right.append(actionMenu(doc, { name, items }));
  row.append(right);
  return row;
}
