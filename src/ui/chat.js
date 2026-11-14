/**
 * The chat screen.
 *
 * Everything a person does to a conversation lives here: send, stop, retry,
 * edit, copy, branch, compact, export, and keep an artifact beside the chat.
 * Server state is fetched, never guessed; the DOM is rebuilt from `state`.
 */

import {
  getJSON, sendJSON, streamMessage, streamComplete, applyTheme,
  computerScreenshot, computerClick, computerType, computerKey, computerWait, computerReset,
  terminalCreate, terminalWrite, terminalRead, terminalResize, terminalKill, terminalList,
  sessionSetting, fetchAbilities,
} from './api.js';
import { renderMarkdown } from './markdown.js';
import { applyLanguage, t as tr } from './i18n.js';
import { chartSpec, renderChart } from './chart.js';

const $ = (id) => document.getElementById(id);

const state = {
  providers: [],
  models: [],
  selected: null,          // { providerId, providerName, model }
  sessionId: new URLSearchParams(location.search).get('s'),
  session: null,           // full server session
  messages: [],            // what the thread is showing
  sessions: [],
  projects: [],
  projectId: null,
  projectOpen: false,
  artifacts: [],
  artifact: null,
  artifactOpen: false,
  streaming: null,         // AbortController
  incognito: false,
  archivedView: false,
  query: '',
  menuFor: null,
  pendingFiles: [],       // files picked, not sent yet
  language: 'en',
  railOpen: localStorage.getItem('bunny.rail') === '1',
  collapsedProjects: new Set(JSON.parse(localStorage.getItem('bunny.projects') ?? '[]')),
  mcpServers: [],
  // Side pane state
  sidePaneOpen: false,
  activePane: 'diff',
  // Terminal state
  terminalId: null,
  terminalPoll: null,
  // Computer use state
  computerUseEnabled: false,
  // Abilities
  abilities: [],
};

/** Translate a key in the current language. */
function say(key) {
  return tr(key, state.language);
}

// ---------------------------------------------------------------------------
// helpers

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'hidden') {
      node.setAttribute(key, String(value));
    } else node[key] = value;
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function button(label, props = {}) {
  return element('button', { type: 'button', textContent: label, ...props });
}

