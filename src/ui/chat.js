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
import { resolveArtifact, htmlDocument } from './artifact-content.js';
import { initBrowserPane } from './browser-pane.js';
import { initPaneLayout } from './pane-layout.js';
import { JOBS, detectJob, rankModels, jobAvailability, modelAbilities } from './model-abilities.js';

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
function say(key, vars = null) {
  const text = tr(key, state.language);
  // {name} in a string is filled in: say('agent.finished', { title: 'Researcher' }).
  return vars ? text.replace(/\{(\w+)\}/g, (whole, k) => (vars[k] ?? whole)) : text;
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
  if (state.artifactOpen) loadArtifacts().catch(() => renderArtifactList());
  renderRail();
  syncPaneButtons();
}

function syncPaneButtons() {
  const view = currentView();
  $('pane')?.classList.toggle('is-open', Boolean(view));
  $('app')?.classList.toggle('has-pane', Boolean(view));
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
    const cwd = (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder ?? undefined;
    const result = await terminalCreate({ cwd });
    state.terminalId = result.id;
    terminalPoll();
  } catch (err) {
    $('error').textContent = `Terminal failed: ${err.message}`;
  }
}

async function terminalPoll() {
  if (!state.terminalId) return;
  const output = $('terminal-output');
  try {
    // Programs the AI started in this chat get a tab each beside the shell.
    const programs = state.sessionId ? await getJSON(`/api/processes?sessionId=${state.sessionId}`).catch(() => []) : [];
    renderTerminalTabs(programs);
    const view = state.terminalView ?? 'shell';
    const atBottom = !output || output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    if (view === 'shell') {
      const result = await terminalRead(state.terminalId);
      if (output) output.textContent = result.text;
    } else {
      const log = await getJSON(`/api/processes/${view}/log`);
      if (output) output.textContent = `> ${log.command}\n${log.output}${log.running ? '' : `\n[finished, exit code ${log.exitCode}]`}`;
    }
    // Follow new output, unless the person scrolled up to read.
    if (output && atBottom) output.scrollTop = output.scrollHeight;
  } catch {
    // terminal or program may have exited
  }
  state.terminalPoll = setTimeout(terminalPoll, 1000);
}

