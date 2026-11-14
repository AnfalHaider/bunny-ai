/**
 * Layout of the side panel and the sidebar:
 *   - the panel can be dragged wider or narrower (or taller, when docked at the bottom);
 *   - it can be docked right, left or bottom, or expanded to fill the chat area;
 *   - "Open in new window" pops the browser tab (or the chat) into its own window;
 *   - the sidebar can be hidden (Ctrl+B).
 * Choices are remembered in localStorage.
 */
const $ = (id) => document.getElementById(id);
const KEY = 'bunny.paneLayout';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const write = (patch) => { const next = { ...read(), ...patch }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window */ } return next; };

export function initPaneLayout({ onNewWindow } = {}) {
  const app = $('app');
  const pane = $('pane');
  if (!app || !pane) return null;

  function apply(state = read()) {
    const dock = ['right', 'left', 'bottom'].includes(state.dock) ? state.dock : 'right';
    app.classList.toggle('pane-left', dock === 'left');
    app.classList.toggle('pane-bottom', dock === 'bottom');
    app.classList.toggle('pane-fill', Boolean(state.fill));
    if (state.width) app.style.setProperty('--pane-w', `${state.width}px`);
    if (state.height) app.style.setProperty('--pane-h', `${state.height}px`);
    app.classList.toggle('sidebar-collapsed', Boolean(state.sidebarHidden));
    const toggle = $('sidebar-collapse');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(!state.sidebarHidden));
      toggle.title = `${state.sidebarHidden ? 'Show' : 'Hide'} sidebar (Ctrl+B)`;
      toggle.setAttribute('aria-label', state.sidebarHidden ? 'Show sidebar' : 'Hide sidebar');
    }
    document.querySelectorAll('[data-dock]').forEach((b) => b.classList.toggle('is-selected', b.dataset.dock === dock));
    document.querySelectorAll('[data-fill]').forEach((b) => b.classList.toggle('is-selected', String(Boolean(state.fill)) === b.dataset.fill));
  }

  // ---- drag to resize ----
  const handle = document.createElement('div');
  handle.className = 'pane-resizer';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Resize panel');
  handle.tabIndex = 0;
  pane.prepend(handle);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    app.classList.add('is-resizing');
    const bottom = app.classList.contains('pane-bottom');
    const left = app.classList.contains('pane-left');
    const move = (ev) => {
      if (bottom) {
        const h = Math.round(Math.min(Math.max(window.innerHeight - ev.clientY, 160), window.innerHeight * 0.8));
        app.style.setProperty('--pane-h', `${h}px`);
      } else {
        const rect = app.getBoundingClientRect();
        const sidebar = app.classList.contains('sidebar-collapsed') ? 0 : ($('app').querySelector('.sidebar')?.getBoundingClientRect().width ?? 0);
        const w = left ? ev.clientX - rect.left - sidebar : rect.right - ev.clientX;
        app.style.setProperty('--pane-w', `${Math.round(Math.min(Math.max(w, 280), window.innerWidth * 0.75))}px`);
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      app.classList.remove('is-resizing');
      write(bottom
        ? { height: parseInt(getComputedStyle(app).getPropertyValue('--pane-h'), 10) || undefined }
        : { width: parseInt(getComputedStyle(app).getPropertyValue('--pane-w'), 10) || undefined });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
  });
  // keyboard: arrows resize by 24px
  handle.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const s = read();
    if (app.classList.contains('pane-bottom')) {
      const h = (s.height ?? 320) + (e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0);
      apply(write({ height: Math.max(160, h) }));
    } else {
      const grow = app.classList.contains('pane-left') ? e.key === 'ArrowRight' : e.key === 'ArrowLeft';
      const w = (s.width ?? 400) + (grow ? 24 : -24);
      apply(write({ width: Math.min(Math.max(280, w), window.innerWidth * 0.75) }));
    }
  });

  // ---- the layout menu: one shared menu, opened from a button in each panel head ----
  const menu = $('pane-layout-menu');
  function openMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    apply();
  }
  for (const close of document.querySelectorAll('.pane [data-close], #artifacts-close')) {
    const b = document.createElement('button');
    b.className = 'icon-btn pane-layout-btn';
    b.setAttribute('aria-label', 'Panel layout');
    b.setAttribute('aria-haspopup', 'menu');
    b.title = 'Panel layout';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
    b.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) openMenu(b); else menu.hidden = true; });
    close.before(b);
  }
  menu?.addEventListener('click', (e) => {
    const item = e.target.closest('button');
    if (!item) return;
    if (item.dataset.dock) apply(write({ dock: item.dataset.dock, fill: false }));
    if (item.dataset.fill) apply(write({ fill: item.dataset.fill === 'true' }));
    if (item.dataset.action === 'window') { menu.hidden = true; onNewWindow?.(); }
  });
  document.addEventListener('click', (e) => { if (menu && !menu.hidden && !e.target.closest('#pane-layout-menu')) menu.hidden = true; });

  // ---- sidebar ----
  function toggleSidebar() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      $('sidebar-toggle')?.click();
      return;
    }
    apply(write({ sidebarHidden: !read().sidebarHidden }));
  }
  $('sidebar-collapse')?.addEventListener('click', toggleSidebar);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSidebar(); }
  });

  apply();
  return { apply, toggleSidebar };
}