/** A small stroke icon for an icon-only button. `name` picks the artwork. */
function icon(name) {
  const markup = {
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    edit: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 3 21l.5-4.5Z"/>',
    retry: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V15a3 3 0 0 0 3 3h6.5"/>',
    artifact: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/>',
    read: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  }[name] ?? '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

// ---------------------------------------------------------------------------
// side pane & terminal

/**
 * The right pane shows one view at a time: the session overview (the rail),
 * a tool (terminal, diff, browser, file, tasks, plan) or the artifacts.
 * Asking for the view that is already open closes the pane.
 */
const TOOL_VIEWS = ['terminal', 'diff', 'browser', 'file', 'tasks', 'plan'];

function currentView() {
  if (state.artifactOpen) return 'artifacts';
  if (state.railOpen) return 'overview';
  if (state.sidePaneOpen) return state.activePane;
  return null;
}

function openView(name) {
  const next = name && name === currentView() ? null : name;
  state.railOpen = next === 'overview';
  state.artifactOpen = next === 'artifacts';
  state.sidePaneOpen = TOOL_VIEWS.includes(next);
  localStorage.setItem('bunny.rail', state.railOpen ? '1' : '0');

  const side = $('side-pane');
  if (side) side.hidden = !state.sidePaneOpen;
  const artifacts = $('artifacts');
  if (artifacts) artifacts.hidden = !state.artifactOpen;
  if (state.sidePaneOpen) $(`tab-${next}`)?.click();
  if (state.artifactOpen) renderArtifactList();
  renderRail();
  syncPaneButtons();
}

function syncPaneButtons() {
  const view = currentView();
  $('pane')?.classList.toggle('is-open', Boolean(view));
  document.querySelectorAll('[data-view]').forEach((b) => {
    const on = b.dataset.view === view
      || (b.dataset.view === 'tasks' && view === 'plan');
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('artifacts-toggle')?.setAttribute('aria-pressed', String(view === 'artifacts'));
  $('artifacts-toggle')?.classList.toggle('is-active', view === 'artifacts');
}

function toggleSidePane() {
  openView(state.sidePaneOpen ? null : state.activePane);
}

async function terminalStart() {
  if (state.terminalId) return;
  try {
    // No folder set: the server starts the shell in its own working folder.
    const cwd = state.session?.folder ?? undefined;
    const result = await terminalCreate({ cwd });
    state.terminalId = result.id;
    terminalPoll();
  } catch (err) {
    $('error').textContent = `Terminal failed: ${err.message}`;
  }
}

async function terminalPoll() {
  if (!state.terminalId) return;
  try {
    const result = await terminalRead(state.terminalId);
    const output = $('terminal-output');
    if (output) { output.textContent = result.text; output.scrollTop = output.scrollHeight; }
  } catch {
    // terminal may have exited
  }
  state.terminalPoll = setTimeout(terminalPoll, 1000);
}

function terminalStop() {
  if (state.terminalPoll) { clearTimeout(state.terminalPoll); state.terminalPoll = null; }
  if (state.terminalId) {
    terminalKill(state.terminalId).catch(() => {});
    state.terminalId = null;
  }
}

// ---------------------------------------------------------------------------
// composer header (folder, branch, permission mode, effort, model indicator)

function renderComposerHeader() {
  const folderText = $('folder-text');
  const branchText = $('branch-text');
  const permMode = $('permission-mode');
  const effortLevel = $('effort-level');
  const indicator = $('composer-model-indicator');

  if (folderText) folderText.textContent = state.session?.folder ?? say('composer.noFolder');
  if (branchText) branchText.textContent = state.session?.branch ?? say('composer.noBranch');
  if (permMode) permMode.value = state.session?.permissionMode ?? 'ask';
  syncModeMenu();
  if (effortLevel) effortLevel.value = state.session?.effort ?? 'medium';
  if (indicator && state.selected) {
    const ab = state.abilities.find((a) => a.id === state.selected.providerId);
    const modelAbilities = ab ? ab.abilities : [];
    indicator.textContent = state.selected.model + (modelAbilities.length ? ` · ${modelAbilities.join(', ')}` : '');
  }
}

// ---------------------------------------------------------------------------
// abilities

async function loadAbilities() {
  try {
    state.abilities = await fetchAbilities();
  } catch {
    state.abilities = [];
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const holder = element('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(holder);
    holder.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    holder.remove();
    return ok;
  }
}

function flash(node, text) {
  // Icon buttons keep their artwork in an SVG; writing to textContent would
  // wipe it, so the flash goes to the screen-reader span inside instead.
  const target = node.querySelector('.sr') ?? node;
  const original = target.textContent;
  target.textContent = text;
  setTimeout(() => { target.textContent = original; }, 1200);
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// model picker

function renderPicker() {
  const host = $('picker');
  host.replaceChildren();

  const trigger = button('', {
    id: 'picker-button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    className: 'picker-trigger',
  });
  if (state.selected) {
    trigger.append(
      element('span', { className: 'label', textContent: state.selected.model }),
      element('span', { className: 'meta', textContent: state.selected.providerName }),
    );
  } else {
    trigger.append(element('span', {
      className: 'label',
      textContent: state.models.length ? say('chat.chooseModel') : say('chat.noModels'),
    }));
  }
  trigger.append(icon('chevron'));
  host.append(trigger);

  if (!state.models.length) {
    trigger.addEventListener('click', () => { location.href = './providers.html'; });
    return;
  }

  trigger.addEventListener('click', () => {
    if (host.querySelector('.picker-panel')) { closePicker(); return; }
    openPicker(host, trigger);
  });
}

function closePicker() {
  document.querySelector('.picker-panel')?.remove();
  $('picker-button')?.setAttribute('aria-expanded', 'false');
}

function openPicker(host, trigger) {
  trigger.setAttribute('aria-expanded', 'true');
  const panel = element('div', {
    className: 'picker-panel', role: 'dialog', 'aria-label': 'Choose a model',
  });

  const search = element('input', {
    type: 'search', placeholder: say('chat.searchModels'), 'aria-label': say('chat.searchModels'),
  });
  const list = element('div', { className: 'picker-list', role: 'listbox' });

  panel.append(search, list);
  host.append(panel);
  search.focus();

  // The keyboard drives the list: arrows move, Enter chooses, Escape closes.
  // The focus stays in the search box so typing keeps working.
  let active = 0;

  const items = () => [...list.querySelectorAll('.picker-item')];

  const highlight = () => {
    const all = items();
    all.forEach((item, index) => {
      item.classList.toggle('active', index === active);
      item.setAttribute('aria-selected', String(index === active));
    });
    if (all[active]) {
      list.setAttribute('aria-activedescendant', all[active].id);
      all[active].scrollIntoView({ block: 'nearest' });
    } else {
      list.removeAttribute('aria-activedescendant');
    }
  };

  const paint = (query) => {
    const q = query.trim().toLowerCase();
    list.replaceChildren();
    const matches = state.models.filter((m) =>
      !q || m.id.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q));
    if (!matches.length) {
      list.append(element('div', { className: 'picker-empty', textContent: say('chat.noModelMatches') }));
      active = 0;
      highlight();
      return;
    }
    let currentProvider = null;
    for (const m of matches) {
      if (m.providerId !== currentProvider) {
        currentProvider = m.providerId;
        list.append(element('div', { className: 'picker-group', textContent: m.providerName }));
      }
      const isCurrent = state.selected
        && state.selected.model === m.id && state.selected.providerId === m.providerId;
      const item = button('', {
        className: 'picker-item', role: 'option', 'aria-selected': String(Boolean(isCurrent)),
      });
      item.id = `model-${m.providerId}-${m.id}`.replace(/[^a-zA-Z0-9-]/g, '-');
      item.dataset.model = m.id;
      item.dataset.provider = m.providerId;
      item.append(
        element('span', { className: 'model-name', textContent: m.displayName ?? m.id }),
        element('span', {
          className: 'model-desc',
          textContent: m.contextLength ? `${Number(m.contextLength).toLocaleString()} tokens · ${m.id}` : m.id,
        }),
      );
      if (m.unavailable) {
        // The provider publishes it, but this account cannot use it. Saying so
        // is better than letting the person find out by failing.
        item.classList.add('unavailable');
        item.dataset.unavailable = m.unavailable;
        item.title = m.unavailable;
        item.querySelector('.model-name')?.append(
          element('span', { className: 'tag', textContent: 'unavailable' }));
      }
      item.addEventListener('click', () => selectModel(m));
      list.append(item);
    }
    active = 0;
    highlight();
  };

  paint('');
  search.addEventListener('input', () => paint(search.value));
  search.addEventListener('keydown', (e) => {
    const all = items();
    if (e.key === 'Escape') { closePicker(); trigger.focus(); return; }
    if (!all.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, all.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; highlight(); }
    else if (e.key === 'End') { e.preventDefault(); active = all.length - 1; highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); all[active]?.click(); }
  });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
  setTimeout(() => {
    document.addEventListener('click', (ev) => { if (!host.contains(ev.target)) closePicker(); }, { once: true });
  }, 0);
}

async function selectModel(m) {
  state.selected = { providerId: m.providerId, providerName: m.providerName, model: m.id };
  closePicker();
  renderPicker();
  await sendJSON('/api/settings', 'PUT', { providerId: m.providerId, model: m.id });
}

// ---------------------------------------------------------------------------
// sidebar

function projectName(id) {
  return state.projects.find((p) => p.id === id)?.name ?? '';
}

async function loadSessions() {
  const q = state.query.trim();
  const search = q ? `/api/search?q=${encodeURIComponent(q)}` : '/api/sessions?archived=1';
  let rows = await getJSON(search);
  if (!q) rows = rows.filter((s) => (state.archivedView ? true : !s.archived));
  state.sessions = rows;
  renderSidebar();
}

function renderSidebar() {
  const host = $('sessions');
  host.replaceChildren();

  // Search results are a flat list; the normal view nests branches under their
  // parent so a fork is visibly a fork.
  const searching = Boolean(state.query.trim());
  const rows = searching ? state.sessions : orderWithChildren(state.sessions);

  const projectFilter = state.projectId
    ? rows.filter((s) => s.projectId === state.projectId)
    : rows;

  if (!projectFilter.length) {
    host.append(element('div', {
      className: 'hint pad',
      textContent: state.query.trim() ? say('chat.noMatches') : say('chat.noChats'),
    }));
    return;
  }

  if (searching) {
    for (const s of projectFilter) host.append(renderSessionRow(s, 0));
    return;
  }

  // Starred chats live at the top, project chats nest under their project
  // header, the rest fall into date buckets under Recents — on the same rows and hooks as before.
  const pinned = projectFilter.filter((s) => s.pinned);
  const rest = projectFilter.filter((s) => !s.pinned);

  if (pinned.length) {
    host.append(element('div', { className: 'side-group', textContent: say('chat.starred') }));
    for (const s of pinned) host.append(renderSessionRow(s, depthOf(s, rows)));
  }

  // Project groups: one header per project that has chats, expandable.
  const grouped = rest.filter((s) => s.projectId);
  const loose = rest.filter((s) => !s.projectId);
  for (const project of state.projects) {
    const members = grouped.filter((s) => s.projectId === project.id);
    if (!members.length) continue;
    const collapsed = state.collapsedProjects.has(project.id);
    host.append(renderProjectHead(project, members.length, collapsed));
    if (!collapsed) for (const s of members) host.append(renderSessionRow(s, 0));
  }

  if (loose.length) {
    host.append(element('div', { className: 'side-group', textContent: say('chat.recents') }));
    let lastBucket = null;
    for (const s of loose) {
      const bucket = bucketOf(s.updatedAt);
      if (bucket !== lastBucket) {
        host.append(element('div', { className: 'side-group sub', textContent: say(BUCKETS[bucket]) }));
        lastBucket = bucket;
      }
      host.append(renderSessionRow(s, depthOf(s, rows)));
    }
  }
}

/** A project header row in the sidebar tree: click expands or collapses it. */
function renderProjectHead(project, count, collapsed) {
  const head = element('button', {
    type: 'button',
    className: `side-group project-head${collapsed ? ' collapsed' : ''}`,
    'aria-expanded': String(!collapsed),
    title: say('chat.toggleProject'),
  });
  head.append(
    icon('chevron'),
    element('span', { className: 'project-name', textContent: project.name }),
    element('span', { className: 'count', textContent: String(count) }),
  );
  head.addEventListener('click', () => {
    if (collapsed) state.collapsedProjects.delete(project.id);
    else state.collapsedProjects.add(project.id);
    localStorage.setItem('bunny.projects', JSON.stringify([...state.collapsedProjects]));
    renderSidebar();
  });
  return head;
}

const BUCKETS = {
  today: 'chat.today',
  yesterday: 'chat.yesterday',
  previous7: 'chat.previous7',
  older: 'chat.older',
};

/** Which date group a chat belongs to, judged from local midnight. */
function bucketOf(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'older';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (then >= startToday) return 'today';
  if (then >= startToday - day) return 'yesterday';
  if (then >= startToday - 7 * day) return 'previous7';
  return 'older';
}

function orderWithChildren(rows) {
  const byParent = new Map();
  for (const s of rows) {
    const key = s.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(s);
  }
  const out = [];
  const walk = (id, depth) => {
    for (const s of byParent.get(id) ?? []) {
      s._depth = depth;
      out.push(s);
      walk(s.id, depth + 1);
    }
  };
  walk('root', 0);
  // A branch whose parent was deleted still deserves to appear.
  for (const s of rows) if (!out.includes(s)) { s._depth = 0; out.push(s); }
  return out;
}

function depthOf(s, rows) {
  return Math.min(s._depth ?? 0, 2);
}

function renderSessionRow(s, depth) {
  const row = element('div', { className: 'session-row', dataset: { session: s.id } });
  if (depth) row.dataset.depth = String(depth);

  const a = element('a', {
    href: `./index.html?s=${s.id}`,
    className: 'session-link',
    title: `${s.title} · ${s.messageCount} messages · ${relativeTime(s.updatedAt)}`,
  });
  if (s.id === state.sessionId) a.setAttribute('aria-current', 'page');

  if (depth) a.append(element('span', { className: 'branch-mark', textContent: '↳', 'aria-hidden': 'true' }));
  if (s.pinned) a.append(element('span', { className: 'pin', textContent: '★', 'aria-label': 'Pinned', role: 'img' }));
  if (s.incognito) a.append(element('span', { className: 'tag', textContent: 'incognito' }));
  if (s.id === state.sessionId && state.streaming) {
    // A live dot marks a session that is working right now.
    a.append(element('span', { className: 'dot', role: 'img', 'aria-label': 'Working' }));
  }
  a.append(element('span', { className: 'session-title', textContent: s.title }));
  if (s.projectId) a.append(element('span', { className: 'tag', textContent: projectName(s.projectId) }));

  const menuButton = button('⋯', {
    className: 'row-menu', 'aria-label': `Actions for ${s.title}`, 'aria-expanded': 'false',
  });
  menuButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = state.menuFor === s.id;
    state.menuFor = open ? null : s.id;
    renderSidebar();
    if (state.menuFor) {
      const menu = document.querySelector(`.session-row[data-session="${s.id}"] .session-menu button`);
      menu?.focus();
    }
  });

  row.append(a, menuButton);

  if (state.menuFor === s.id) row.append(renderSessionMenu(s));
  return row;
}

function renderSessionMenu(s) {
  const menu = element('div', { className: 'session-menu', role: 'menu' });

  const item = (label, act, props = {}) => {
    const b = button(label, { role: 'menuitem', className: props.className ?? '', ...props });
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      state.menuFor = null;
      await act();
    });
    return b;
  };

  menu.append(item('Rename', async () => {
    const next = window.prompt('Rename chat', s.title);
    if (next === null) return;
    await sendJSON(`/api/sessions/${s.id}`, 'PATCH', { title: next });
    await loadSessions();
    if (s.id === state.sessionId) await openSession(s.id);
  }));

  menu.append(item(s.pinned ? 'Unpin' : 'Pin', async () => {
    await sendJSON(`/api/sessions/${s.id}`, 'PATCH', { pinned: !s.pinned });
    await loadSessions();
  }));

  menu.append(item(s.archived ? 'Unarchive' : 'Archive', async () => {
    await sendJSON(`/api/sessions/${s.id}`, 'PATCH', { archived: !s.archived });
    if (s.id === state.sessionId && !s.archived) startNewChat();
    await loadSessions();
  }));

  menu.append(item('Delete', async () => {
    if (!window.confirm(`Delete “${s.title}”? This cannot be undone.`)) return;
    await sendJSON(`/api/sessions/${s.id}`, 'DELETE');
    if (s.id === state.sessionId) startNewChat();
    await loadSessions();
  }, { className: 'danger' }));

  return menu;
}