/** Tabs above the terminal: the shell, and each program the AI started here. */
function renderTerminalTabs(programs) {
  const host = $('terminal-tabs');
  if (!host) return;
  const view = state.terminalView ?? 'shell';
  if (view !== 'shell' && !programs.some((p) => p.id === view)) state.terminalView = 'shell';
  host.hidden = !programs.length;
  $('terminal-input')?.closest('.terminal-input-row')?.toggleAttribute('hidden', (state.terminalView ?? 'shell') !== 'shell');
  const key = JSON.stringify([state.terminalView ?? 'shell', programs.map((p) => [p.id, p.running])]);
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  const tab = (id, label, running) => {
    const b = button(label, {
      className: `terminal-tab${(state.terminalView ?? 'shell') === id ? ' is-active' : ''}`, role: 'tab',
      'aria-selected': String((state.terminalView ?? 'shell') === id), title: label,
      onclick: () => { state.terminalView = id; host.dataset.key = ''; clearTimeout(state.terminalPoll); terminalPoll(); },
    });
    if (running !== undefined) b.prepend(element('span', { className: `dot${running ? '' : ' is-off'}`, 'aria-hidden': 'true' }));
    return b;
  };
  host.replaceChildren(tab('shell', say('terminal.shell')));
  for (const p of programs) {
    host.append(tab(p.id, `${say('terminal.ai')}: ${p.command.slice(0, 40)}`, p.running));
    if (p.running && (state.terminalView ?? 'shell') === p.id) {
      host.append(button(say('terminal.stop'), {
        className: 'ghost sm terminal-stop', 'aria-label': `Stop ${p.command}`,
        onclick: async () => { await sendJSON(`/api/processes/${p.id}/stop`, 'POST').catch(() => {}); host.dataset.key = ''; },
      }));
    }
  }
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

  const folder = (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder ?? null;
  const branch = (state.sessionId ? state.session?.branch : null) ?? state.pendingFolder?.branch ?? null;
  if (folderText) folderText.textContent = folder ? folder.split(/[\\/]/).filter(Boolean).pop() : say('composer.noFolder');
  $('folder-chip')?.setAttribute('title', folder ? `Working folder: ${folder}` : 'Choose a folder to work in');
  if (branchText) branchText.textContent = branch ?? say('composer.noBranch');
  if (permMode) permMode.value = state.session?.permissionMode ?? state.settings?.defaultPermissionMode ?? 'ask';
  syncModeMenu();
  if (effortLevel) effortLevel.value = state.session?.effort ?? state.settings?.defaultEffort ?? 'medium';
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
  if (state.modelAuto && state.models.length) {
    const pick = state.autoPick;
    trigger.classList.add('is-auto');
    trigger.append(
      element('span', { className: 'label', textContent: 'Auto' }),
      element('span', { className: 'meta', textContent: pick ? `· ${pick.displayName ?? pick.id}` : '· no model for this job' }),
    );
  } else if (state.selected) {
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
    if (!q) {
      const job = state.resolvedJob ?? 'chat';
      const autoItem = button('', { className: 'picker-item picker-auto', role: 'option', 'aria-selected': String(Boolean(state.modelAuto)) });
      autoItem.id = 'model-auto';
      autoItem.append(
        element('span', { className: 'model-name', textContent: 'Auto' }),
        element('span', { className: 'model-desc', textContent: `Best available for ${JOBS[job].label.toLowerCase()}, then the next if it fails` }),
      );
      autoItem.addEventListener('click', () => {
        state.modelAuto = true;
        localStorage.setItem('bunny.modelAuto', '1');
        closePicker();
        refreshAutoPreview();
      });
      list.append(autoItem);
      const best = rankModels(state.models, job).slice(0, 5);
      if (best.length) {
        list.append(element('div', { className: 'picker-group', textContent: `Best for ${JOBS[job].label}` }));
        for (const m of best) list.append(pickerItem(m, 'best'));
      }
      list.append(element('div', { className: 'picker-group picker-group-all', textContent: 'All models' }));
    }
    for (const m of matches) {
      if (m.providerId !== currentProvider) {
        currentProvider = m.providerId;
        list.append(element('div', { className: 'picker-group', textContent: m.providerName }));
      }
      list.append(pickerItem(m));
    }
    active = 0;
    highlight();
  };

  function pickerItem(m, section = '') {
      const isCurrent = !state.modelAuto && state.selected
        && state.selected.model === m.id && state.selected.providerId === m.providerId;
      const item = button('', {
        className: 'picker-item', role: 'option', 'aria-selected': String(Boolean(isCurrent)),
      });
      item.id = `model-${section}${m.providerId}-${m.id}`.replace(/[^a-zA-Z0-9-]/g, '-');
      item.dataset.model = m.id;
      item.dataset.provider = m.providerId;
      if (section) item.dataset.section = section; // the same model again, under "Best for …"
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
      const abilities = [...modelAbilities(m).abilities].filter((a) => a !== 'chat' && a !== 'research');
      if (abilities.length) item.querySelector('.model-desc')?.append(` · ${abilities.map((a) => JOBS[a].label).join(', ')}`);
      item.addEventListener('click', () => selectModel(m));
      return item;
  }

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
  state.modelAuto = false;
  localStorage.setItem('bunny.modelAuto', '0');
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
  announceFinishedChats(rows);
  state.sessions = rows;
  renderSidebar();
  watchWorkingChats();
}

/**
 * Background chats and helpers work on after a reply ends. While any is working the
 * sidebar is refreshed every few seconds, and when one finishes the person is told:
 * in the status line, and with a desktop notice if they switched notices on.
 */
const workingChats = new Map(); // id -> title
function announceFinishedChats(rows) {
  for (const s of rows) {
    if (s.agentStatus === 'working') { workingChats.set(s.id, s.title); continue; }
    if (!workingChats.has(s.id)) continue;
    workingChats.delete(s.id);
    if (s.agentStatus !== 'done' && s.agentStatus !== 'failed') continue;
    const text = s.agentStatus === 'done' ? say('agent.finished', { title: s.title }) : say('agent.stopped', { title: s.title });
    flashStatus(text, 6000);
    if (state.sessionId === s.parentId && !state.streaming) refreshSession().catch(() => {});
    if (state.settings?.notifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const note = new Notification(say('app.name'), { body: text, tag: `agent-${s.id}` });
        note.onclick = () => { window.focus(); location.assign(`./index.html?s=${s.id}`); note.close(); };
      } catch { /* notices are a help, not a requirement */ }
    }
  }
}
let workingTimer = null;
function watchWorkingChats() {
  clearTimeout(workingTimer);
  if (!state.sessions?.some((s) => s.agentStatus === 'working')) return;
  workingTimer = setTimeout(() => loadSessions().catch(() => {}), 5000);
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
  if (s.agent) {
    const label = s.agent === 'helper' ? say('agent.helper') : say('agent.background');
    a.append(element('span', { className: `tag agent-tag${s.agentStatus === 'working' ? ' is-working' : ''}`, textContent: s.agentStatus === 'working' ? `${label} · ${say('agent.working')}` : label }));
  }
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
  // The Tasks pane follows the latest plan in this chat.
  renderTasksPane([...state.messages].reverse().find((m) => m.tasks?.length)?.tasks ?? []);
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
    if (m.artifact) wrap.append(artifactCard(m.artifact));
    if (m.linked) wrap.append(linkedChatCard(m.linked));
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

  // Which model answered, when Auto chose it (and what it fell back from).
  if (m.role === 'assistant' && (m.auto || m.fellBackFrom) && m.model) {
    const job = JOBS[m.job]?.label ?? 'Chat';
    wrap.append(element('div', { className: 'msg-meta auto-meta',
      textContent: m.auto
        ? `Auto · ${job} → ${m.model}${m.fellBackFrom ? ` (${say('model.didNotAnswer', { model: m.fellBackFrom })})` : ''}`
        : say('model.answeredInstead', { model: m.model, from: m.fellBackFrom }) }));
  }
  if (m.role === 'assistant' && m.thinking) wrap.append(thinkingBlock(m.thinking));
  const body = element('div', { className: 'body' });
  if (m.role === 'assistant') body.append(renderMarkdown(m.content, { foldCode: true }));
  else body.textContent = m.content;
  wrap.append(body);

  if (m.kind === 'summary' || m.kind === 'partial') {
    wrap.append(element('div', { className: 'meta' },
      element('span', { className: 'tag', textContent: say(m.kind === 'summary' ? 'chat.summary' : 'chat.stopped') })));
  }

  // The files this reply changed can be put back.
  if (m.role === 'assistant' && m.checkpoint?.files) wrap.append(undoBar(m));

  // Task list under latest message
  if (m.tasks?.length) wrap.append(taskList(m.tasks));

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
    if (file.kind === 'audio' && file.url) {
      const audio = element('audio', { className: 'attachment-audio', controls: true, preload: 'metadata' });
      audio.src = file.url;
      const save = element('a', { className: 'attachment-meta', href: file.url, download: 'speech.wav', textContent: `Download · ${Math.max(1, Math.round((file.size ?? 0) / 1024))} KB` });
      box.append(element('div', { className: 'attachment-audio-wrap' }, audio, save));
      continue;
    }
    // A document: what kind, how long, how many pictures, all read on the server.
    const meta = file.kind === 'document' && file.label
      ? [file.label, file.pages ? `${file.pages} ${/PowerPoint|slides/i.test(file.label) ? 'slide' : /Excel|sheet/i.test(file.label) ? 'sheet' : 'page'}${file.pages === 1 ? '' : 's'}` : '',
        (file.pictures ?? []).length ? `${file.pictures.length} picture${file.pictures.length === 1 ? '' : 's'}` : '',
        `${Math.max(1, Math.round((file.size ?? 0) / 1024))} KB`].filter(Boolean).join(' · ')
      : `${Math.max(1, Math.round((file.size ?? 0) / 1024))} KB`;
    const card = element('div', { className: `attachment-file${file.kind === 'document' ? ' is-document' : ''}`, title: file.note ?? '' },
      element('span', { className: 'attachment-name', textContent: file.name }),
      element('span', { className: 'attachment-meta', textContent: meta }));
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
    if (state.settings?.artifactsEnabled !== false) act(say('chat.saveArtifact'), 'artifact', async () => promote(m));
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
  return resolveArtifact(text).kind;
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
  // The reply is drawn as Markdown while it streams, a few times a second, so long
  // code arrives already folded instead of as a wall of text.
  let paintQueued = false;
  const paintLive = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      const opened = new Set([...bodyEl.querySelectorAll('pre.is-foldable')].map((pre, i) => (pre.classList.contains('is-folded') ? -1 : i)));
      bodyEl.replaceChildren(renderMarkdown(assembled, { foldCode: true }));
      bodyEl.classList.add('is-streaming');
      [...bodyEl.querySelectorAll('pre.is-foldable')].forEach((pre, i) => {
        if (opened.has(i)) setFolded(pre, false);
        else { const code = pre.querySelector('code'); if (code) code.scrollTop = code.scrollHeight; }
      });
      bodyEl.scrollIntoView({ block: 'end' });
    });
  };
  bodyEl.textContent = '…';

  const handlers = {
    signal: controller.signal,
    onDelta: (delta) => {
      assembled += delta;
      paintLive();
      bodyEl.scrollIntoView({ block: 'end' });
    },
    onCompacted: (info) => {
      flashStatus('Compacted automatically');
      renderContext(info.after);
    },
    onDone: (info) => { meter = info?.context ?? null; },
    onError: (err) => { $('error').textContent = err.message ?? 'The request failed.'; },
    onTool: (info) => showLiveTool(bodyEl, info),
    onPermission: (info) => showLivePermission(bodyEl, info),
    onBrowser: (info) => runBrowserAction(info),
    onCapability: (info) => showLiveCapability(bodyEl, info),
    onTasks: (info) => showLiveTasks(bodyEl, info.tasks ?? []),
    onThinking: (info) => showLiveThinking(bodyEl, info.text ?? ''),
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
    bodyEl.classList.remove('is-streaming');
  }

  return { assembled, meter, aborted };
}

