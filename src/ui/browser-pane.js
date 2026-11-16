/**
 * The browser panel: tabs, back / forward / reload, an address bar, a menu,
 * and a "dev server detected" card for the chat's folder.
 *
 * Each tab is an iframe with its own history list (an iframe's own history is
 * not readable across origins, so the panel keeps one). Some sites refuse to be
 * shown inside another app; the panel says so and offers to open them in the
 * person's own browser. The desktop app lifts that refusal for this panel.
 */
import { sendJSON } from './api.js';

const $ = (id) => document.getElementById(id);

function normaliseUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (/^(https?:|about:|blob:|data:)/i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text)) return `http://${text}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

function label(url) {
  if (!url) return 'New tab';
  if (url.startsWith('blob:')) return 'HTML file';
  try { return new URL(url).host || url; } catch { return url; }
}

/**
 * Is anything answering at this address? A no-cors request resolves for any answer (even an error page)
 * and rejects only when the connection itself fails, which is exactly "the server is not running".
 */
export async function reachable(url, ms = 2500) {
  if (!/^https?:/i.test(url)) return true;
  try { if (new URL(url).origin === location.origin) return true; } catch { return true; } // Bunny's own address: it is up (it is serving this page)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function initBrowserPane({ getFolder, runInTerminal }) {
  const host = $('browser-tabs-content');
  if (!host) return null;
  let tabs = [];
  let active = null;
  let nextId = 1;

  const current = () => tabs.find((t) => t.id === active);

  function paintTabs() {
    const bar = $('browser-tabbar');
    bar.replaceChildren();
    for (const tab of tabs) {
      const b = document.createElement('div');
      b.className = `browser-tab${tab.id === active ? ' is-active' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab.id === active));
      const name = document.createElement('button');
      name.className = 'browser-tab-name';
      name.textContent = label(tab.history[tab.index]);
      name.title = tab.history[tab.index] || 'New tab';
      name.addEventListener('click', () => select(tab.id));
      const close = document.createElement('button');
      close.className = 'browser-tab-close';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close tab');
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      b.append(name, close);
      bar.append(b);
    }
    const add = document.createElement('button');
    add.className = 'icon-btn browser-new';
    add.textContent = '＋';
    add.setAttribute('aria-label', 'New tab');
    add.addEventListener('click', () => newTab());
    bar.append(add);
  }

  function paintBar() {
    const tab = current();
    const url = tab?.history[tab.index] ?? '';
    $('browser-url').value = url.startsWith('blob:') ? (tab.fileName ?? 'HTML file') : url;
    $('browser-back').disabled = !tab || tab.index <= 0;
    $('browser-forward').disabled = !tab || tab.index >= tab.history.length - 1;
    $('browser-reload').disabled = !url;
    for (const t of tabs) t.frame.hidden = t.id !== active || !t.history[t.index];
    const empty = !url;
    $('browser-empty').hidden = !empty;
    $('browser-blocked').hidden = true;
    if (empty) paintDevServer();
  }

  // Shown in place of the browser's own error page when nothing answers at the address.
  function unreachableNote() {
    let note = $('browser-unreachable');
    if (!note) {
      note = document.createElement('div');
      note.id = 'browser-unreachable';
      note.className = 'browser-blocked';
      note.setAttribute('role', 'status');
      note.hidden = true;
      const text = document.createElement('p');
      const retry = document.createElement('button');
      retry.className = 'btn btn-sm';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => { const t = current(); if (t) show(t); });
      note.append(text, retry);
      host.append(note);
    }
    return note;
  }

  async function checkReachable(tab) {
    const url = tab.history[tab.index];
    const note = unreachableNote();
    if (!url || !/^https?:/i.test(url)) { note.hidden = true; return true; }
    const ok = await reachable(url);
    if (tab.history[tab.index] !== url || tab.id !== active) return ok; // the person moved on
    note.hidden = ok;
    if (!ok) note.firstChild.textContent = `Could not reach ${url}. Nothing is answering there: the server may not be running yet.`;
    return ok;
  }

  function show(tab) {
    const url = tab.history[tab.index];
    tab.frame.hidden = !url || tab.id !== active;
    if (url) tab.frame.src = url;
    unreachableNote().hidden = true;
    paintTabs();
    paintBar();
    if (url) checkReachable(tab);
  }

  function newTab(url = '') {
    const frame = document.createElement('iframe');
    frame.className = 'browser-frame';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');
    frame.title = 'Browser tab';
    frame.hidden = true;
    const tab = { id: nextId++, frame, history: url ? [url] : [''], index: 0 };
    // The desktop app finds the frame by this name when the model works the page.
    frame.name = `bunny-tab-${tab.id}`;
    host.append(frame);
    frame.addEventListener('load', () => checkBlocked(tab));
    tabs.push(tab);
    active = tab.id;
    show(tab);
    return tab;
  }

  function select(id) { active = id; const tab = current(); if (tab) show(tab); }

  function closeTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.history[tab.index]?.startsWith('blob:')) URL.revokeObjectURL(tab.history[tab.index]);
    tab.frame.remove();
    tabs = tabs.filter((t) => t.id !== id);
    if (!tabs.length) { newTab(); return; }
    if (active === id) active = tabs.at(-1).id;
    show(current());
  }

  function navigate(raw) {
    const url = normaliseUrl(raw);
    if (!url) return;
    const tab = current() ?? newTab();
    tab.history = tab.history.slice(0, tab.index + 1).filter(Boolean);
    tab.history.push(url);
    tab.index = tab.history.length - 1;
    show(tab);
  }

  // A cross-origin page that refused to be framed leaves an empty, unreadable frame.
  // Same-origin pages are readable; for others we can only hint after load.
  function checkBlocked(tab) {
    if (tab.id !== active) return;
    let blank = false;
    try {
      const doc = tab.frame.contentDocument;
      blank = Boolean(doc && doc.location.href === 'about:blank' && tab.history[tab.index] !== 'about:blank');
    } catch { blank = false; } // cross-origin and loaded: fine
    $('browser-blocked').hidden = !blank;
  }

  async function paintDevServer() {
    const card = $('browser-devserver');
    card.hidden = true;
    const folder = getFolder();
    if (!folder) return;
    try {
      const { devServer } = await sendJSON('/api/folder/devserver', 'POST', { folder });
      if (!devServer || !$('browser-empty') || $('browser-empty').hidden) return;
      $('devserver-port').textContent = `port ${devServer.port}${devServer.running ? ' · running' : ''}`;
      $('devserver-command').textContent = devServer.command;
      const use = $('devserver-use');
      use.textContent = devServer.running ? 'Open it' : 'Run and open';
      use.onclick = async () => {
        if (!devServer.running) {
          await runInTerminal(devServer.command);
          use.textContent = 'Starting…';
          // Open it when something answers on the port, not after a guess: wait up to 40 seconds.
          const address = `http://localhost:${devServer.port}`;
          const until = Date.now() + 40_000;
          while (Date.now() < until && !(await reachable(address, 1500))) await new Promise((r) => setTimeout(r, 800));
          if (await reachable(address, 1500)) navigate(address);
          else use.textContent = 'Not answering yet: check the Terminal';
        } else {
          navigate(`http://localhost:${devServer.port}`);
        }
      };
      card.hidden = false;
    } catch { /* no folder access: no card */ }
  }

  function closeMenu() { $('browser-menu').hidden = true; $('browser-more').setAttribute('aria-expanded', 'false'); }

  // ---- controls ----
  $('browser-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(e.target.value); });
  $('browser-go')?.addEventListener('click', () => navigate($('browser-url').value));
  $('browser-back').addEventListener('click', () => { const t = current(); if (t && t.index > 0) { t.index -= 1; show(t); } });
  $('browser-forward').addEventListener('click', () => { const t = current(); if (t && t.index < t.history.length - 1) { t.index += 1; show(t); } });
  $('browser-reload').addEventListener('click', () => { const t = current(); if (t) { t.frame.src = 'about:blank'; setTimeout(() => show(t), 30); } });
  $('browser-more').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('browser-menu');
    menu.hidden = !menu.hidden;
    $('browser-more').setAttribute('aria-expanded', String(!menu.hidden));
    const url = current()?.history[current().index] ?? '';
    for (const item of menu.querySelectorAll('[data-needs-url]')) item.classList.toggle('is-disabled', !url || url.startsWith('blob:'));
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#browser-menu, #browser-more')) closeMenu(); });
  $('browser-menu').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-browser]');
    if (!item || item.classList.contains('is-disabled')) return;
    const tab = current();
    const url = tab?.history[tab.index] ?? '';
    closeMenu();
    if (item.dataset.browser === 'external') window.open(url, '_blank', 'noopener');
    if (item.dataset.browser === 'copy') await navigator.clipboard?.writeText(url).catch(() => {});
    if (item.dataset.browser === 'file') $('browser-file').click();
    if (item.dataset.browser === 'clear' && tab) { tab.history = [tab.history[tab.index]].filter(Boolean); tab.index = Math.max(0, tab.history.length - 1); show(tab); }
  });
  $('browser-blocked-open')?.addEventListener('click', () => { const t = current(); if (t) window.open(t.history[t.index], '_blank', 'noopener'); });
  $('browser-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const blob = new Blob([await file.text()], { type: 'text/html' });
    const tab = current() ?? newTab();
    tab.fileName = file.name;
    navigate(URL.createObjectURL(blob));
  });

  // ---- the model working the page (desktop app only past this panel's own origin) ----
  const desktop = () => (typeof window.bunnyDesktop?.browserAct === 'function' ? window.bunnyDesktop : null);

  function loaded(tab, ms = 20_000) {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); tab.frame.removeEventListener('load', done); setTimeout(resolve, 300); };
      const timer = setTimeout(done, ms);
      tab.frame.addEventListener('load', done);
    });
  }

  /** A click inside the page moved it somewhere: keep the address bar and history true. */
  function syncUrl(tab, url) {
    if (!url || url === 'about:blank' || url === tab.history[tab.index] || tab.history[tab.index]?.startsWith('blob:')) return;
    tab.history = tab.history.slice(0, tab.index + 1).filter(Boolean);
    tab.history.push(url);
    tab.index = tab.history.length - 1;
    paintTabs();
    paintBar();
  }

  async function act(action, args = {}) {
    const bridge = desktop();
    if (action === 'open') {
      const url = normaliseUrl(args.url);
      if (!/^https?:/i.test(url)) return { error: 'Only http and https pages can be opened.' };
      const tab = current() ?? newTab();
      const ready = loaded(tab);
      navigate(url);
      await ready;
      if (!(await reachable(url))) return { error: `Could not reach ${url}: nothing is answering there. Start the server first (start_process), wait for it to print its address, then open it again.` };
      if (!bridge) return { note: `Opened ${url} in the browser panel. Reading and clicking pages needs the desktop app; use read_url to read it.` };
      action = 'read';
    } else if (action === 'back') {
      const tab = current();
      if (!tab || tab.index <= 0) return { error: 'There is no earlier page in this tab.' };
      const ready = loaded(tab);
      tab.index -= 1;
      show(tab);
      await ready;
      if (!bridge) return { note: 'Went back.' };
      action = 'read';
    }
    const tab = current();
    if (!tab?.history[tab.index]) return { error: 'No page is open in the browser panel. Use browser_open first.' };
    if (!bridge) return { error: 'Working inside pages needs the Bunny AI desktop app.' };
    const answer = await bridge.browserAct(tab.frame.name, action, args);
    if (answer?.page?.url) syncUrl(tab, answer.page.url);
    return answer;
  }

  newTab();
  return {
    navigate, newTab, act,
    currentUrl: () => current()?.history[current().index] ?? '',
    refresh: () => { if (!current()?.history[current().index]) paintDevServer(); },
  };
}