// ---------------------------------------------------------------------------
// projects

async function loadProjects() {
  state.projects = await getJSON('/api/projects');
  renderProjects();
}

function renderProjects() {
  const host = $('projects');
  host.replaceChildren();

  host.append(element('div', { className: 'side-group', textContent: say('chat.projects') }));

  const select = element('select', { id: 'project-filter', 'aria-label': 'Filter by project' });
  select.append(element('option', { value: '', textContent: 'All chats' }));
  for (const p of state.projects) {
    select.append(element('option', { value: p.id, textContent: p.name }));
  }
  select.value = state.projectId ?? '';
  select.addEventListener('change', async () => {
    state.projectId = select.value || null;
    await loadSessions();
  });

  host.append(select, button('＋', { id: 'new-project', 'aria-label': 'New project', className: 'ghost' }));

  if (state.projectOpen) {
    const form = element('form', { className: 'project-form' });
    const name = element('input', { placeholder: 'Project name', 'aria-label': 'Project name' });
    const instructions = element('textarea', {
      rows: 2, placeholder: 'Standing instructions (optional)', 'aria-label': 'Project instructions',
    });
    const save = button('Create', { type: 'submit', className: 'primary' });
    form.append(name, instructions, element('div', { className: 'actions' }, save,
      button('Cancel', { className: 'ghost', onClick: () => { state.projectOpen = false; renderProjects(); } })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      const project = await sendJSON('/api/projects', 'POST', {
        name: name.value, instructions: instructions.value,
      });
      state.projectOpen = false;
      state.projectId = project.id;
      await loadProjects();
      await loadSessions();
    });
    host.append(form);
    name.focus();
  }
}

// ---------------------------------------------------------------------------
// thread

function paintMessages() {
  const host = $('messages');
  host.replaceChildren();
  const empty = state.messages.length === 0;
  $('empty').hidden = !empty;
  $('main')?.classList.toggle('is-empty', empty);
  if (empty) paintGreeting();
  renderTitle();
  for (const m of state.messages) host.append(renderMessage(m));
  if (state.messages.length) host.lastElementChild?.scrollIntoView({ block: 'end' });
}

/** The time-of-day greeting on a fresh page. */
function paintGreeting() {
  const el = $('greeting');
  if (!el) return;
  const hour = new Date().getHours();
  const key = hour < 12 ? 'chat.greetingMorning' : hour < 18 ? 'chat.greetingAfternoon' : 'chat.greetingEvening';
  el.textContent = say(key);
}

/** The title in the topbar: the chat's name, or the new-chat state. */
function renderTitle() {
  const el = $('chat-title');
  if (!el) return;
  el.textContent = state.session?.title || say('chat.new');
}

function renderMessage(m) {
  const wrap = element('div', { className: `msg ${m.role}`, dataset: { role: m.role, id: m.id ?? '' } });

  // Tool call block: collapsible, shows the tool name, args and result
  if (m.kind === 'tool_call') {
    const tc = element('div', { className: 'tool-call' });
    const header = element('div', { className: 'tool-call-header' });
    header.append(element('span', { textContent: m.tool ?? 'tool' }));
    if (m.status) header.append(element('span', { className: 'tag', textContent: m.status }));
    tc.append(header);
    const body = element('div', { className: 'tool-call-body' });
    body.textContent = m.content ?? '';
    tc.append(body);
    if (m.result) {
      const res = element('div', { className: 'tool-call-result' });
      res.textContent = `→ ${String(m.result).slice(0, 500)}`;
      tc.append(res);
    }
    wrap.append(tc);
    if ((m.attachments ?? []).length) wrap.append(renderAttachments(m.attachments));
    return wrap;
  }

  // Permission prompt: ask/deny a tool call
  if (m.kind === 'permission_prompt') {
    const pp = element('div', { className: 'permission-prompt' });
    pp.append(element('h4', { textContent: m.title ?? 'Allow tool call?' }));
    pp.append(element('p', { textContent: m.content ?? '' }));
    const actions = element('div', { className: 'permission-actions' });
    const allow = button('Allow', { className: 'primary' });
    const deny = button('Deny', { className: 'ghost' });
    allow.addEventListener('click', async () => {
      await sendJSON(`/api/sessions/${state.sessionId}/permission/${m.id}`, 'POST', { allowed: true });
      pp.remove();
    });
    deny.addEventListener('click', async () => {
      await sendJSON(`/api/sessions/${state.sessionId}/permission/${m.id}`, 'POST', { allowed: false });
      pp.remove();
    });
    actions.append(allow, deny);
    pp.append(actions);
    wrap.append(pp);
    return wrap;
  }

  const body = element('div', { className: 'body' });
  if (m.role === 'assistant') body.append(renderMarkdown(m.content));
  else body.textContent = m.content;
  wrap.append(body);

  if (m.kind === 'summary' || m.kind === 'partial') {
    wrap.append(element('div', { className: 'meta' },
      element('span', { className: 'tag', textContent: say(m.kind === 'summary' ? 'chat.summary' : 'chat.stopped') })));
  }

  // Task list under latest message
  if (m.tasks?.length) {
    const tl = element('div', { className: 'task-list' });
    for (const task of m.tasks) {
      const ti = element('div', { className: 'task-item' });
      const cb = element('div', { className: 'checkbox' + (task.done ? ' checked' : '') });
      ti.append(cb, element('span', { className: 'text', textContent: task.text }));
      tl.append(ti);
    }
    wrap.append(tl);
  }

  // Next-step box
  if (m.nextStep) {
    const ns = element('div', { className: 'next-step' });
    ns.append(element('span', { className: 'icon', textContent: '▶' }));
    const content = element('div', { className: 'next-step-content' });
    content.append(element('h4', { textContent: m.nextStep.title ?? 'Next step' }));
    content.append(element('p', { textContent: m.nextStep.text ?? '' }));
    const actions = element('div', { className: 'next-step-actions' });
    for (const btn of (m.nextStep.buttons ?? [])) {
      const b = button(btn.label, { className: 'ghost' });
      b.addEventListener('click', async () => {
        $('input').value = btn.value ?? '';
        send();
      });
      actions.append(b);
    }
    content.append(actions);
    ns.append(content);
    wrap.append(ns);
  }

  if ((m.attachments ?? []).length) wrap.append(renderAttachments(m.attachments));
  const stored = isStoredId(m.id);
  if (stored || m.local) wrap.append(renderActions(m, stored));
  return wrap;
}