/** A tool step, shown above the reply while it streams ("↳ Read src/app.js"). */
function showLiveTool(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  const lines = [...msg.parentNode.querySelectorAll('.live-tool')];
  let line = lines.find((l) => l.dataset.tool === info.tool && l.dataset.status === 'running');
  if (!line) {
    line = element('div', { className: 'msg assistant live-tool' });
    line.dataset.tool = info.tool;
    line.append(renderMessage({ kind: 'tool_call', role: 'assistant', tool: info.tool, status: info.status, content: '' }).firstChild);
    msg.before(line);
  }
  line.dataset.status = info.status;
  line.querySelector('.tag')?.replaceChildren(info.status);
  if (info.result) {
    let res = line.querySelector('.tool-call-result');
    if (!res) { res = element('div', { className: 'tool-call-result' }); line.querySelector('.tool-call')?.append(res); }
    res.textContent = `→ ${String(info.result).slice(0, 500)}`;
  }
  if ((info.attachments ?? []).length && !line.querySelector('.attachments')) line.append(renderAttachments(info.attachments));
  if (info.linked && !line.querySelector('.linked-card')) {
    line.append(linkedChatCard(info.linked));
    loadSessions().catch(() => {});
  }
  if (info.artifact && info.status === 'done') {
    line.querySelector('.artifact-card')?.remove();
    line.append(artifactCard(info.artifact));
    // What the model made opens beside the chat, unless the browser is showing its work.
    loadArtifacts().then(() => (currentView() === 'browser' ? null : showArtifact(info.artifact.id))).catch(() => {});
  }
  msg.scrollIntoView({ block: 'end' });
}

/** The model's thinking: folded under "Thinking…", open it to read along. */
function thinkingBlock(text, { live = false } = {}) {
  const box = element('details', { className: `thinking${live ? ' is-live' : ''}` });
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  box.append(
    element('summary', { textContent: live ? say('thinking.live') : say('thinking.done', { words }) }),
    element('div', { className: 'thinking-text', textContent: text }),
  );
  return box;
}
function showLiveThinking(bodyEl, piece) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  let box = msg.querySelector(':scope > details.thinking');
  if (!box) {
    box = thinkingBlock('', { live: true });
    msg.insertBefore(box, bodyEl);
  }
  const textEl = box.querySelector('.thinking-text');
  textEl.textContent += piece;
  if (box.open) textEl.scrollTop = textEl.scrollHeight;
}

/** The model's checklist: drawn as one list that updates in place, and in the Tasks pane. */
function taskList(tasks) {
  const tl = element('div', { className: 'task-list', role: 'list', 'aria-label': 'Plan' });
  for (const task of tasks) {
    const ti = element('div', { className: `task-item${task.done ? ' is-done' : ''}`, role: 'listitem' });
    ti.append(element('div', { className: 'checkbox' + (task.done ? ' checked' : ''), 'aria-hidden': 'true' }),
      element('span', { className: 'text', textContent: task.text }),
      element('span', { className: 'sr', textContent: task.done ? ' (done)' : ' (to do)' }));
    tl.append(ti);
  }
  return tl;
}
function showLiveTasks(bodyEl, tasks) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  let live = msg.parentNode.querySelector('.live-tasks');
  if (!live) {
    live = element('div', { className: 'msg assistant live-tasks' });
    msg.before(live);
  }
  live.replaceChildren(taskList(tasks));
  renderTasksPane(tasks);
}
/** The Tasks pane shows the latest plan in this chat. */
function renderTasksPane(tasks) {
  const host = $('tasks-content');
  if (!host) return;
  if (!tasks?.length) {
    host.replaceChildren(element('div', { className: 'pane-empty tasks-empty' }, element('span', { textContent: say('tasks.empty') })));
    return;
  }
  const done = tasks.filter((t) => t.done).length;
  host.replaceChildren(element('p', { className: 'hint tasks-progress', textContent: say('tasks.progress', { done, total: tasks.length }) }), taskList(tasks));
}

/** "Undo file changes": put back every file this reply wrote or edited. */
function undoBar(m) {
  const n = m.checkpoint.files;
  const bar = element('div', { className: 'undo-bar' });
  if (m.checkpoint.restored) {
    bar.append(element('span', { className: 'hint', textContent: say('undo.done', { n }) }));
    return bar;
  }
  bar.append(
    element('span', { className: 'hint', textContent: say('undo.changed', { n }) }),
    button(say('undo.button'), {
      className: 'ghost sm',
      onclick: async (e) => {
        const b = e.currentTarget;
        if (!confirm(say('undo.confirm', { n }))) return;
        b.disabled = true;
        try {
          const r = await sendJSON(`/api/sessions/${state.sessionId}/checkpoints/${m.checkpoint.id}/restore`, 'POST');
          m.checkpoint.restored = true;
          bar.replaceWith(undoBar(m));
          flashStatus(say('undo.restored', { n: r.restored }));
          state.browser?.refresh?.();
        } catch (err) {
          b.disabled = false;
          $('error').textContent = err.message;
        }
      },
    }));
  return bar;
}

/** A card for another chat a step started or talked to: a helper, a background chat. */
function linkedChatCard(c) {
  const status = { working: say('card.working'), done: say('card.finished'), failed: say('card.stopped') }[c.status] ?? '';
  const card = element('div', { className: 'artifact-card linked-card' },
    element('span', { className: 'artifact-thumb thumb-chat', 'aria-hidden': 'true' }, icon('branch')),
    element('span', { className: 'artifact-card-info' },
      element('span', { className: 'artifact-card-title', textContent: c.title ?? 'Chat' }),
      element('span', { className: 'artifact-card-kind', textContent: [say('card.chat'), c.model ? c.model.split('/').pop() : '', status].filter(Boolean).join(' · ') })));
  card.append(button(say('card.openChat'), {
    className: 'ghost sm', 'aria-label': `Open the chat ${c.title ?? ''}`,
    // Leaving now would stop the reply that is still coming in.
    onclick: () => (state.streaming ? flashStatus(say('card.wait')) : location.assign(`./index.html?s=${c.id}`)),
  }));
  return card;
}

/** A card in the chat for an artifact the model made: its name, what it is, and Open. */
function artifactCard(a) {
  const kind = { html: say('card.page'), code: say('card.code'), markdown: say('card.document') }[a.kind] ?? 'Artifact';
  const card = element('div', { className: 'artifact-card' },
    element('span', { className: `artifact-thumb thumb-${a.kind ?? 'markdown'}`, 'aria-hidden': 'true' }, icon('artifact')),
    element('span', { className: 'artifact-card-info' },
      element('span', { className: 'artifact-card-title', textContent: a.title ?? 'Artifact' }),
      element('span', { className: 'artifact-card-kind', textContent: kind })));
  card.append(button(say('card.open'), {
    className: 'ghost sm', 'aria-label': `Open ${a.title ?? 'artifact'}`,
    onclick: () => showArtifact(a.id).catch((err) => { $('error').textContent = err.message.includes('404') ? 'That artifact was deleted.' : err.message; }),
  }));
  return card;
}

/** Fold or unfold a long code block in a reply. */
function setFolded(pre, folded) {
  pre.classList.toggle('is-folded', folded);
  const lines = pre.dataset.lines ?? '';
  for (const b of pre.querySelectorAll('[data-fold]')) {
    b.setAttribute('aria-expanded', String(!folded));
    b.textContent = b.classList.contains('code-fold-top') ? say(folded ? 'code.expand' : 'code.collapse') : (folded ? say('code.showAll', { n: lines }) : say('code.showLess'));
  }
}

