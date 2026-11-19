// v0.1.14 PHONE-LAYOUT (the owner approved Design's drawing, phone layout v3): on a phone the chat's top bar is  ☰ · title · chip · ⋯  (and the session overview from 390 px), and everything else is in
// the ⋯ menu: a bottom sheet under 480 px, a small menu under the button from 480 to 899 px. The buttons in the menu press the REAL toolbar buttons, so every panel opens exactly as before.
// The devices chip never goes into the menu (the state is never hidden). From 900 px up nothing changes: the menu button is not shown.
const I = {
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  ex: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
  ov: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  terminal: '<path d="M4 7l5 5-5 5M12 18h8"/>',
  diff: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M12 8v6M9 11h6M9 17h6"/>',
  browser: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5"/>',
  file: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  tasks: '<path d="M4 6l2 2 3-3M4 13l2 2 3-3M12 7h8M12 14h8M12 20h8"/>',
  pop: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
// [icon, label, the real button, where it shows: 'sheet' (a phone only), 'both', 'menu' (the small menu only)]
export const MORE_ITEMS = [
  ['ex', 'Export', '#export', 'sheet'],
  ['ov', 'Session overview', '#rail-toggle', 'sheet'],
  ['terminal', 'Terminal', '.toolbar [data-view="terminal"]', 'sheet'],
  ['diff', 'Changes', '.toolbar [data-view="diff"]', 'sheet'],
  ['browser', 'Browser', '.toolbar [data-view="browser"]', 'both'],
  ['file', 'Files', '.toolbar [data-view="file"]', 'both'],
  ['tasks', 'Tasks and plan', '.toolbar [data-view="tasks"]', 'both'],
  ['pop', 'Open in its own window', '#popout', 'menu'], // a phone cannot show a second window, so only the small menu offers it
];

export function bindPhoneBar(doc = document) {
  const bar = doc.querySelector('.topbar');
  if (!bar || doc.getElementById('more-button')) return;
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
  const button = doc.createElement('button');
  button.id = 'more-button'; button.type = 'button'; button.className = 'icon-btn more-button';
  button.setAttribute('aria-label', 'More'); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'more-menu');
  button.title = 'More'; button.innerHTML = svg('more');
  bar.append(button);
  const scrim = doc.createElement('div'); scrim.className = 'more-scrim'; scrim.hidden = true;
  const menu = doc.createElement('div'); menu.id = 'more-menu'; menu.className = 'more-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  const handle = doc.createElement('div'); handle.className = 'more-handle'; menu.append(handle);
  for (const [icon, label, target, where] of MORE_ITEMS) {
    const item = doc.createElement('button');
    item.type = 'button'; item.className = `more-item mi-${where}`; item.setAttribute('role', 'menuitem'); item.dataset.target = target;
    item.innerHTML = `${svg(icon)}<span></span>`; item.lastChild.textContent = label;
    menu.append(item);
  }
  doc.body.append(scrim, menu);
  const close = (focus = false) => { menu.hidden = true; scrim.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); };
  const open = () => { menu.hidden = false; scrim.hidden = false; button.setAttribute('aria-expanded', 'true'); [...menu.querySelectorAll('.more-item')].find((i) => i.offsetParent)?.focus(); };
  button.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) open(); else close(); });
  scrim.addEventListener('click', () => close());
  doc.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#more-menu, #more-button')) close(); });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.more-item'); if (!item) return;
    close();
    doc.querySelector(item.dataset.target)?.click(); // the real button: the panel opens exactly as before
  });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); close(true); } }, true);
  doc.defaultView?.addEventListener('resize', () => { if (!menu.hidden && !button.offsetParent) close(); });
}