/** Show what was sent with the message: a picture, or a file card. */
function renderAttachments(files) {
  const box = element('div', { className: 'attachments' });
  for (const file of files) {
    if (file.kind === 'image') {
      const img = element('img', { className: 'attachment-image', alt: file.name });
      img.src = file.data;
      box.append(img);
      continue;
    }
    const card = element('div', { className: 'attachment-file' },
      element('span', { className: 'attachment-name', textContent: file.name }),
      element('span', { className: 'attachment-meta', textContent: `${Math.max(1, Math.round(file.size / 1024))} KB` }));
    box.append(card);
  }
  return box;
}

/** A server message id is a UUID; a local echo is not. */
function isStoredId(id) {
  return /^[a-f0-9-]{36}$/.test(String(id ?? ''));
}

function renderActions(m, stored) {
  const bar = element('div', { className: 'msg-actions' });

  const act = (label, name, handler) => {
    const b = element('button', {
      type: 'button', className: 'icon-btn', 'aria-label': `${label} this message`, title: label,
    });
    b.append(icon(name), element('span', { className: 'sr', textContent: label }));
    b.dataset.act = name;
    b.addEventListener('click', async () => {
      try {
        await handler(b);
      } catch (err) {
        $('error').textContent = err.message ?? 'That did not work.';
      }
    });
    bar.append(b);
    return b;
  };

  act(say('chat.copy'), 'copy', async (node) => {
    const ok = await copyText(m.content);
    flash(node, ok ? say('chat.copied') : 'Copy failed');
  });

  if (!stored) return bar;

  if (m.role === 'user') {
    act(say('chat.edit'), 'edit', async () => startEditing(m));
  }

  if (m.role === 'assistant') {
    act(say('chat.retry'), 'retry', async () => retry(m));
    act(say('chat.saveArtifact'), 'artifact', async () => promote(m));
    act(say('chat.readAloud'), 'read', async (node) => {
      const ok = readAloud(m.content);
      flash(node, ok ? say('chat.reading') : say('chat.cannotRead'));
    });
  }

  act(say('chat.branch'), 'branch', async () => {
    const branch = await sendJSON(`/api/sessions/${state.sessionId}/fork`, 'POST', { at: m.id });
    await loadSessions();
    location.href = `./index.html?s=${branch.id}`;
  });

  return bar;
}

function startEditing(m) {
  const wrap = document.querySelector(`.msg[data-id="${m.id}"]`);
  if (!wrap) return;
  const body = wrap.querySelector('.body');
  const editor = element('textarea', { className: 'edit-box', value: m.content, rows: 3 });
  const save = button('Save and resend', { className: 'primary' });
  const cancel = button('Cancel', { className: 'ghost' });

  body.replaceChildren(editor, element('div', { className: 'actions' }, save, cancel));
  editor.focus();

  cancel.addEventListener('click', () => paintMessages());
  save.addEventListener('click', async () => {
    const text = editor.value.trim();
    if (!text) { editor.focus(); return; }
    const updated = await sendJSON(`/api/sessions/${state.sessionId}/messages/${m.id}`, 'PATCH', { content: text });
    state.messages = updated.messages;
    paintMessages();
    renderContext(updated.context);
    await streamReply({ retry: true });
  });
}

async function retry(m) {
  // Drop the reply being retried, then ask again with the same history.
  const updated = await sendJSON(`/api/sessions/${state.sessionId}/messages/${m.id}`, 'DELETE');
  state.messages = updated.messages;
  paintMessages();
  await streamReply({ retry: true });
}

async function promote(m) {
  const artifact = await sendJSON('/api/artifacts', 'POST', {
    sessionId: state.sessionId,
    title: inferTitle(m.content),
    kind: inferKind(m.content),
    content: m.content,
  });
  await loadArtifacts();
  await showArtifact(artifact.id);
  $('error').textContent = '';
}