/** The model asked for something it does not have: the person chooses. */
function showLiveCapability(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  const yesLabel = {
    code_mode: info.hasFolder ? say('cap.code') : say('cap.folder'),
    computer_use: say('cap.computer'),
    custom_tools: say('cap.build'),
    new_tool: say('cap.newTool'),
  }[info.capability] ?? 'Allow';
  const card = element('div', { className: 'permission-prompt live-permission capability-card' });
  card.append(
    element('p', { className: 'capability-eyebrow', textContent: say('cap.eyebrow') }),
    element('h4', { textContent: info.title ?? info.capability }),
  );
  if (info.reason) card.append(element('p', { className: 'capability-reason', textContent: info.reason }));
  if (info.capability === 'computer_use') card.append(element('p', { className: 'hint', textContent: say('cap.computerHint') }));
  if (info.capability === 'custom_tools') card.append(element('p', { className: 'hint', textContent: say('cap.buildHint') }));
  const actions = element('div', { className: 'permission-actions' });
  const answer = async (granted) => {
    try {
      if (granted && info.capability === 'code_mode') {
        if (!info.hasFolder) await chooseFolder();
        applyWorkMode('code', { save: true });
      }
      actions.replaceChildren(element('span', { className: 'hint', textContent: granted ? say('cap.given') : say('cap.notNow') }));
      await sendJSON(`/api/sessions/${state.sessionId}/capability/${info.id}`, 'POST', { granted });
    } catch (err) {
      actions.replaceChildren(element('span', { className: 'err', textContent: err.message }));
    }
  };
  actions.append(
    button(yesLabel, { className: 'primary', onclick: () => answer(true) }),
    button(say('cap.notNow'), { className: 'ghost', onclick: () => answer(false) }),
  );
  card.append(actions);
  msg.before(card);
  card.scrollIntoView({ block: 'end' });
}

/** The model asked to do something in the browser panel: show the panel, do it, answer. */
async function runBrowserAction(info) {
  let answer;
  try {
    if (currentView() !== 'browser') openView('browser');
    answer = await state.browser.act(info.action, info.args ?? {});
  } catch (err) {
    answer = { error: err.message };
  }
  try {
    await sendJSON(`/api/sessions/${state.sessionId}/browser/${info.id}`, 'POST', answer ?? { error: 'No answer' });
  } catch { /* the reply ended meanwhile */ }
}

/** An edit or command waiting for the person's OK. */
function showLivePermission(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  const card = element('div', { className: 'permission-prompt live-permission' });
  card.append(element('h4', { textContent: `Allow: ${info.title}?` }));
  if (info.detail) card.append(element('pre', { className: 'code' }, element('code', { textContent: info.detail })));
  const actions = element('div', { className: 'permission-actions' });
  const answer = async (allowed) => {
    actions.replaceChildren(element('span', { className: 'hint', textContent: allowed ? 'Allowed' : 'Denied' }));
    try {
      await sendJSON(`/api/sessions/${state.sessionId}/permission/${info.id}`, 'POST', { allowed });
    } catch (err) {
      actions.replaceChildren(element('span', { className: 'err', textContent: err.message }));
    }
  };
  actions.append(
    button('Allow', { className: 'primary', onclick: () => answer(true) }),
    button('Deny', { className: 'ghost', onclick: () => answer(false) }),
  );
  card.append(actions);
  msg.before(card);
  card.scrollIntoView({ block: 'end' });
}

/** Ask again for the newest reply, keeping the user turn as-is. */
/**
 * A newer version, downloaded from GitHub Releases and checked, waits for a restart.
 * The bar offers it; "Later" hides it until the next start (it installs on quit anyway).
 */
function bindUpdates() {
  const updates = window.bunnyDesktop?.updates;
  if (!updates) return;
  let dismissed = false;
  const show = (s) => {
    const bar = $('update-banner');
    if (!bar) return;
    bar.hidden = dismissed || s?.state !== 'ready';
    if (s?.state === 'ready') $('update-text').textContent = `Bunny AI ${s.latest} is ready. It installs when you restart.`;
  };
  updates.get().then(show).catch(() => {});
  updates.onStatus(show);
  $('update-install')?.addEventListener('click', () => {
    $('update-install').disabled = true;
    $('update-text').textContent = 'Restarting to update…';
    updates.install().catch(() => {});
  });
  $('update-later')?.addEventListener('click', () => { dismissed = true; $('update-banner').hidden = true; });
}

/** The model a retry or an edit asks: Auto's pick in Auto, otherwise the one picked by hand. */
function retryPick() {
  if (state.modelAuto && state.autoPick) return { providerId: state.autoPick.providerId, model: state.autoPick.id };
  return { providerId: state.selected?.providerId, model: state.selected?.model };
}

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
      // In Auto, ask again with the model Auto chose, not an older hand-picked one.
      providerId: retryPick().providerId,
      model: retryPick().model,
      workMode: state.workMode ?? 'chat',
      browserControl: Boolean(window.bunnyDesktop?.browserAct),
      vision: canSee(retryPick().providerId, retryPick().model),
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
  if (session.workMode) applyWorkMode(session.workMode);
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
  // A new chat starts in the mode the person last picked by hand, not the one the last chat was in.
  applyWorkMode(localStorage.getItem('bunny.workMode') ?? 'chat');
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

  if (!state.selected && !(state.modelAuto && state.autoPick)) { $('error').textContent = 'Choose a model first.'; return; }

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
        providerId: (state.modelAuto ? state.autoPick?.providerId : null) ?? state.selected?.providerId,
        model: (state.modelAuto ? state.autoPick?.id : null) ?? state.selected?.model,
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
      providerId: (state.modelAuto ? state.autoPick?.providerId : null) ?? state.selected?.providerId,
      model: (state.modelAuto ? state.autoPick?.id : null) ?? state.selected?.model,
      projectId: state.projectId,
    });
    state.sessionId = session.id;
    history.replaceState(null, '', `./index.html?s=${session.id}`);
    if (state.pendingFolder) {
      await sessionSetting(session.id, 'folder', state.pendingFolder.folder);
      if (state.pendingFolder.branch) await sessionSetting(session.id, 'branch', state.pendingFolder.branch);
      state.pendingFolder = null;
    }
    await sessionSetting(session.id, 'workMode', state.workMode ?? 'chat');
    const permission = $('permission-mode')?.value;
    if (permission) await sessionSetting(session.id, 'permissionMode', permission);
    const effort = $('effort-level')?.value;
    if (effort) await sessionSetting(session.id, 'effort', effort);
  }

  state.messages.push({ id: `pending-u-${Date.now()}`, role: 'user', content: text, local: true, attachments: files });
  state.messages.push({ id: `pending-a-${Date.now()}`, role: 'assistant', content: '', local: true });
  paintMessages();
  const bodyEl = $('messages').lastElementChild?.querySelector('.body');

  const job = jobFor(text, files);
  const fixed = state.selected ? [{ providerId: state.selected.providerId, id: state.selected.model, displayName: state.selected.model }] : [];
  const candidates = state.modelAuto ? rankModels(state.models, job).slice(0, 3) : fixed;
  if (!candidates.length) candidates.push(...fixed);
  // A model you picked yourself is used first. Only when it is busy (rate limit, overloaded,
  // not answering) does the reply go to the best other model for the job, and you are told.
  const fallbackOn = !state.modelAuto && state.settings?.fallbackWhenBusy !== false;
  if (fallbackOn) {
    const same = (m) => m.providerId === state.selected?.providerId && m.id === state.selected?.model;
    candidates.push(...rankModels(state.models, job).filter((m) => !same(m)).slice(0, 2));
  }
  const busy = (message) => /\b(429|500|502|503|504)\b|rate.?limit|quota|overloaded|capacity|did not answer|stopped (responding|sending)|not found for account|temporarily unavailable/i.test(message);
  let result = { meter: null, aborted: false };
  let failed = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const pick = candidates[i];
    $('error').textContent = '';
    result = await streamInto(bodyEl, {
      path: `/api/sessions/${state.sessionId}/messages`,
      payload: {
        content: text,
        retry: i > 0, // the user turn is already saved after the first try
        providerId: pick.providerId,
        model: pick.id,
        attachments: i > 0 ? [] : files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })),
        workMode: state.workMode ?? 'chat',
        browserControl: Boolean(window.bunnyDesktop?.browserAct),
        vision: canSee(pick.providerId, pick.id),
        job,
        auto: Boolean(state.modelAuto),
        fellBackFrom: failed ?? undefined,
      },
    });
    const errorText = $('error').textContent;
    const errored = Boolean(errorText) && !result.assembled?.trim();
    if (!errored || result.aborted || i === candidates.length - 1) break;
    if (!state.modelAuto && !busy(errorText)) break; // a real error with your model is shown, not hidden
    failed = pick.displayName ?? pick.id;
    flashStatus(say('model.fallback', { from: failed, to: candidates[i + 1].displayName ?? candidates[i + 1].id }), 6000);
    bodyEl.textContent = '…';
  }
  const { meter, aborted } = result;

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