function inferTitle(text) {
  const first = String(text).split('\n').find((l) => l.trim()) ?? 'Artifact';
  return first.replace(/^#+\s*/, '').replace(/^```\w*/, 'Artifact').trim().slice(0, 60) || 'Artifact';
}

function inferKind(text) {
  const body = String(text);
  if (/^\s*(<!doctype html|<html|<body|<svg|<div|<h1)/i.test(body)) return 'html';
  if (/```/.test(body)) return 'code';
  return 'markdown';
}

// ---------------------------------------------------------------------------
// context meter

function renderContext(meter) {
  const host = $('context');
  if (!meter) { host.hidden = true; }
  else {
    host.hidden = false;
    const pct = Math.max(0, Math.min(100, meter.pct ?? 0));
    $('context-fill').style.width = `${pct}%`;
    $('context-text').textContent = `${pct}%`;
    host.setAttribute('title', `${meter.used.toLocaleString()} of ${meter.limit.toLocaleString()} tokens used · ${meter.messages} messages`);
    host.classList.toggle('high', pct >= 80);
  }
  // The rail keeps its own compact copy of the same meter.
  const railFill = $('rail-context-fill');
  if (railFill && meter) {
    const pct = Math.max(0, Math.min(100, meter.pct ?? 0));
    railFill.style.width = `${pct}%`;
    $('rail-context-text').textContent = `${pct}%`;
  }
}

// ---------------------------------------------------------------------------
// session rail

async function loadMcpServers() {
  try {
    state.mcpServers = await getJSON('/api/mcp');
  } catch {
    state.mcpServers = [];
  }
}

/**
 * Paint the session rail: where this chat runs, its context, its connectors
 * and its outputs. Hidden by default; the topbar toggle opens it.
 */
function renderRail() {
  const rail = $('rail');
  const toggle = $('rail-toggle');
  if (!rail || !toggle) return;
  // The artifact panel takes the same right edge, so the rail steps aside.
  const open = state.railOpen && !state.artifactOpen && !state.sidePaneOpen;
  rail.hidden = !open;
  toggle.title = state.railOpen ? say('rail.hide') : say('rail.show');
  syncPaneButtons();
  if (!open) return;

  const projectRow = $('rail-project');
  const project = state.session?.projectId ? projectName(state.session.projectId) : '';
  projectRow.replaceChildren(element('span', {
    className: project ? 'rail-value' : 'rail-empty',
    textContent: project || say('rail.noProject'),
  }));

  const connectors = $('rail-connectors');
  connectors.replaceChildren();
  if (!state.mcpServers.length) {
    connectors.append(element('div', { className: 'rail-empty', textContent: say('rail.noConnectors') }));
  } else {
    for (const s of state.mcpServers) {
      const row = element('div', { className: 'rail-row' });
      row.append(element('span', { className: s.enabled ? 'dot' : 'dot off', role: 'img', 'aria-label': s.enabled ? 'Enabled' : 'Disabled' }));
      row.append(element('span', { className: 'rail-value', textContent: s.name }));
      connectors.append(row);
    }
  }

  const outputs = $('rail-outputs');
  outputs.replaceChildren();
  const sessionArtifacts = state.artifacts.filter((a) => a.sessionId === state.sessionId);
  if (!sessionArtifacts.length) {
    outputs.append(element('div', { className: 'rail-empty', textContent: say('rail.noOutputs') }));
  } else {
    for (const a of sessionArtifacts) {
      const row = element('button', {
        type: 'button', className: 'rail-row link', 'aria-label': `${say('rail.openOutputs')}: ${a.title}`,
      });
      row.append(element('span', { className: 'rail-value', textContent: a.title }));
      row.append(element('span', { className: 'tag', textContent: a.kind }));
      row.addEventListener('click', () => { if (!state.artifactOpen) toggleArtifacts(); showArtifact(a.id); });
      outputs.append(row);
    }
  }
}

// ---------------------------------------------------------------------------
// streaming

function setStreaming(on) {
  $('send').disabled = on;
  $('stop').hidden = !on;
  $('status').textContent = on ? 'Streaming…' : '';
  renderSidebar();
  renderRail();
}

function flashStatus(text, ms = 3000) {
  $('status').textContent = text;
  setTimeout(() => { if (!state.streaming) $('status').textContent = ''; }, ms);
}

/**
 * Stream one reply into a body element.
 *
 * One reader for both endpoints: the stored-chat route and the incognito
 * one-shot only differ in the path and whether the reply is persisted.
 *
 * @param {HTMLElement} bodyEl
 * @param {{path: string, payload: object}} opts
 * @returns {Promise<{assembled: string, meter: object|null}>}
 */
async function streamInto(bodyEl, { path, payload }) {
  const controller = new AbortController();
  state.streaming = controller;
  setStreaming(true);

  let assembled = '';
  let meter = null;
  let aborted = false;
  bodyEl.textContent = '…';

  const handlers = {
    signal: controller.signal,
    onDelta: (delta) => {
      assembled += delta;
      bodyEl.textContent = assembled;
      bodyEl.scrollIntoView({ block: 'end' });
    },
    onCompacted: (info) => {
      flashStatus('Compacted automatically');
      renderContext(info.after);
    },
    onDone: (info) => { meter = info?.context ?? null; },
    onError: (err) => { $('error').textContent = err.message ?? 'The request failed.'; },
  };

  try {
    if (path === '/api/complete') await streamComplete(payload, handlers);
    else await streamMessage(state.sessionId, payload, handlers);
  } catch (err) {
    if (err.name === 'AbortError') {
      aborted = true;
    } else {
      $('error').textContent = err.message;
    }
  } finally {
    state.streaming = null;
    setStreaming(false);
  }

  return { assembled, meter, aborted };
}

/** Ask again for the newest reply, keeping the user turn as-is. */
async function streamReply({ retry = true } = {}) {
  let bodyEl = [...$('messages').querySelectorAll('.msg.assistant')].at(-1)?.querySelector('.body');
  if (!bodyEl) {
    // A retry follows a delete, so there is no bubble to stream into yet.
    state.messages.push({ id: `pending-a-${Date.now()}`, role: 'assistant', content: '', local: true });
    paintMessages();
    bodyEl = $('messages').lastElementChild?.querySelector('.body');
  }
  if (!bodyEl) return null;

  const { assembled, meter } = await streamInto(bodyEl, {
    path: `/api/sessions/${state.sessionId}/messages`,
    payload: {
      retry,
      content: state.lastSent ?? '',
      providerId: state.selected?.providerId,
      model: state.selected?.model,
    },
  });

  if (meter) renderContext(meter);
  await refreshSession();
  await loadSessions();
  return assembled;
}

async function refreshSession({ expectAssistant = false } = {}) {
  // A stopped reply is written by the server just after the browser gives up,
  // so poll briefly rather than read the transcript too early and lose it.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const session = await getJSON(`/api/sessions/${state.sessionId}`);
    state.session = session;
    state.messages = session.messages;
    const hasReply = session.messages.some((m) => m.role === 'assistant');
    if (!expectAssistant || hasReply) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  paintMessages();
  renderContext(state.session.context);
}

async function openSession(id) {
  state.sessionId = id;
  state.incognito = false;
  renderMode();
  const session = await getJSON(`/api/sessions/${id}`);
  state.session = session;
  state.messages = session.messages;
  if (session.providerId && session.model) {
    state.selected = {
      providerId: session.providerId,
      providerName: state.providers.find((p) => p.id === session.providerId)?.name ?? session.providerId,
      model: session.model,
    };
    renderPicker();
  }
  paintMessages();
  renderContext(session.context);
  await loadArtifacts();
  renderRail();
  renderComposerHeader();
}

// ---------------------------------------------------------------------------
// sending

function startNewChat({ incognito = false } = {}) {
  state.sessionId = null;
  state.session = null;
  state.messages = [];
  state.incognito = incognito;
  history.replaceState(null, '', './index.html');
  paintMessages();
  renderContext(null);
  renderMode();
  loadArtifacts();
  renderRail();
  renderComposerHeader();
  $('input').focus();
}

function renderMode() {
  const host = $('mode');
  if (!host) return;
  host.hidden = !state.incognito;
}

async function send() {
  const input = $('input');
  const text = input.value.trim();
  $('error').textContent = '';
  if (!text && !state.pendingFiles.length) return;

  if (text.startsWith('/')) {
    const handled = await runCommand(text);
    if (handled) { input.value = ''; return; }
  }

  if (!state.selected) { $('error').textContent = 'Choose a model first.'; return; }

  input.value = '';
  state.lastSent = text;
  const files = state.pendingFiles;
  state.pendingFiles = [];
  renderPendingFiles();

  if (state.incognito) {
    state.messages.push({ id: `local-u-${Date.now()}`, role: 'user', content: text, local: true, attachments: files });
    state.messages.push({ id: `local-a-${Date.now()}`, role: 'assistant', content: '', local: true });
    paintMessages();
    const bodyEl = $('messages').lastElementChild?.querySelector('.body');

    // Incognito never creates a session: the transcript stays in this page and
    // the server is only asked for one completion.
    const { assembled, meter } = await streamInto(bodyEl, {
      path: '/api/complete',
      payload: {
        providerId: state.selected.providerId,
        model: state.selected.model,
        messages: state.messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      },
    });

    state.messages.at(-1).content = assembled || '(no reply)';
    paintMessages();
    renderContext(meter ?? ephemeralMeter());
    return;
  }

  if (!state.sessionId) {
    const session = await sendJSON('/api/sessions', 'POST', {
      title: 'New chat',
      providerId: state.selected.providerId,
      model: state.selected.model,
      projectId: state.projectId,
    });
    state.sessionId = session.id;
    history.replaceState(null, '', `./index.html?s=${session.id}`);
  }

  state.messages.push({ id: `pending-u-${Date.now()}`, role: 'user', content: text, local: true, attachments: files });
  state.messages.push({ id: `pending-a-${Date.now()}`, role: 'assistant', content: '', local: true });
  paintMessages();
  const bodyEl = $('messages').lastElementChild?.querySelector('.body');

  const { meter, aborted } = await streamInto(bodyEl, {
    path: `/api/sessions/${state.sessionId}/messages`,
    payload: {
      content: text,
      providerId: state.selected.providerId,
      model: state.selected.model,
      attachments: files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })),
    },
  });

  if (meter) renderContext(meter);
  await refreshSession({ expectAssistant: aborted });
  await loadSessions();
  notifyReply();
}

/**
 * Tell the person a reply is ready, if they asked for it and are looking
 * somewhere else.
 */
function notifyReply() {
  if (!state.settings?.notifications) return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  const last = state.messages.at(-1);
  if (!last || last.role !== 'assistant') return;
  try {
    const note = new Notification(say('app.name'), {
      body: String(last.content ?? '').slice(0, 140),
      tag: state.sessionId ?? 'bunny',
    });
    note.onclick = () => { window.focus(); note.close(); };
  } catch {
    // A browser that will not show notifications is not an error.
  }
}

/** Files picked but not yet sent. */
function renderPendingFiles() {
  const host = $('pending-files');
  host.replaceChildren();
  host.hidden = state.pendingFiles.length === 0;
  state.pendingFiles.forEach((file, index) => {
    const chip = element('span', { className: 'file-chip' }, file.name);
    const remove = button('×', { className: 'file-remove', 'aria-label': `Remove ${file.name}` });
    remove.addEventListener('click', () => {
      state.pendingFiles.splice(index, 1);
      renderPendingFiles();
    });
    chip.append(remove);
    host.append(chip);
  });
}

/** Read the chosen files into memory, ready to be sent. */
async function addFiles(fileList) {
  for (const file of Array.from(fileList).slice(0, 8)) {
    const isImage = file.type.startsWith('image/');
    const data = await readFile(file, isImage);
    if (!data) continue;
    state.pendingFiles.push({ name: file.name, mime: file.type || 'text/plain', kind: isImage ? 'image' : 'text', data, size: file.size });
  }
  renderPendingFiles();
}

function readFile(file, isImage) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => resolve(String(reader.result ?? ''));
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// slash commands

const COMMANDS = [
  { name: '/compact', hint: 'Summarise this chat to free context' },
  { name: '/clear', hint: 'Start a new chat, keeping this one' },
  { name: '/export', hint: 'Download this chat as Markdown' },
  { name: '/new', hint: 'Start a new chat' },
  { name: '/help', hint: 'Show what commands exist' },
];

function renderSlashMenu() {
  const host = $('slash');
  const value = $('input').value;
  if (!value.startsWith('/') || value.includes('\n')) { host.hidden = true; return; }
  const matches = COMMANDS.filter((c) => c.name.startsWith(value.split(' ')[0]));
  host.replaceChildren();
  if (!matches.length) { host.hidden = true; return; }
  for (const c of matches) {
    const item = button('', { className: 'slash-item', role: 'option' });
    item.append(element('span', { className: 'slash-name', textContent: c.name }),
      element('span', { className: 'slash-hint', textContent: say(c.hint) }));
    item.addEventListener('click', () => {
      $('input').value = c.name;
      $('slash').hidden = true;
      $('input').focus();
    });
    host.append(item);
  }
  host.hidden = false;
}

async function runCommand(text) {
  const [name] = text.split(/\s+/);
  switch (name) {
    case '/help':
      state.messages.push({
        id: `local-h-${Date.now()}`,
        role: 'assistant',
        content: ['**Commands**', '', ...COMMANDS.map((c) => `- \`${c.name}\` — ${c.hint}`)].join('\n'),
        local: true,
      });
      paintMessages();
      return true;
    case '/new':
      startNewChat({ incognito: state.incognito });
      return true;
    case '/clear':
      startNewChat();
      return true;
    case '/export':
      await exportChat();
      return true;
    case '/compact':
      await compactChat();
      return true;
    default:
      return false;
  }
}