// Documents travel as the file itself; the server reads them (PDF, Office, OpenDocument, RTF, e-books).
const DOCUMENT_EXT = /\.(pdf|docx?|docm|dotx?|pptx?|pptm|ppsx?|xlsx?|xlsm|odt|odp|ods|epub|rtf)$/i;
const MAX_DOCUMENT_MB = 30;

/** Read the chosen files into memory, ready to be sent. */
async function addFiles(fileList) {
  for (const file of Array.from(fileList).slice(0, 8)) {
    const isImage = file.type.startsWith('image/');
    const isDocument = !isImage && DOCUMENT_EXT.test(file.name);
    if (isDocument && file.size > MAX_DOCUMENT_MB * 1024 * 1024) {
      $('error').textContent = `${file.name} is too large. Documents must be under ${MAX_DOCUMENT_MB} MB.`;
      continue;
    }
    const data = await readFile(file, isImage || isDocument);
    if (!data) continue;
    state.pendingFiles.push({
      name: file.name, mime: file.type || (isDocument ? 'application/octet-stream' : 'text/plain'),
      kind: isImage ? 'image' : isDocument ? 'document' : 'text', data, size: file.size,
    });
  }
  renderPendingFiles();
}

/** Whether a model can look at pictures (otherwise it gets the words read from them). */
function canSee(providerId, modelId) {
  const m = (state.allModels ?? state.models ?? []).find((x) => x.id === modelId && x.providerId === providerId);
  return m ? modelAbilities(m).runs.has('see') : true;
}

function readFile(file, asDataUrl) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => resolve(String(reader.result ?? ''));
    if (asDataUrl) reader.readAsDataURL(file);
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
  // Every artifact, from every chat; the list groups this chat's first.
  state.artifacts = await getJSON('/api/artifacts');
  $('artifact-count').textContent = String(state.artifacts.length);
  renderArtifactList();
}

const ARTIFACT_KIND = { html: { label: 'Page', mark: '</>' }, code: { label: 'Code', mark: '{ }' }, markdown: { label: 'Document', mark: '¶' } };
const ICON = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/>',
  star: '<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6l5.6-.6z"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
function iconButton(name, label, onClick, extra = {}) {
  const b = button('', { className: 'icon-btn', 'aria-label': label, title: label, ...extra });
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
  b.addEventListener('click', onClick);
  return b;
}
function timeAgo(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function renderArtifactList() {
  const host = $('artifact-list');
  host.replaceChildren();
  $('artifacts')?.classList.toggle('is-viewing', Boolean(state.artifact));
  if (!state.artifacts.length) {
    host.append(element('div', { className: 'artifact-empty' },
      element('p', { className: 'artifact-empty-title', textContent: 'No artifacts yet' }),
      element('p', { className: 'hint', textContent: 'Use “Save as artifact” on a reply to keep it here.' })));
    return;
  }
  const search = element('input', {
    className: 'input sm artifact-search', type: 'search', placeholder: 'Search artifacts', 'aria-label': 'Search artifacts',
    value: state.artifactQuery ?? '',
  });
  search.addEventListener('input', () => { state.artifactQuery = search.value; paint(); search.focus(); });
  const groups = element('div', { className: 'artifact-groups' });
  host.append(search, groups);

  function row(a) {
    const kind = ARTIFACT_KIND[a.shownKind ?? a.kind] ?? ARTIFACT_KIND.markdown;
    const r = button('', { className: 'artifact-row', 'aria-label': `Open ${a.name ?? a.title}` });
    if (state.artifact?.id === a.id) r.setAttribute('aria-current', 'true');
    r.append(
      element('span', { className: `artifact-thumb thumb-${a.shownKind ?? a.kind}`, 'aria-hidden': 'true' },
        element('span', { className: 'thumb-mark', textContent: kind.mark })),
      element('span', { className: 'artifact-info' },
        element('span', { className: 'artifact-title', textContent: a.name ?? a.title }),
        element('span', { className: 'artifact-meta', textContent: `${kind.label} · v${a.versionCount} · ${timeAgo(a.updatedAt)}${a.starred ? ' · ★' : ''}` }),
        element('span', { className: 'artifact-preview', textContent: a.preview ?? '' })),
    );
    r.addEventListener('click', () => showArtifact(a.id));
    return r;
  }
  function paint() {
    groups.replaceChildren();
    const q = (state.artifactQuery ?? '').trim().toLowerCase();
    const shown = state.artifacts.filter((a) => !q || `${a.name} ${a.title} ${a.preview}`.toLowerCase().includes(q));
    const here = shown.filter((a) => state.sessionId && a.sessionId === state.sessionId);
    const other = shown.filter((a) => !here.includes(a));
    if (here.length) groups.append(element('div', { className: 'artifact-group', textContent: 'This chat' }), ...here.map(row));
    if (other.length) groups.append(element('div', { className: 'artifact-group', textContent: here.length ? 'Other chats' : 'All artifacts' }), ...other.map(row));
    if (!shown.length) groups.append(element('p', { className: 'hint artifact-none', textContent: 'Nothing matches that search.' }));
  }
  paint();
}

function closeArtifactView() {
  state.artifact = null;
  $('artifact-view').replaceChildren();
  renderArtifactList();
}

function renderArtifactView(artifact, { mode } = {}) {
  const host = $('artifact-view');
  host.replaceChildren();
  $('artifacts')?.classList.add('is-viewing');
  const current = artifact.versions.at(-1);
  const shown = resolveArtifact(current.content, artifact.kind);
  const summary = state.artifacts.find((a) => a.id === artifact.id);
  const kind = ARTIFACT_KIND[shown.kind] ?? ARTIFACT_KIND.markdown;
  // Preview for pages, documents and charts; Code shows the source. Edit is its own mode.
  const view = mode ?? state.artifactMode ?? 'preview';
  state.artifactMode = view === 'edit' ? state.artifactMode : view;

  const refresh = async (updated, nextMode) => {
    state.artifact = updated;
    await loadArtifacts();
    renderArtifactView(updated, { mode: nextMode });
  };

  // ---- header: back, name, kind and version ----
  const head = element('div', { className: 'artifact-head' },
    iconButton('back', 'All artifacts', closeArtifactView, { className: 'icon-btn artifact-back' }),
    element('div', { className: 'artifact-heading' },
      element('h3', { id: 'artifact-title', textContent: summary?.name ?? artifact.title, title: artifact.title }),
      element('span', { className: 'tag', textContent: `${kind.label} · v${artifact.versions.length}` })));

  // ---- toolbar: Preview | Code, version, actions ----
  const bar = element('div', { className: 'artifact-bar' });
  const switcher = element('div', { className: 'mode-switch artifact-switch', role: 'group', 'aria-label': 'View' });
  for (const [id, label] of [['preview', 'Preview'], ['code', 'Code']]) {
    const b = button(label, { className: view === id ? 'is-active' : '', 'aria-pressed': String(view === id) });
    b.addEventListener('click', () => { state.artifactMode = id; renderArtifactView(artifact, { mode: id }); });
    switcher.append(b);
  }
  bar.append(switcher);

  const versions = element('select', { className: 'select quiet artifact-version', 'aria-label': 'Artifact version' });
  artifact.versions.forEach((v, index) => {
    versions.append(element('option', { value: String(index), textContent: `v${index + 1} · ${new Date(v.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` }));
  });
  versions.value = String(artifact.versions.length - 1);
  const restore = button('Restore', { className: 'btn btn-sm', hidden: true });
  versions.addEventListener('change', () => { restore.hidden = Number(versions.value) === artifact.versions.length - 1; });
  restore.addEventListener('click', async () => {
    const updated = await sendJSON(`/api/artifacts/${artifact.id}/restore`, 'POST', { version: Number(versions.value) });
    await refresh(updated, view);
  });
  if (artifact.versions.length > 1) bar.append(versions, restore);

  const stage = element('div', { className: 'artifact-stage' });
  const actions = element('div', { className: 'artifact-actions' },
    iconButton('full', 'Full screen', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else stage.requestFullscreen?.().catch(() => {});
    }),
    // A real URL rather than a blob, so the tab can be shared and reloaded.
    iconButton('open', 'Open', () => window.open(`/api/artifacts/${artifact.id}/raw`, '_blank', 'noopener')),
    iconButton('print', 'Print', () => {
      // A print window with the artifact alone in it, so the page prints the document and not the app.
      const frame = window.open('', '_blank');
      if (!frame) return;
      frame.opener = null;
      frame.document.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
      frame.document.title = summary?.name ?? artifact.title;
      if (shown.kind === 'html') frame.document.body.innerHTML = shown.body;
      else {
        const pre = frame.document.createElement('pre');
        pre.textContent = shown.body;
        pre.style.whiteSpace = 'pre-wrap';
        frame.document.body.append(pre);
      }
      frame.focus();
      frame.print();
    }),
    iconButton('star', artifact.starred ? 'Remove star' : 'Star', async () => {
      const updated = await sendJSON(`/api/artifacts/${artifact.id}`, 'PATCH', { starred: !artifact.starred });
      await refresh(updated, view);
    }, { className: `icon-btn${artifact.starred ? ' is-starred' : ''}` }),
    iconButton('edit', 'Edit', () => renderArtifactView(artifact, { mode: 'edit' })),
    iconButton('trash', 'Delete', async () => {
      if (!window.confirm(`Delete “${summary?.name ?? artifact.title}”?`)) return;
      await sendJSON(`/api/artifacts/${artifact.id}`, 'DELETE');
      state.artifact = null;
      host.replaceChildren();
      await loadArtifacts();
    }, { className: 'icon-btn danger' }),
  );
  bar.append(element('span', { className: 'spacer' }), actions);
  host.append(head, bar, stage);

  // ---- the stage ----
  if (view === 'edit') {
    // Editing appends a version rather than overwriting, so earlier content stays reachable.
    const editor = element('textarea', { className: 'artifact-edit textarea', value: current.content, 'aria-label': 'Artifact content', spellcheck: false });
    const save = button('Save new version', { className: 'btn btn-primary btn-sm' });
    save.addEventListener('click', async () => {
      const updated = await sendJSON(`/api/artifacts/${artifact.id}`, 'PATCH', { content: editor.value });
      await refresh(updated, 'edit');
    });
    const cancel = button('Done', { className: 'btn btn-ghost btn-sm' });
    cancel.addEventListener('click', () => renderArtifactView(artifact, { mode: state.artifactMode ?? 'preview' }));
    stage.classList.add('is-editing');
    stage.append(editor, element('div', { className: 'artifact-edit-bar' }, cancel, save));
    editor.focus();
    return;
  }
  if (view === 'code') {
    const body = element('div', { className: 'artifact-body artifact-code' });
    body.append(renderMarkdown(`\`\`\`${shown.kind === 'html' ? 'html' : shown.lang || ''}\n${shown.body}\n\`\`\``));
    stage.append(body);
    return;
  }
  if (shown.kind === 'html') {
    // Sandboxed: no same-origin, no top navigation. The artifact can run its own
    // scripts but cannot reach the app, its storage or its API.
    const frame = element('iframe', { className: 'artifact-frame', sandbox: 'allow-scripts allow-forms allow-modals', title: summary?.name ?? artifact.title });
    frame.srcdoc = htmlDocument(shown.body);
    stage.append(frame);
  } else if (shown.kind === 'code') {
    const body = element('div', { className: 'artifact-body artifact-code' });
    body.append(renderMarkdown(`\`\`\`${shown.lang}\n${shown.body}\n\`\`\``));
    stage.append(body);
  } else {
    const body = element('div', { className: 'artifact-body' });
    // Data that describes a chart is drawn, not printed.
    const spec = state.settings?.chartsEnabled === false ? null : chartSpec(current.content);
    if (spec) {
      const chart = element('div', { className: 'artifact-chart' });
      chart.append(renderChart(spec));
      body.append(chart);
    } else {
      body.append(renderMarkdown(current.content));
    }
    stage.append(body);
  }
}