async function compactChat() {
  if (!state.sessionId) { $('error').textContent = 'Start a chat before compacting.'; return; }
  try {
    const result = await sendJSON(`/api/sessions/${state.sessionId}/compact`, 'POST');
    await refreshSession();
    renderContext(result.after);
    $('status').textContent = `Compacted: ${result.before.used} → ${result.after.used} tokens`;
    setTimeout(() => { $('status').textContent = ''; }, 4000);
  } catch (err) {
    $('error').textContent = err.message ?? 'Could not compact.';
  }
}

async function exportChat() {
  if (!state.sessionId) { $('error').textContent = 'Start a chat before exporting.'; return; }
  const link = element('a', {
    href: `/api/sessions/${state.sessionId}/export?format=markdown`,
    download: '',
  });
  document.body.append(link);
  link.click();
  link.remove();
}

// ---------------------------------------------------------------------------
// artifacts

async function loadArtifacts() {
  state.artifacts = state.sessionId
    ? await getJSON(`/api/artifacts?sessionId=${state.sessionId}`)
    : [];
  $('artifact-count').textContent = String(state.artifacts.length);
  renderArtifactList();
}

function renderArtifactList() {
  const host = $('artifact-list');
  host.replaceChildren();
  if (!state.artifacts.length) {
    host.append(element('p', {
      className: 'hint',
      textContent: 'No artifacts yet. Use “Save as artifact” on a reply to keep it here.',
    }));
    return;
  }
  for (const a of state.artifacts) {
    const row = button('', { className: 'artifact-row', 'aria-label': `Open ${a.title}` });
    if (state.artifact?.id === a.id) row.setAttribute('aria-current', 'true');
    row.append(
      element('span', { className: `artifact-thumb thumb-${a.kind}`, 'aria-hidden': 'true' },
        element('span', { className: 'thumb-mark', textContent: a.kind === 'html' ? '<>' : a.kind === 'code' ? '{}' : '¶' })),
      element('span', { className: 'artifact-info' },
        element('span', { className: 'artifact-title', textContent: a.title }),
        element('span', { className: 'artifact-meta', textContent: `${a.kind} · v${a.versionCount}${a.starred ? ' · ★' : ''}` }),
        element('span', { className: 'artifact-preview', textContent: a.preview ?? '' })),
    );
    row.addEventListener('click', () => showArtifact(a.id));
    host.append(row);
  }
}

async function showArtifact(id) {
  const artifact = await getJSON(`/api/artifacts/${id}`);
  state.artifact = artifact;
  if (currentView() !== 'artifacts') openView('artifacts');
  renderArtifactList();
  renderArtifactView(artifact);
}

function renderArtifactView(artifact) {
  const host = $('artifact-view');
  host.replaceChildren();
  const current = artifact.versions.at(-1);

  const head = element('div', { className: 'artifact-head' },
    element('h3', { id: 'artifact-title', textContent: artifact.title }),
    element('span', { className: 'tag', textContent: `${artifact.kind} · v${artifact.versions.length}` }));

  const star = button(artifact.starred ? '★ Starred' : '☆ Star', { className: 'ghost small' });
  star.addEventListener('click', async () => {
    const updated = await sendJSON(`/api/artifacts/${artifact.id}`, 'PATCH', { starred: !artifact.starred });
    state.artifact = updated;
    await loadArtifacts();
    renderArtifactView(updated);
  });

  const versions = element('select', { 'aria-label': 'Artifact version' });
  artifact.versions.forEach((v, index) => {
    versions.append(element('option', {
      value: String(index), textContent: `v${index + 1} · ${new Date(v.at).toLocaleTimeString()}`,
    }));
  });
  versions.value = String(artifact.versions.length - 1);

  const restore = button('Restore', { className: 'ghost small' });
  restore.addEventListener('click', async () => {
    const updated = await sendJSON(`/api/artifacts/${artifact.id}/restore`, 'POST', { version: Number(versions.value) });
    state.artifact = updated;
    await loadArtifacts();
    renderArtifactView(updated);
  });

  const open = button('Open', { className: 'ghost small' });
  open.addEventListener('click', () => {
    // A real URL rather than a blob, so the tab can be shared and reloaded.
    window.open(`/api/artifacts/${artifact.id}/raw`, '_blank', 'noopener');
  });

  const print = button(say('chat.print'), { className: 'ghost small' });
  print.addEventListener('click', () => {
    // A print window with the artifact alone in it, so the page prints the
    // document and not the app around it.
    const frame = window.open('', '_blank');
    if (!frame) return;
    // The print window is a dead end: it does not need a handle on the app.
    frame.opener = null;
    frame.document.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
    frame.document.title = artifact.title;
    if (artifact.kind === 'html') {
      frame.document.body.innerHTML = current.content;
    } else {
      const pre = frame.document.createElement('pre');
      pre.textContent = current.content;
      pre.style.whiteSpace = 'pre-wrap';
      frame.document.body.append(pre);
    }
    frame.focus();
    frame.print();
  });

  const remove = button('Delete', { className: 'ghost small danger' });
  remove.addEventListener('click', async () => {
    if (!window.confirm(`Delete “${artifact.title}”?`)) return;
    await sendJSON(`/api/artifacts/${artifact.id}`, 'DELETE');
    state.artifact = null;
    host.replaceChildren();
    await loadArtifacts();
  });

  head.append(element('div', { className: 'actions' }, versions, restore, star, open, print, remove));
  host.append(head);

  if (artifact.kind === 'html') {
    // Sandboxed: no same-origin, no top navigation. The artifact can run its own
    // scripts but cannot reach the app, its storage or its API.
    const frame = element('iframe', {
      className: 'artifact-frame', sandbox: 'allow-scripts', title: artifact.title,
    });
    frame.srcdoc = current.content;
    host.append(frame);
  } else if (artifact.kind === 'code') {
    const pre = element('pre', { className: 'code' });
    pre.append(element('code', { textContent: current.content }));
    host.append(pre);
  } else {
    const body = element('div', { className: 'artifact-body' });
    // Data that describes a chart is drawn, not printed.
    const spec = chartSpec(current.content);
    if (spec) {
      const chart = element('div', { className: 'artifact-chart' });
      chart.append(renderChart(spec));
      body.append(chart);
    } else {
      body.append(renderMarkdown(current.content));
    }
    host.append(body);
  }

  // Editing appends a version rather than overwriting, so the earlier content
  // stays reachable from the version picker.
  const editor = element('textarea', {
    className: 'artifact-edit', rows: 6, value: current.content, 'aria-label': 'Artifact content',
  });
  const saveVersion = button('Save new version', { className: 'primary small' });
  saveVersion.addEventListener('click', async () => {
    const updated = await sendJSON(`/api/artifacts/${artifact.id}`, 'PATCH', { content: editor.value });
    state.artifact = updated;
    await loadArtifacts();
    renderArtifactView(updated);
  });
  host.append(element('div', { className: 'artifact-editor' }, editor, saveVersion));
}