async function showArtifact(id) {
  const artifact = await getJSON(`/api/artifacts/${id}`);
  state.artifact = artifact;
  if (currentView() !== 'artifacts') openView('artifacts');
  renderArtifactList();
  renderArtifactView(artifact);
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

const WORK_MODES = ['chat', 'code'];
const MODE_HINTS = {
  chat: { placeholder: 'Send a message…', empty: 'Pick a model, then type below.' },
  code: { placeholder: 'Ask about or change the code in your folder…', empty: 'Choose a folder below, then ask Bunny to read, change or run things in it.' },
};

// Only a mode the person picks by hand becomes the default for new chats; opening a chat,
// or saying yes to Code mode on a card, changes that chat alone.
function applyWorkMode(mode, { save = false, remember = false } = {}) {
  if (mode === 'cowork' || mode === 'delegate') mode = 'code'; // retired modes: both used tools
  if (!WORK_MODES.includes(mode)) mode = 'chat';
  state.workMode = mode;
  document.body.dataset.workMode = mode;
  const input = $('input');
  if (input) input.placeholder = MODE_HINTS[mode].placeholder;
  const emptyText = $('empty-text');
  if (emptyText && state.models?.length) emptyText.textContent = MODE_HINTS[mode].empty;
  if (save && state.sessionId && !state.incognito) {
    sessionSetting(state.sessionId, 'workMode', mode).catch(() => {});
  }
  for (const m of WORK_MODES) {
    const b = $(`mode-${m}`);
    if (!b) continue;
    b.classList.toggle('is-active', m === mode);
    b.setAttribute('aria-pressed', String(m === mode));
  }
  if (remember) localStorage.setItem('bunny.workMode', mode);
}

function bindModeSwitch() {
  for (const m of WORK_MODES) {
    $(`mode-${m}`)?.addEventListener('click', () => applyWorkMode(m, { save: true, remember: true }));
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
// Auto: the job a message is, and the model that does it best

function jobFor(text, files = state.pendingFiles ?? []) {
  if (state.jobChoice && state.jobChoice !== 'auto') return state.jobChoice;
  const hasImage = files.some((f) => String(f.mime ?? '').startsWith('image/'));
  return detectJob(text, { hasImage, workMode: state.workMode });
}

/** Re-read the message box: which job, and (with Auto) which model would answer. */
function refreshAutoPreview() {
  const job = jobFor($('input')?.value ?? '');
  state.resolvedJob = job;
  state.autoPick = rankModels(state.models ?? [], job)[0] ?? null;
  const label = $('job-label');
  if (label) label.textContent = state.jobChoice === 'auto' ? `Auto · ${JOBS[job].label}` : JOBS[job].label;
  $('job-button')?.classList.toggle('is-auto', state.jobChoice === 'auto');
  renderPicker();
}

function renderJobMenu() {
  const menu = $('job-menu');
  if (!menu) return;
  const avail = jobAvailability(state.models ?? []);
  menu.replaceChildren(element('div', { className: 'menu-title', textContent: 'Job' }));
  const item = (id, label, hint, disabled = false) => {
    const b = button('', { className: `menu-item${(state.jobChoice ?? 'auto') === id ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`, role: 'menuitemradio' });
    b.append(element('span', { className: 'label' }, label, element('small', { textContent: hint })), element('span', { className: 'check', textContent: '✓' }));
    if (!disabled) b.addEventListener('click', () => {
      state.jobChoice = id;
      localStorage.setItem('bunny.job', id);
      menu.hidden = true;
      $('job-button')?.setAttribute('aria-expanded', 'false');
      renderJobMenu();
      refreshAutoPreview();
    });
    return b;
  };
  menu.append(item('auto', 'Auto', 'Work out the job from each message'), element('div', { className: 'menu-sep' }));
  for (const [id, job] of Object.entries(JOBS)) {
    const a = avail[id];
    const none = a.runnable === 0;
    const all = none ? (jobAvailability(state.allModels ?? [])[id] ?? { capable: 0, runnable: 0 }) : null;
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const hint = !none ? null
      : all.runnable ? `${plural(all.runnable, 'paid model')} can: show all models in Settings, Models`
        : all.capable ? `${plural(all.capable, 'model')} can, but Bunny cannot use them yet`
          : 'None of your models can do this yet';
    menu.append(item(id, job.label, hint ?? `${job.hint} · ${plural(a.runnable, 'model')}`, none));
  }
}

function bindAutoPickers() {
  state.jobChoice = localStorage.getItem('bunny.job') ?? 'auto';
  state.modelAuto = localStorage.getItem('bunny.modelAuto') !== '0';
  const buttonEl = $('job-button');
  const menu = $('job-menu');
  buttonEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderJobMenu();
    menu.hidden = !menu.hidden;
    buttonEl.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if (menu && !e.target.closest('#job-menu, #job-button')) menu.hidden = true; });
  let timer = null;
  $('input')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refreshAutoPreview, 250); });
  refreshAutoPreview();
}

// ---------------------------------------------------------------------------
// the folder a chat works in

/** Ask for a folder: the native dialog in the desktop app, a path box in the browser. */
async function chooseFolder() {
  const current = (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder ?? '';
  let picked = null;
  if (window.bunnyDesktop?.pickFolder) picked = await window.bunnyDesktop.pickFolder();
  else picked = await askForPath(current);
  if (picked) await useFolder(picked);
}

/** Check the folder on the server, read its git branch, and remember both. */
async function useFolder(path) {
  $('error').textContent = '';
  try {
    const { folder, branch } = await sendJSON('/api/folder/check', 'POST', { folder: path });
    if (state.sessionId && !state.incognito) {
      await sessionSetting(state.sessionId, 'folder', folder);
      await sessionSetting(state.sessionId, 'branch', branch ?? '');
      state.session = { ...state.session, folder, branch };
    } else {
      state.pendingFolder = { folder, branch };
    }
    renderComposerHeader();
    state.browser?.refresh();
    flashStatus(`Working in ${folder}`);
  } catch (err) {
    $('error').textContent = err.message;
  }
}

/** A small in-page box for a folder path (the browser cannot open a folder dialog for the server). */
function askForPath(current) {
  return new Promise((resolveValue) => {
    const backdrop = element('div', { className: 'modal-backdrop' });
    const box = element('div', { className: 'modal', role: 'dialog', 'aria-label': 'Choose a folder' });
    const input = element('input', { className: 'input', value: current, placeholder: 'D:\\Projects\\my-app', 'aria-label': 'Folder path' });
    const done = (value) => { backdrop.remove(); resolveValue(value); };
    const ok = button('Use folder', { className: 'btn btn-primary', onclick: () => done(input.value.trim() || null) });
    const cancel = button('Cancel', { className: 'btn btn-ghost', onclick: () => done(null) });
    box.append(
      element('div', { className: 'modal-head' },
        element('h3', { className: 'modal-title', textContent: 'Choose a folder to work in' }),
        element('p', { className: 'modal-sub', textContent: 'Paste the full path of a folder on this computer.' })),
      element('div', { className: 'modal-body' }, input),
      element('div', { className: 'modal-foot' }, cancel, ok),
    );
    backdrop.append(box);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
    document.body.append(backdrop);
    input.focus();
    input.select();
  });
}

// ---------------------------------------------------------------------------
// profile, account menu and the Settings window

/** Name and avatar in the sidebar come from Settings, Profile. */
/**
 * Settings, Models, "Show models": by default the picker offers only models that
 * cost nothing plus every Nvidia model. "all" shows everything a provider offers.
 */
function visibleModels(all) {
  state.allModelCount = all.length;
  state.allModels = all;
  if (state.settings?.modelFilter === 'all') return all;
  return all.filter((m) => m.providerId === 'nvidia' || m.free === true || /(?::|-)free$/i.test(m.id));
}

function applyCapabilities(settings) {
  // Settings, Capabilities, Artifacts: off hides the button and the save action.
  const on = settings?.artifactsEnabled !== false;
  const toggle = $('artifacts-toggle');
  if (toggle) toggle.hidden = !on;
  if (!on && state.artifactOpen) openView(null);
}

function applyProfile(settings) {
  const name = (settings?.displayName ?? '').trim() || 'Bunny AI';
  const label = $('account-name');
  if (label) label.textContent = name;
  const avatar = $('account-avatar');
  if (avatar) avatar.textContent = (name.match(/\p{L}|\p{N}/u)?.[0] ?? 'B').toUpperCase();
}

// Sections that live on their own page rather than inside settings.html.
const SETTINGS_PAGES = { providers: './providers.html', automation: './automation.html', customize: './customize.html' };

function openSettings(section = 'profile') {
  closeAccountMenu();
  const backdrop = $('settings-backdrop');
  if (!backdrop) return;
  backdrop.hidden = false;
  showSettingsSection(section);
  $('settings-search')?.focus();
}

function showSettingsSection(section) {
  const frame = $('settings-frame');
  const base = SETTINGS_PAGES[section] ?? './settings.html';
  const query = SETTINGS_PAGES[section] ? '?embed=1' : `?embed=1&section=${encodeURIComponent(section)}`;
  if (frame) frame.src = base + query;
  document.querySelectorAll('#settings-nav-list [data-section]').forEach((b) => {
    const on = b.dataset.section === section;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

async function closeSettings() {
  const backdrop = $('settings-backdrop');
  if (!backdrop || backdrop.hidden) return;
  backdrop.hidden = true;
  $('settings-frame')?.removeAttribute('src');
  // Settings may have changed underneath: theme, language, name, defaults, models.
  try {
    const settings = await getJSON('/api/settings');
    state.settings = settings;
    applyProfile(settings);
    applyCapabilities(settings);
    applyTheme(settings.theme ?? 'system');
    state.language = settings.language ?? 'en';
    applyLanguage(state.language);
    state.providers = await getJSON('/api/providers');
    state.models = visibleModels(await getJSON('/api/models'));
    renderPicker();
    renderComposerHeader();
    paintMessages();
  } catch { /* the chat keeps working with what it had */ }
}

function bindSettingsWindow() {
  const backdrop = $('settings-backdrop');
  if (!backdrop) return;
  $('settings-close')?.addEventListener('click', closeSettings);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSettings(); });
  document.querySelectorAll('#settings-nav-list [data-section]').forEach((b) => {
    b.addEventListener('click', () => showSettingsSection(b.dataset.section));
  });
  // The search box narrows the section list by name and keywords.
  $('settings-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#settings-nav-list [data-section]').forEach((b) => {
      const hay = `${b.textContent} ${b.dataset.keywords ?? ''}`.toLowerCase();
      b.classList.toggle('is-filtered', Boolean(q) && !hay.includes(q));
    });
    document.querySelectorAll('#settings-nav-list .settings-sep').forEach((sep) => sep.classList.toggle('is-filtered', Boolean(q)));
  });
  $('settings-search')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = [...document.querySelectorAll('#settings-nav-list [data-section]')]
      .find((b) => !b.classList.contains('is-filtered') && b.offsetParent !== null);
    if (first) showSettingsSection(first.dataset.section);
  });
  // A link inside an embedded page (for example "Back to chat") navigates this window.
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'bunny:navigate') return;
    const href = String(e.data.href);
    if (href.includes('index.html')) { closeSettings(); return; }
    const page = Object.entries(SETTINGS_PAGES).find(([, path]) => href.includes(path.slice(2)));
    if (page) showSettingsSection(page[0]);
    else if (href.includes('settings.html')) showSettingsSection('profile');
  });
  document.querySelectorAll('[data-settings]').forEach((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); openSettings(b.dataset.settings); });
  });
}