function toggleArtifacts() {
  openView('artifacts');
}

// ---------------------------------------------------------------------------
// incognito meter

function ephemeralMeter() {
  const used = state.messages.reduce((n, m) => n + Math.ceil(String(m.content ?? '').length / 4) + 4, 0);
  return { used, limit: 200_000, pct: Math.round((used / 200_000) * 100), messages: state.messages.length };
}

/**
 * Say a reply out loud.
 *
 * The browser does the speaking; this only hands it the text and stops
 * anything already being read.
 */
function readAloud(text) {
  if (typeof speechSynthesis === 'undefined' || !text) return false;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 4000));
    utterance.lang = document.documentElement.lang || 'en';
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/**
 * Listen for a message instead of typing it.
 *
 * Not every browser can do this, and the app says so rather than pretending.
 */
let recognition = null;

function setTalking(on) {
  $('voice')?.classList.toggle('is-live', on);
  $('composer')?.classList.toggle('is-talking', on);
  $('status').textContent = on ? say('chat.listening') : '';
}

function startVoiceInput() {
  if (recognition) return;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) {
    $('error').textContent = say('chat.noVoice');
    return;
  }
  $('error').textContent = '';
  recognition = new Recognition();
  recognition.lang = document.documentElement.lang || 'en';
  recognition.interimResults = false;
  recognition.continuous = true; // keep listening while the button is held
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const said = event.results[i]?.[0]?.transcript;
      if (said && event.results[i].isFinal) $('input').value = `${$('input').value} ${said}`.trim();
    }
  };
  recognition.onerror = () => { $('error').textContent = say('chat.voiceFailed'); };
  recognition.onend = () => { recognition = null; setTalking(false); };
  try {
    recognition.start();
    setTalking(true);
  } catch {
    recognition = null;
    setTalking(false);
    $('error').textContent = say('chat.voiceFailed');
  }
}

function stopVoiceInput() {
  recognition?.stop();
}

/**
 * Push to talk: hold the mic (or hold Space/Enter on the focused button) to
 * speak, release to stop.
 */
function bindPushToTalk() {
  const mic = $('voice');
  if (!mic) return;
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); startVoiceInput(); });
  mic.addEventListener('pointerup', stopVoiceInput);
  mic.addEventListener('pointerleave', stopVoiceInput);
  mic.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startVoiceInput(); }
  });
  mic.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stopVoiceInput(); }
  });
}

// ---------------------------------------------------------------------------
// Chat / Cowork / Code switch and the permission-mode menu

const MODE_LABELS = { auto: 'Auto', ask: 'Manual', accept: 'Accept edits', plan: 'Plan' };

function applyWorkMode(mode) {
  document.body.dataset.workMode = mode;
  for (const m of ['chat', 'cowork', 'code']) {
    const b = $(`mode-${m}`);
    if (!b) continue;
    b.classList.toggle('is-active', m === mode);
    b.setAttribute('aria-pressed', String(m === mode));
  }
  localStorage.setItem('bunny.workMode', mode);
}

function bindModeSwitch() {
  for (const m of ['chat', 'cowork', 'code']) {
    $(`mode-${m}`)?.addEventListener('click', () => applyWorkMode(m));
  }
  applyWorkMode(localStorage.getItem('bunny.workMode') ?? 'chat');
}

function syncModeMenu() {
  const value = $('permission-mode')?.value ?? 'ask';
  const label = $('mode-label');
  if (label) label.textContent = MODE_LABELS[value] ?? value;
  document.querySelectorAll('#mode-menu [data-mode]').forEach((item) => {
    const on = item.dataset.mode === value;
    item.classList.toggle('is-selected', on);
    item.setAttribute('aria-checked', String(on));
  });
}

function closeModeMenu() {
  const menu = $('mode-menu');
  if (menu) menu.hidden = true;
  $('mode-button')?.setAttribute('aria-expanded', 'false');
}

function chooseMode(value) {
  const select = $('permission-mode');
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event('change'));
  syncModeMenu();
  closeModeMenu();
}

function bindModeMenu() {
  const buttonEl = $('mode-button');
  const menu = $('mode-menu');
  if (!buttonEl || !menu) return;
  buttonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    buttonEl.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector('.is-selected') ?? menu.querySelector('[data-mode]'))?.focus();
  });
  menu.querySelectorAll('[data-mode]').forEach((item) => {
    item.addEventListener('click', () => chooseMode(item.dataset.mode));
  });
  menu.addEventListener('keydown', (e) => {
    const map = { 1: 'auto', 2: 'ask', 3: 'accept', 4: 'plan' };
    if (map[e.key]) { e.preventDefault(); chooseMode(map[e.key]); }
    if (e.key === 'Escape') { closeModeMenu(); buttonEl.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#mode-menu, #mode-button')) closeModeMenu();
  });
  syncModeMenu();
}

// ---------------------------------------------------------------------------
// command palette

const PALETTE_COMMANDS = [
  { name: 'New chat', hint: 'Start a fresh conversation', run: () => startNewChat() },
  { name: 'Incognito chat', hint: 'Start a chat that is never saved', run: () => startNewChat({ incognito: true }) },
  { name: 'Compact this chat', hint: 'Summarise the thread to free context', run: () => compactChat() },
  { name: 'Export this chat', hint: 'Download the transcript as Markdown', run: () => exportChat() },
  { name: 'Toggle artifacts', hint: 'Show or hide the artifact panel', run: () => toggleArtifacts() },
  { name: 'Import a chat', hint: 'Bring in a transcript from another tool', run: () => openImport() },
  { name: 'Settings', hint: 'Open settings', run: () => { location.href = './settings.html'; } },
  { name: 'Providers', hint: 'Open the providers screen', run: () => { location.href = './providers.html'; } },
];

function openPalette() {
  $('palette-backdrop').hidden = false;
  $('palette-input').value = '';
  renderPalette('');
  $('palette-input').focus();
}

function closePalette() {
  $('palette-backdrop').hidden = true;
}

function renderPalette(query) {
  const host = $('palette-list');
  const q = query.trim().toLowerCase();
  host.replaceChildren();

  const commands = PALETTE_COMMANDS.filter((c) => !q || c.name.toLowerCase().includes(q));
  const chats = q
    ? state.sessions.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 5)
    : [];

  for (const c of commands) {
    const item = button('', { className: 'palette-item', role: 'option' });
    item.append(element('span', { className: 'palette-name', textContent: c.name }),
      element('span', { className: 'palette-hint', textContent: c.hint }));
    item.addEventListener('click', () => { closePalette(); c.run(); });
    host.append(item);
  }

  for (const s of chats) {
    const item = button('', { className: 'palette-item', role: 'option' });
    item.append(element('span', { className: 'palette-name', textContent: s.title }),
      element('span', { className: 'palette-hint', textContent: 'chat' }));
    item.addEventListener('click', () => { closePalette(); location.href = `./index.html?s=${s.id}`; });
    host.append(item);
  }

  if (!host.children.length) {
    host.append(element('div', { className: 'picker-empty', textContent: 'Nothing matches.' }));
  }
}

// ---------------------------------------------------------------------------
// import