function closeAccountMenu() {
  const menu = $('account-menu');
  if (menu) menu.hidden = true;
  $('account-button')?.setAttribute('aria-expanded', 'false');
}

function bindAccountMenu() {
  const buttonEl = $('account-button');
  const menu = $('account-menu');
  if (!buttonEl || !menu) return;
  // Desktop-only entries (Quit, the Desktop app section) show inside the Electron shell.
  document.body.classList.toggle('is-desktop', Boolean(window.bunnyDesktop));
  buttonEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    buttonEl.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.menu-item')?.focus();
  });
  menu.querySelector('[data-action="palette"]')?.addEventListener('click', () => { closeAccountMenu(); openPalette(); });
  menu.querySelector('[data-action="quit"]')?.addEventListener('click', () => window.bunnyDesktop?.quit());
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAccountMenu(); buttonEl.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#account-menu, #account-button')) closeAccountMenu();
  });
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
  bindAccountMenu();
  bindSettingsWindow();
  initPaneLayout({
    // The browser tab opens its page in a new window; any other panel pops the chat out.
    onNewWindow: () => {
      const url = currentView() === 'browser' ? state.browser?.currentUrl() : '';
      if (url && /^https?:/.test(url)) window.open(url, '_blank', 'noopener');
      else $('popout')?.click();
    },
  });
  state.browser = initBrowserPane({
    getFolder: () => (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder ?? null,
    // "Run and open" for a detected dev server: the command goes to the built-in terminal.
    runInTerminal: async (command) => {
      if (!state.terminalId) await terminalStart();
      if (state.terminalId) await terminalWrite(state.terminalId, command + '\n');
    },
  });
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
  bindUpdates();
  $('file-input').addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });

  // Code blocks: copy from anywhere inside a rendered reply.
  $('messages').addEventListener('click', async (e) => {
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      const pre = fold.closest('pre');
      if (pre) setFolded(pre, !pre.classList.contains('is-folded'));
      return;
    }
    const keep = e.target.closest('[data-to-artifact]');
    if (keep) {
      if (state.incognito) { $('error').textContent = 'Incognito chats save nothing, artifacts included. Use Copy instead.'; return; }
      const pre = keep.closest('pre');
      const lang = pre?.querySelector('code')?.className.replace('language-', '') ?? '';
      const code = pre?.querySelector('code')?.textContent ?? '';
      try {
        const made = await sendJSON('/api/artifacts', 'POST', {
          sessionId: state.sessionId, title: /^(html|htm|svg)$/i.test(lang) ? 'Page from chat' : `${lang ? lang.toUpperCase() : 'Code'} from chat`,
          kind: inferKind(`\`\`\`${lang}\n${code}\n\`\`\``), content: `\`\`\`${lang}\n${code}\n\`\`\``,
        });
        await loadArtifacts();
        await showArtifact(made.id);
      } catch (err) { $('error').textContent = err.message; }
      return;
    }
    const target = e.target.closest('[data-copy]');
    if (!target) return;
    const pre = target.closest('pre');
    const code = pre?.querySelector('code')?.textContent ?? '';
    const ok = await copyText(code);
    flash(target, ok ? say('chat.copied') : 'Copy failed');
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
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      if ($('settings-backdrop').hidden) openSettings('profile'); else closeSettings();
    }
    if (e.key === 'Escape' && !$('settings-backdrop').hidden) closeSettings();
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
  $('folder-chip')?.addEventListener('click', () => chooseFolder());

  // ---- branch chip ----
  // The branch is read from the folder's git repository; clicking reads it again.
  $('branch-chip')?.addEventListener('click', async () => {
    const folder = (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder;
    if (!folder) { chooseFolder(); return; }
    await useFolder(folder);
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
    const settings = await getJSON('/api/settings');
    state.settings = settings;
    state.models = visibleModels(await getJSON('/api/models'));
    loadArtifacts().catch(() => {});
    bindAutoPickers();
    applyProfile(settings);
    applyCapabilities(settings);
    applyTheme(settings.theme ?? 'system');
    state.language = settings.language ?? 'en';
    applyLanguage(state.language);

    // The saved choice counts only while its provider is still connected; a removed or
    // disconnected one falls back to the first model there is.
    const savedConnected = state.providers.some((p) => p.id === settings.providerId && p.status === 'connected');
    if (settings.providerId && settings.model && savedConnected) {
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