function openImport() {
  $('import-backdrop').hidden = false;
  $('import-error').textContent = '';
  $('import-text').value = '';
  $('import-text').focus();
}

function closeImport() {
  $('import-backdrop').hidden = true;
}

async function runImport() {
  const content = $('import-text').value;
  $('import-error').textContent = '';
  try {
    const result = await sendJSON('/api/import', 'POST', { content });
    closeImport();
    await loadSessions();
    location.href = `./index.html?s=${result.session.id}`;
  } catch (err) {
    $('import-error').textContent = err.message ?? 'That file could not be imported.';
  }
}

// ---------------------------------------------------------------------------
// boot

async function boot() {
  $('new-chat').addEventListener('click', () => startNewChat({ incognito: state.incognito }));
  $('send').addEventListener('click', send);
  $('stop').addEventListener('click', () => state.streaming?.abort());

  const input = $('input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // A fully typed command runs on Enter; a half-typed one completes.
      const typed = input.value.trim();
      if (typed.startsWith('/') && COMMANDS.some((c) => c.name === typed)) {
        send();
        return;
      }
      if (!$('slash').hidden) { $('slash').querySelector('.slash-item')?.click(); return; }
      send();
    }
    if (e.key === 'Escape') $('slash').hidden = true;
  });
  input.addEventListener('input', renderSlashMenu);

  $('artifacts-toggle').addEventListener('click', () => openView('artifacts'));
  $('artifacts-close')?.addEventListener('click', () => openView(null));
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.addEventListener('click', () => openView(b.dataset.view));
  });
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => openView(null));
  });
  bindModeSwitch();
  bindModeMenu();
  $('sidebar-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('app').classList.toggle('sidebar-open');
    $('sidebar-toggle').setAttribute('aria-expanded', String(open));
  });
  // a tap outside the slid-over sidebar closes it
  document.addEventListener('click', (e) => {
    if ($('app')?.classList.contains('sidebar-open') && !e.target.closest('.sidebar')) {
      $('app').classList.remove('sidebar-open');
      $('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    }
  });
  $('export').addEventListener('click', exportChat);
  $('popout').addEventListener('click', () => {
    // The chat gets its own window, with its own sidebar.
    const target = state.sessionId ? `./index.html?s=${state.sessionId}` : './index.html';
    window.open(target, '_blank', 'noopener');
  });
  // rail-toggle carries data-view="overview", so the loop above wires it.
  $('attach').addEventListener('click', () => $('file-input').click());
  bindPushToTalk();
  $('file-input').addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });

  // Code blocks: copy from anywhere inside a rendered reply.
  $('messages').addEventListener('click', async (e) => {
    const target = e.target.closest('[data-copy]');
    if (!target) return;
    const pre = target.closest('pre');
    const code = pre?.querySelector('code')?.textContent ?? '';
    const ok = await copyText(code);
    flash(target, ok ? 'Copied' : 'Copy failed');
  });

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(async () => {
      state.query = value;
      await loadSessions();
    }, 150);
  });

  $('archived-toggle').addEventListener('click', async (e) => {
    state.archivedView = !state.archivedView;
    e.currentTarget.setAttribute('aria-pressed', String(state.archivedView));
    e.currentTarget.textContent = state.archivedView ? 'Hide archived' : 'Archived';
    await loadSessions();
  });

  // The command palette: Ctrl+K, or Ctrl+/ on some keyboards.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if ($('palette-backdrop').hidden) openPalette(); else closePalette();
    }
    if (e.key === 'Escape' && !$('palette-backdrop').hidden) closePalette();
    if (e.key === 'Escape' && !$('import-backdrop').hidden) closeImport();
  });
  $('palette-input').addEventListener('input', (e) => renderPalette(e.target.value));
  $('palette-backdrop').addEventListener('click', (e) => {
    if (e.target === $('palette-backdrop')) closePalette();
  });

  $('import').addEventListener('click', openImport);
  $('import-cancel').addEventListener('click', closeImport);
  $('import-run').addEventListener('click', runImport);
  $('import-choose').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $('import-text').value = await file.text();
    e.target.value = '';
  });
  $('import-backdrop').addEventListener('click', (e) => {
    if (e.target === $('import-backdrop')) closeImport();
  });

  $('incognito').addEventListener('click', () => {
    startNewChat({ incognito: true });
    $('error').textContent = '';
  });

  // The project controls are rebuilt whenever projects change, so the click is
  // delegated rather than bound to a button that gets replaced.
  $('projects').addEventListener('click', (e) => {
    if (e.target.closest('#new-project')) {
      state.projectOpen = !state.projectOpen;
      renderProjects();
    }
  });

  document.addEventListener('click', (e) => {
    if (state.menuFor && !e.target.closest('.session-row')) {
      state.menuFor = null;
      renderSidebar();
    }
  });

  // ---- side pane tabs ----
  $('side-pane')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.side-pane-tab');
    if (!tab) return;
    document.querySelectorAll('.side-pane-tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.side-pane-panel').forEach((p) => p.setAttribute('hidden', ''));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    const pane = tab.dataset.pane;
    state.activePane = pane;
    $(`pane-${pane}`)?.removeAttribute('hidden');
    syncPaneButtons();
    if (pane === 'terminal' && !state.terminalId) terminalStart();
    if (pane === 'terminal') terminalPoll();
  });

  // ---- terminal new ----
  $('terminal-new')?.addEventListener('click', () => terminalStart());

  // ---- terminal input ----
  const termInput = $('terminal-input');
  if (termInput) {
    termInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = termInput.value;
        termInput.value = '';
        if (state.terminalId) await terminalWrite(state.terminalId, text + '\n');
        terminalPoll();
      }
    });
  }

  // ---- folder chip ----
  $('folder-chip')?.addEventListener('click', async () => {
    const next = window.prompt('Working folder', state.session?.folder ?? '');
    if (next === null) return;
    await sessionSetting(state.sessionId, 'folder', next);
    renderComposerHeader();
  });

  // ---- branch chip ----
  $('branch-chip')?.addEventListener('click', async () => {
    const next = window.prompt('Branch', state.session?.branch ?? '');
    if (next === null) return;
    await sessionSetting(state.sessionId, 'branch', next);
    renderComposerHeader();
  });

  // ---- permission mode ----
  $('permission-mode')?.addEventListener('change', async (e) => {
    await sessionSetting(state.sessionId, 'permissionMode', e.target.value);
  });

  // ---- effort level ----
  $('effort-level')?.addEventListener('change', async (e) => {
    await sessionSetting(state.sessionId, 'effort', e.target.value);
  });

  try {
    state.providers = await getJSON('/api/providers');
    state.models = await getJSON('/api/models');
    const settings = await getJSON('/api/settings');
    state.settings = settings;
    applyTheme(settings.theme ?? 'system');
    state.language = settings.language ?? 'en';
    applyLanguage(state.language);

    if (settings.providerId && settings.model) {
      const inList = state.models.find((m) => m.id === settings.model && m.providerId === settings.providerId);
      state.selected = inList
        ? { providerId: inList.providerId, providerName: inList.providerName, model: inList.id }
        : {
        providerId: settings.providerId,
        providerName: state.providers.find((p) => p.id === settings.providerId)?.name ?? settings.providerId,
        model: settings.model,
      };
    } else if (state.models.length) {
      const first = state.models[0];
      state.selected = { providerId: first.providerId, providerName: first.providerName, model: first.id };
    } else {
      $('empty-text').innerHTML = 'No models yet. Add a provider in <a href="./providers.html">Providers</a>.';
    }
  } catch (err) {
    $('error').textContent = err.message;
  }

  renderPicker();
  await loadProjects();
  await loadSessions();
  await loadMcpServers();
  await loadAbilities();
  if (state.sessionId) await openSession(state.sessionId);
  else { paintMessages(); renderContext(null); }
  renderMode();
  renderRail();
  renderComposerHeader();
  input.focus();

  // The app can be installed as a desktop app, and opened in its own window.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // An app that cannot cache itself still works.
    });
  }
}

boot().catch((err) => {
  console.error(err);
  const box = document.getElementById('error');
  if (box) box.textContent = err.message ?? 'The app could not start.';
});
