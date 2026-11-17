/**
 * The chat screen.
 *
 * Everything a person does to a conversation lives here: send, stop, retry,
 * edit, copy, branch, compact, export, and keep an artifact beside the chat.
 * Server state is fetched, never guessed; the DOM is rebuilt from `state`.
 */

import {
  getJSON, sendJSON, streamMessage, streamComplete, applyTheme, applyAppearance,
  computerScreenshot, computerClick, computerType, computerKey, computerWait, computerReset,
  terminalCreate, terminalWrite, terminalRead, terminalResize, terminalKill, terminalList,
  sessionSetting, fetchAbilities,
} from './api.js';
import { renderMarkdown } from './markdown.js';
import { orderProviders } from './provider-order.js';
import { thinkingLevels } from './thinking.js';
import { createWorking, fmtDuration } from './bunny-working.js';
import { pickGreeting } from './greetings.js';
import { applyLanguage, t as tr } from './i18n.js';
import { chartSpec, renderChart } from './chart.js';
import { resolveArtifact, htmlDocument, printDocument, PRINT_SANDBOX } from './artifact-content.js';
import { initBrowserPane } from './browser-pane.js';
import { initPaneLayout } from './pane-layout.js';
import { initWorkPanes } from './work-panes.js';
import { reachable } from './browser-pane.js';
import { JOBS, detectJob, rankModels, jobAvailability, modelAbilities, whyPicked, noEyesWarning, preferLastAnswered } from './model-abilities.js';

const $ = (id) => document.getElementById(id);

const state = {
  greetingSeed: 1 + Math.floor(Math.random() * 2147483645),
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
  openQuestion: null,      // W4-12: the live question card the reply is waiting on: { answer(text) }
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
const TOOL_VIEWS = ['terminal', 'diff', 'browser', 'file', 'tasks'];

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

async function terminalStart({ fresh = false } = {}) {
  if (state.terminalId && !fresh) return;
  if (state.terminalId) terminalStop();
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
  // Before the first message there is no session yet: what the person chose is held in pendingMode, not forgotten.
  if (permMode) permMode.value = (state.sessionId ? state.session?.permissionMode : state.pendingMode) ?? state.settings?.defaultPermissionMode ?? 'ask';
  syncModeMenu();
  if (effortLevel) effortLevel.value = (state.sessionId ? state.session?.effort : state.pendingEffort) ?? state.settings?.defaultEffort ?? 'medium';
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

/** The provider's own colour: the same name always gives the same hue. */
function chipDot(providerName) {
  let h = 0;
  for (const ch of String(providerName)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const dot = element('span', { className: 'chip-dot', 'aria-hidden': 'true' });
  dot.style.setProperty('--chip-hue', String(h));
  return dot;
}

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
      chipDot(pick?.providerName ?? 'auto'),
      element('span', { className: 'label', textContent: 'Auto' }),
      element('span', { className: 'meta', textContent: pick ? `· ${pick.displayName ?? pick.id}` : '· no model for this job' }),
    );
    if (pick?.freeKind) trigger.append(element('span', { className: 'chip-free', textContent: 'Free' }));
    const full = pick ? `Auto: ${pick.displayName ?? pick.id} (${pick.providerName})` : 'Auto: no model for this job';
    trigger.title = full; trigger.setAttribute('aria-label', `Model: ${full}`);
  } else if (state.selected) {
    const row = state.models.find((m) => m.id === state.selected.model && m.providerId === state.selected.providerId) ?? state.models.find((m) => m.id === state.selected.model);
    const name = row?.displayName ?? state.selected.model;
    trigger.append(chipDot(state.selected.providerName), element('span', { className: 'label', textContent: name }));
    if (row?.freeKind) trigger.append(element('span', { className: 'chip-free', textContent: row.freeKind === 'daily' ? 'Free daily' : 'Free' }));
    trigger.title = `${name} (${state.selected.providerName})`; trigger.setAttribute('aria-label', `Model: ${name}, ${state.selected.providerName}`);
  } else {
    trigger.append(element('span', {
      className: 'label',
      textContent: state.models.length ? say('chat.chooseModel') : hiddenModelCount() ? `${hiddenModelCount()} ${hiddenModelCount() === 1 ? 'model is' : 'models are'} hidden` : say('chat.noModels'),
    }));
  }
  trigger.append(icon('chevron'));
  host.append(trigger);

  if (!state.models.length) {
    // Models exist but the "Show models" setting hides them: one click shows them. Otherwise there is nothing yet: add a provider.
    if (hiddenModelCount()) trigger.addEventListener('click', () => { showAllModels().catch((err) => { $('error').textContent = err.message; }); });
    else trigger.addEventListener('click', () => { location.href = './providers.html'; });
    return;
  }

  trigger.addEventListener('click', () => {
    if (host.querySelector('.picker-panel')) { closePicker(); return; }
    openPicker(host, trigger);
  });
}

/** The person's own provider order, on this computer: {person: [...ids], models: {modelId: [...ids]}}. */
function readProviderOrder() {
  try {
    const o = JSON.parse(localStorage.getItem('bunny.providerOrder') || '{}');
    return { person: Array.isArray(o.person) ? o.person : [], models: o.models && typeof o.models === 'object' ? o.models : {} };
  } catch { return { person: [], models: {} }; }
}

/** The rows of one model (one per provider) in the order Bunny tries them: Free first, then the person's own order. */
function providerRowsInOrder(group) {
  const saved = readProviderOrder();
  const order = orderProviders(group.map((m) => m.providerId), {
    free: Object.fromEntries(group.map((m) => [m.providerId, m.freeKind ?? null])),
    personOrder: saved.person, modelOrder: saved.models[group[0].id] ?? [],
    out: Object.fromEntries(group.filter((m) => m.unavailable).map((m) => [m.providerId, true])),
  });
  return order.map((id) => group.find((m) => m.providerId === id));
}

/** W4-13b: the Thinking level the person chose for a model (kept on this computer), or null for Default and for a provider whose field is not known. */
function chosenThinking(providerId, modelId) {
  try {
    const level = JSON.parse(localStorage.getItem('bunny.thinking') || '{}')[modelId];
    return thinkingLevels(providerId).includes(level) ? level : null;
  } catch { return null; }
}
function writeThinking(modelId, level) {
  try {
    const all = JSON.parse(localStorage.getItem('bunny.thinking') || '{}');
    if (level) all[modelId] = level; else delete all[modelId];
    localStorage.setItem('bunny.thinking', JSON.stringify(all));
  } catch { /* private window: the choice lasts until the page closes */ }
}

/** W3-8: the model that answered last (kept on this computer), for Auto to start from. */
function lastAnswered() {
  try { const v = JSON.parse(localStorage.getItem('bunny.lastAnswered') || 'null'); return v && typeof v.id === 'string' ? v : null; } catch { return null; }
}
function rememberAnswered(m) {
  try { localStorage.setItem('bunny.lastAnswered', JSON.stringify({ providerId: m.providerId, id: m.id })); } catch { /* private window */ }
}

/** A short list of model ids kept on this computer (favourites, recent). */
function readList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function writeList(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private window: the list lives only until the page closes */ } }
function rememberRecent(modelId) { writeList('bunny.recent', [modelId, ...readList('bunny.recent').filter((id) => id !== modelId)].slice(0, 5)); }

function closePicker() {
  document.querySelector('.picker-panel')?.remove();
  document.querySelector('.picker-scrim')?.remove();
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

  // W4-13: filters combine with AND; a model must have a provider that fits Provider and Free together
  const filters = { providers: new Set(), abilities: new Set(), freeOnly: false };
  const filterCount = () => filters.providers.size + filters.abilities.size + (filters.freeOnly ? 1 : 0);
  const CAN_DO = ['code', 'see', 'image', 'video', 'speech'];
  // Speech is shown and filtered only for models that make sound themselves; any chat model can be read out by a Windows voice
  const has = (m, a) => (a === 'speech' ? modelAbilities(m).nativeSpeech : modelAbilities(m).abilities.has(a));
  let sort = 'recommended';
  const SORTS = [['recommended', 'Recommended'], ['name', 'Name'], ['context', 'Context size']];
  const filtersBtn = button('Filters', { className: 'picker-filters-btn', 'aria-expanded': 'false' });
  const bar = element('div', { className: 'picker-filters', hidden: true });
  const count = element('div', { className: 'picker-count', hidden: true });
  const providerNames = new Map(state.models.map((m) => [m.providerId, m.providerName]));
  const chipFor = (label, on, toggle) => {
    const c = button(label, { className: 'picker-chip', 'aria-pressed': String(on) });
    c.addEventListener('click', () => { toggle(); paintBar(); paint(search.value); });
    return c;
  };
  const paintBar = () => {
    bar.replaceChildren(
      element('span', { className: 'picker-chip-label', textContent: 'Provider' }),
      ...[...providerNames].map(([id, name]) => chipFor(name, filters.providers.has(id), () => { if (!filters.providers.delete(id)) filters.providers.add(id); })),
      element('span', { className: 'picker-chip-label', textContent: 'Can do' }),
      ...CAN_DO.map((a) => chipFor(JOBS[a].label, filters.abilities.has(a), () => { if (!filters.abilities.delete(a)) filters.abilities.add(a); })),
      chipFor('Free only (Free and Free daily)', filters.freeOnly, () => { filters.freeOnly = !filters.freeOnly; }),
      element('span', { className: 'picker-chip-label', textContent: 'Sort' }),
      ...SORTS.map(([id, label]) => chipFor(label, sort === id, () => { sort = id; })),
    );
    if (filterCount()) {
      const clear = button('Clear filters', { className: 'picker-clear' });
      clear.addEventListener('click', () => { filters.providers.clear(); filters.abilities.clear(); filters.freeOnly = false; paintBar(); paint(search.value); });
      bar.append(clear);
    }
    filtersBtn.textContent = filterCount() ? `Filters · ${filterCount()}` : 'Filters';
  };
  filtersBtn.addEventListener('click', () => { bar.hidden = !bar.hidden; filtersBtn.setAttribute('aria-expanded', String(!bar.hidden)); });
  paintBar();

  panel.append(element('button', { className: 'picker-handle', type: 'button', 'aria-label': 'Close the model list', tabIndex: -1 }), search, filtersBtn, bar, count, list);
  panel.querySelector('.picker-handle').addEventListener('click', () => { closePicker(); trigger.focus(); });
  // On a phone the list is a bottom sheet over a dimmed page; a tap on the dimmed page closes it
  const scrim = element('div', { className: 'picker-scrim' });
  scrim.addEventListener('click', () => { closePicker(); trigger.focus(); });
  host.append(scrim, panel);
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

  // The default setting shows only free and Nvidia models: the last row says what is left out and shows it. It is
  // part of the list, so the arrow keys reach it and Enter uses it.
  const addShowAll = () => {
    const hidden = hiddenModelCount();
    if (!hidden) return;
    const more = button(`Show all models (${hidden} more)`, { className: 'picker-item picker-show-all', role: 'option', 'aria-selected': 'false' });
    more.id = 'model-show-all';
    more.addEventListener('click', () => { closePicker(); showAllModels().catch((err) => { $('error').textContent = err.message; }); });
    list.append(more);
  };

  const paint = (query) => {
    const q = query.trim().toLowerCase();
    list.replaceChildren();
    const filtered = filterCount() > 0;
    const rows = state.models.filter((m) =>
      (!q || m.id.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q))
      && (!filters.providers.size || filters.providers.has(m.providerId))
      && (!filters.abilities.size || [...filters.abilities].every((a) => has(m, a)))
      && (!filters.freeOnly || m.freeKind));
    // one entry per model; every provider that serves it (and fits the filters) is a tag
    const byModel = new Map();
    for (const m of rows) { if (!byModel.has(m.id)) byModel.set(m.id, []); byModel.get(m.id).push(m); }
    const totalModels = new Set(state.models.map((m) => m.id)).size;
    count.hidden = !filtered && !q;
    count.textContent = `${byModel.size} of ${totalModels} models`;
    const matches = rows;
    if (!matches.length) {
      list.append(element('div', { className: 'picker-empty', textContent: say('chat.noModelMatches') }));
      addShowAll();
      active = 0;
      highlight();
      return;
    }
    let currentProvider = null;
    if (!q && !filtered) { // filtering hides Auto and the suggestions, as drawn
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
        $('picker-button')?.focus();
      });
      list.append(autoItem);
      const favs = readList('bunny.favourites');
      const groupOf = (id) => { const g = state.models.filter((m) => m.id === id); return g.length ? g : null; };
      for (const [label, ids, key] of [['Favourites', favs, 'fav-'], ['Recent', readList('bunny.recent').filter((id) => !favs.includes(id)), 'recent-']]) {
        const groups = ids.map(groupOf).filter(Boolean);
        if (!groups.length) continue;
        list.append(element('div', { className: 'picker-group', textContent: label }));
        for (const g of groups) list.append(modelItem(g, key));
      }
      const bestIds = [...new Set(rankModels(state.models, job).map((m) => m.id))].slice(0, 5);
      if (bestIds.length) {
        list.append(element('div', { className: 'picker-group', textContent: `Best for ${JOBS[job].label}` }));
        for (const id of bestIds) list.append(modelItem(state.models.filter((m) => m.id === id), 'best-'));
      }
      list.append(element('div', { className: 'picker-group picker-group-all', textContent: 'All models' }));
    }
    const groups = [...byModel.values()];
    const top = (g) => Math.max(0, ...g.map((m) => Number(m.contextLength) || 0));
    const nameOf = (g) => String(g[0].displayName ?? g[0].id);
    if (sort === 'name') groups.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }));
    else if (sort === 'context') groups.sort((a, b) => top(b) - top(a) || nameOf(a).localeCompare(nameOf(b)));
    for (const group of groups) list.append(modelItem(group));
    addShowAll();
    active = 0;
    highlight();
  };

  // One row per model: its name, its context size, and every provider as a tag in the order Bunny tries them (Free first, then Free daily).
  const rowsInOrderOf = providerRowsInOrder;

  function modelItem(group, section = '') {
    const first = group[0];
    const rowsInOrder = rowsInOrderOf(group);
    const chosen = rowsInOrder[0];
    const item = pickerItem(chosen);
    item.classList.add('picker-model');
    if (section) item.dataset.section = section.replace(/-$/, ''); // the same model again, under Best for / Favourites / Recent
    item.id = `model-${section}${first.id}`.replace(/[^a-zA-Z0-9-]/g, '-');
    if (readList('bunny.favourites').includes(first.id)) item.querySelector('.model-name')?.append(element('span', { className: 'picker-star', textContent: '★', title: 'Favourite' }));
    const tags = element('span', { className: 'picker-tags' });
    for (const m of rowsInOrder) {
      const tag = element('span', { className: 'picker-tag' + (m.unavailable ? ' is-out' : ''), textContent: m.providerName });
      if (m.freeKind) tag.append(element('span', { className: 'picker-free', textContent: m.freeKind === 'daily' ? 'Free daily' : 'Free' }));
      tags.append(tag);
    }
    item.append(tags);
    // the details open from their own button beside the row (a button inside a button is not valid)
    const more = button('Details ›', { className: 'picker-details-link', 'aria-label': `Details for ${first.displayName ?? first.id}` });
    more.addEventListener('click', (e) => { e.stopPropagation(); openDetails(group); });
    const ctx = compactContext(rowsInOrder.reduce((n, m) => Math.max(n, Number(m.contextLength) || 0), 0));
    return element('div', { className: 'picker-row' }, item, ctx ? element('span', { className: 'picker-ctx', title: 'Context size', textContent: ctx }) : '', more);
  }

  // The details of one model: its providers in the order Bunny tries them (move with the arrows, saved on this computer per model) and a favourite.
  function openDetails(group) {
    const first = group[0];
    const parts = [search, filtersBtn, bar, count, list];
    const wasHidden = parts.map((p) => p.hidden);
    parts.forEach((p) => { p.hidden = true; });
    const det = element('div', { className: 'picker-details', role: 'region', 'aria-label': `${first.displayName ?? first.id} details` });
    const back = button('‹ Back', { className: 'picker-back' });
    const leave = () => { det.remove(); parts.forEach((p, i) => { p.hidden = wasHidden[i]; }); paint(search.value); search.focus(); };
    back.addEventListener('click', leave);
    det.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); leave(); } });
    const move = (id, by) => {
      const ids = rowsInOrderOf(group).map((m) => m.providerId);
      const at = ids.indexOf(id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= ids.length) return;
      [ids[at], ids[to]] = [ids[to], ids[at]];
      const saved = readProviderOrder();
      saved.models[first.id] = ids;
      try { localStorage.setItem('bunny.providerOrder', JSON.stringify(saved)); } catch { /* kept for this page only */ }
      draw(id, by);
    };
    const draw = (focusId, by) => {
      const rows = rowsInOrderOf(group);
      const isFav = readList('bunny.favourites').includes(first.id);
      const abilities = [...modelAbilities(first).abilities].filter((a) => a !== 'chat' && a !== 'research' && (a !== 'speech' || modelAbilities(first).nativeSpeech)).map((a) => JOBS[a].label);
      const fav = button(isFav ? '★ Remove from favourites' : '☆ Add to favourites', { className: 'picker-fav', 'aria-pressed': String(isFav) });
      fav.addEventListener('click', () => {
        const now = readList('bunny.favourites');
        writeList('bunny.favourites', now.includes(first.id) ? now.filter((id) => id !== first.id) : [first.id, ...now]);
        draw();
      });
      const order = element('ol', { className: 'picker-order' });
      rows.forEach((m, i) => {
        const up = button('↑', { className: 'picker-move', 'aria-label': `Move ${m.providerName} up` });
        const down = button('↓', { className: 'picker-move', 'aria-label': `Move ${m.providerName} down` });
        up.disabled = i === 0;
        down.disabled = i === rows.length - 1;
        up.addEventListener('click', () => move(m.providerId, -1));
        down.addEventListener('click', () => move(m.providerId, 1));
        const name = element('span', { className: 'picker-order-name', textContent: m.providerName });
        if (m.freeKind) name.append(element('span', { className: 'picker-free', textContent: m.freeKind === 'daily' ? 'Free daily' : 'Free' }));
        order.append(element('li', { 'data-provider': m.providerId },
          element('span', { className: 'picker-order-n', textContent: String(i + 1) }), name,
          element('span', { className: 'picker-order-state' + (m.unavailable ? ' is-out' : ''), textContent: m.unavailable ? 'Unavailable' : 'Ready' }), up, down));
      });
      // W4-13b: Thinking, for a provider whose field is known; hidden for any other
      const levels = thinkingLevels(rows[0].providerId);
      const nowLevel = chosenThinking(rows[0].providerId, first.id);
      const think = levels.length ? element('div', { className: 'picker-thinking' },
        element('div', { className: 'picker-details-k', textContent: 'Thinking' }),
        element('div', { className: 'picker-seg', role: 'group', 'aria-label': 'Thinking' }, ...['default', ...levels].map((lv) => {
          const on = (lv === 'default' && !nowLevel) || lv === nowLevel;
          const b = button(lv[0].toUpperCase() + lv.slice(1), { className: 'picker-chip', 'aria-pressed': String(on) });
          b.addEventListener('click', () => { writeThinking(first.id, lv === 'default' ? null : lv); draw(); });
          return b;
        }))) : null;
      det.replaceChildren(
        back,
        element('h3', { textContent: first.displayName ?? first.id }),
        element('div', { className: 'picker-details-meta', textContent: [first.contextLength ? `${Number(first.contextLength).toLocaleString()} tokens of context` : '', ...abilities].filter(Boolean).join(' · ') || first.id }),
        element('div', { className: 'picker-details-k', textContent: 'Providers, in the order Bunny tries them' }),
        order,
        element('div', { className: 'picker-details-note', textContent: rows.length > 1 ? 'The first one is used when you pick this model. The order is kept on this computer.' : 'Only one provider has this model.' }),
        ...(think ? [think] : []),
        fav,
      );
      if (focusId) {
        const li = [...det.querySelectorAll('li')].find((x) => x.dataset.provider === focusId);
        const target = li?.querySelectorAll('.picker-move')[by < 0 ? 0 : 1];
        (target && !target.disabled ? target : det.querySelector('.picker-back')).focus();
      }
    };
    draw();
    panel.append(det);
    det.querySelector('.picker-back').focus();
  }

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
          textContent: m.id,
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
      const abilities = [...modelAbilities(m).abilities].filter((a) => a !== 'chat' && a !== 'research' && (a !== 'speech' || modelAbilities(m).nativeSpeech));
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
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePicker(); trigger.focus(); } });
  setTimeout(() => {
    // a click on something inside the picker that was rebuilt by that very click (the arrows in the details) is not outside
    const outside = (ev) => {
      if (!document.querySelector('.picker-panel')) { document.removeEventListener('click', outside); return; }
      if (!host.contains(ev.target) && ev.target.isConnected) { document.removeEventListener('click', outside); closePicker(); }
    };
    document.addEventListener('click', outside);
  }, 0);
}

// 1048576 -> "1M", 262144 -> "256K", 128000 -> "128K"
function compactContext(n) {
  if (!n) return '';
  if (n >= 900000) return `${Math.round(n / 1e5) / 10}M`.replace('.0M', 'M');
  return `${Math.round(n % 1000 === 0 ? n / 1000 : n / 1024)}K`;
}

async function selectModel(m) {
  rememberRecent(m.id);
  state.modelAuto = false;
  localStorage.setItem('bunny.modelAuto', '0');
  state.selected = { providerId: m.providerId, providerName: m.providerName, model: m.id };
  closePicker();
  renderPicker();
  $('picker-button')?.focus();
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
  if (!state.sessions?.some((s) => s.agentStatus === 'working' || s.replyStatus === 'working' || s.replyStatus === 'needs-you')) return;
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
    // Under its own project's heading a chat does not need the project's name again.
    if (!collapsed) for (const s of members) { const r = renderSessionRow(s, 0); r.querySelector('.project-tag')?.remove(); host.append(r); }
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
  const row = element('div', { className: `project-head-row${collapsed ? ' collapsed' : ''}` });
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
  // A new chat straight into this project: it follows the project's instructions.
  const add = button('＋', {
    className: 'ghost project-new-chat', title: `New chat in ${project.name}`, 'aria-label': `New chat in ${project.name}`,
    onclick: () => newChatInProject(project.id),
  });
  row.append(head, add);
  return row;
}

/** Start a chat that belongs to a project (its instructions apply from the first message). */
function newChatInProject(projectId) {
  state.projectId = projectId;
  state.projectEdit = null;
  renderProjects();
  startNewChat({ incognito: false });
  renderSidebar();
  const name = state.projects.find((p) => p.id === projectId)?.name ?? 'the project';
  flashStatus(`New chat in ${name}: it is saved there when you send the first message`, 5000);
  const empty = $('empty-text');
  if (empty) empty.textContent = `This chat will be saved in ${name} and follow its instructions.`;
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
  // Settings → Code → Label chats by status.
  const STATUS = { working: 'Working', 'needs-you': 'Needs you', ready: 'Ready', failed: 'Failed' };
  if (state.settings?.statusLabels !== false && STATUS[s.replyStatus] && !(s.id === state.sessionId && s.replyStatus === 'ready')) {
    a.append(element('span', { className: `tag status-tag is-${s.replyStatus}`, textContent: STATUS[s.replyStatus] }));
  }
  if (s.id === state.sessionId && state.streaming) {
    // A live dot marks a session that is working right now.
    a.append(element('span', { className: 'dot', role: 'img', 'aria-label': 'Working' }));
  }
  a.append(element('span', { className: 'session-title', textContent: s.title }));
  if (s.projectId) a.append(element('span', { className: 'tag project-tag', textContent: projectName(s.projectId) }));

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
    const next = await askText({ title: 'Rename chat', value: s.title, label: 'Chat name', action: 'Rename' });
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
    state.projectEdit = null;
    renderProjects(); // the edit button belongs to the chosen project
    await loadSessions();
  });

  host.append(select);
  const current = state.projects.find((p) => p.id === state.projectId);
  // The chosen project can be renamed, given new instructions, or deleted.
  if (current) {
    const edit = button('', { id: 'edit-project', 'aria-label': `Edit project ${current.name}`, title: 'Rename, edit or delete this project', className: 'ghost' });
    edit.append(icon('edit'));
    edit.addEventListener('click', () => { state.projectEdit = state.projectEdit === current.id ? null : current.id; state.projectOpen = false; renderProjects(); });
    host.append(edit);
  }
  host.append(button('＋', { id: 'new-project', 'aria-label': 'New project', className: 'ghost' }));

  if (current && state.projectEdit === current.id) {
    const form = element('form', { className: 'project-form', 'aria-label': `Edit project ${current.name}` });
    const name = element('input', { value: current.name, placeholder: 'Project name', 'aria-label': 'Project name' });
    const instructions = element('textarea', {
      rows: 3, placeholder: 'Standing instructions (optional)', 'aria-label': 'Project instructions',
    });
    instructions.value = current.instructions ?? '';
    const err = element('div', { className: 'err', role: 'alert' });
    const close = () => { state.projectEdit = null; renderProjects(); };
    form.append(name, instructions, element('div', { className: 'actions' },
      button('Save', { type: 'submit', className: 'primary' }),
      button('Cancel', { className: 'ghost', onclick: close }),
      button('Delete project', {
        className: 'ghost danger-text',
        onclick: async () => {
          const count = state.sessions.filter((s) => s.projectId === current.id).length;
          if (!confirm(`Delete the project "${current.name}"? Its ${count} chat${count === 1 ? '' : 's'} will stay, under All chats.`)) return;
          try {
            await sendJSON(`/api/projects/${current.id}`, 'DELETE');
            state.projectEdit = null;
            state.projectId = null;
            await loadProjects();
            await loadSessions();
            flashStatus(`Deleted the project "${current.name}"`);
          } catch (ex) { err.textContent = ex.message; }
        },
      })), err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      try {
        await sendJSON(`/api/projects/${current.id}`, 'PATCH', { name: name.value, instructions: instructions.value });
        state.projectEdit = null;
        await loadProjects();
        renderSidebar();
        flashStatus('Project saved');
      } catch (ex) { err.textContent = ex.message; }
    });
    host.append(form);
    name.focus();
    name.select();
  }

  if (state.projectOpen) {
    const form = element('form', { className: 'project-form' });
    const name = element('input', { placeholder: 'Project name', 'aria-label': 'Project name' });
    const instructions = element('textarea', {
      rows: 2, placeholder: 'Standing instructions (optional)', 'aria-label': 'Project instructions',
    });
    const save = button('Create', { type: 'submit', className: 'primary' });
    form.append(name, instructions, element('div', { className: 'actions' }, save,
      button('Cancel', { className: 'ghost', onclick: () => { state.projectOpen = false; renderProjects(); } })));
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
  // D-2: consecutive tool steps between two pieces of narration are ONE group line, collapsed once finished.
  let run = [];
  const flushRun = () => { if (run.length) host.append(...buildToolGroup(run)); run = []; };
  const groupable = (m) => m.kind === 'tool_call' && !m.needsSignIn && !m.question && !m.artifact && !m.linked && !(m.attachments ?? []).length;
  // W4-5c: a reply saves ONE thinking text; when steps came before its answer, its "Thought for" row goes before the first of them
  // (thinking, then the step it led to), the same order the live line settles in.
  const thoughtAt = new Map();
  state.messages.forEach((m, index) => {
    if (m.role !== 'assistant' || m.kind === 'tool_call' || !m.thinking) return;
    let first = index;
    while (first > 0 && state.messages[first - 1].kind === 'tool_call') first -= 1;
    if (first < index) thoughtAt.set(first, m);
  });
  const early = new Set(thoughtAt.values());
  state.messages.forEach((m, index) => {
    if (thoughtAt.has(index)) {
      flushRun();
      const t = thoughtAt.get(index);
      host.append(thoughtRow(t.thinking, t.thinkingMs));
    }
    const el = renderMessage(m, { skipThinking: early.has(m) });
    if (!groupable(m)) { flushRun(); host.append(el); return; }
    if (m.note) flushRun(); // narration starts a new group
    run.push({ m, el, last: index === state.messages.length - 1 });
  });
  flushRun();
  paintQueued(host);
  if (state.messages.length) host.lastElementChild?.scrollIntoView({ block: 'end' });
}

// ---------------------------------------------------------------------------
// D-2: tool steps as one line per run of steps

const STEP_KINDS = {
  read: { ok: ['Read a file', 'Read {n} files'], tried: ['tried to read a file', 'tried to read {n} files'], other: 'tried to read another' },
  write: { ok: ['Wrote a file', 'Wrote {n} files'], tried: ['tried to write a file', 'tried to write {n} files'], other: 'tried to write another' },
  edit: { ok: ['Edited a file', 'Edited {n} files'], tried: ['tried to edit a file', 'tried to edit {n} files'], other: 'tried to edit another' },
  run: { ok: ['Ran a command', 'Ran {n} commands'], tried: ['tried to run a command', 'tried to run {n} commands'], other: 'tried to run another' },
  search: { ok: ['Searched for a word', 'Searched {n} times'], tried: ['tried to search', 'tried to search {n} times'], other: 'tried to search again' },
  list: { ok: ['Listed a folder', 'Listed {n} folders'], tried: ['tried to list a folder', 'tried to list {n} folders'], other: 'tried to list another' },
  other: { ok: ['Used a tool', 'Used {n} tools'], tried: ['tried to use a tool', 'tried to use {n} tools'], other: 'tried to use another' },
};
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** What kind of step is "Read src/app.js" or "Run npm test": by its first word, never the raw tool id. */
function stepKind(tool) {
  const verb = String(tool ?? '').replace(/^.* › /, '').trim().split(/\s+/)[0].toLowerCase();
  if (/^(read|open|show|get|inspect|view)$/.test(verb)) return 'read';
  if (/^(write|create|make|save)$/.test(verb)) return 'write';
  if (/^(edit|update|replace|rename|delete)$/.test(verb)) return 'edit';
  if (/^(run|start|stop|install|build|test|execute)$/.test(verb)) return 'run';
  if (/^(search|find|grep|look)$/.test(verb)) return 'search';
  if (/^list$/.test(verb)) return 'list';
  return 'other';
}

/** "Read 3 files, tried to read another", in the order the steps ran, numbers under ten in words. */
function summariseSteps(steps) {
  // One search on its own says what it looked for: "Searched for /TODO\d+/ in src".
  if (steps.length === 1 && steps[0].status !== 'failed' && steps[0].status !== 'denied') {
    const what = String(steps[0].tool ?? '').replace(/^.* › /, '').trim();
    const search = /^Search (\S.*)$/.exec(what);
    const find = /^Find (\S.*)$/.exec(what);
    if (search) return `Searched for ${search[1].slice(0, 100)}`;
    if (find) return `Searched for files matching ${find[1].slice(0, 100)}`;
  }
  const parts = [];
  for (const s of steps) {
    const failed = s.status === 'failed' || s.status === 'denied';
    const kind = stepKind(s.tool);
    const part = parts.find((p) => p.kind === kind && p.failed === failed);
    if (part) part.n += 1; else parts.push({ kind, failed, n: 1 });
  }
  const text = parts.map((p, i) => {
    const t = STEP_KINDS[p.kind];
    if (p.failed && p.n === 1 && parts.some((q) => q.kind === p.kind && !q.failed)) return t.other;
    const [one, many] = p.failed ? t.tried : t.ok;
    const n = p.n < 10 ? NUMBER_WORDS[p.n] : String(p.n);
    const phrase = p.n === 1 ? one : many.replace('{n}', n);
    return i === 0 ? phrase : phrase.charAt(0).toLowerCase() + phrase.slice(1); // only the first part starts a sentence
  }).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Show the Files pane with this file open. */
function openInFilesPane(path) {
  document.querySelector('[data-view="file"]')?.click();
  state.workPanes?.openFile(path.replace(/^["']|["']$/g, ''));
}

function chevron() { return element('span', { className: 'step-chev', 'aria-hidden': 'true' }); }

/** One collapsed line for a run of steps; opening it shows one sub-row per step, each opening to its detail. */
function buildToolGroup(run) {
  const steps = run.map((r) => r.m);
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const blockedCount = steps.filter((s) => s.status === 'denied').length; // a rule, the mode or the person said no: nothing broke
  const last = run.at(-1);
  // A failed group stays collapsed, except the last failed step of a reply that ended on it.
  const openLast = last.last && last.m.status === 'failed';
  const group = element('div', { className: `tool-group${openLast ? ' is-open' : ''}` });
  const line = element('button', { className: 'tool-group-line', type: 'button', 'aria-expanded': String(Boolean(openLast)) });
  line.append(chevron(), element('span', { className: 'tool-group-summary', textContent: summariseSteps(steps) }));
  const meta = failedCount
    ? element('span', { className: 'tool-group-meta is-failed', textContent: steps.length === 1 ? 'Failed' : `${failedCount} failed` })
    : blockedCount
      ? element('span', { className: 'tool-group-meta is-blocked', textContent: steps.length === 1 ? 'Blocked' : `${blockedCount} blocked` })
      : element('span', { className: 'tool-group-meta', textContent: steps.length === 1 ? '' : `${steps.length} steps` });
  line.append(meta);
  line.addEventListener('click', () => {
    const open = !group.classList.contains('is-open');
    group.classList.toggle('is-open', open);
    line.setAttribute('aria-expanded', String(open));
  });
  const rows = element('div', { className: 'tool-group-rows' });
  for (const r of run) rows.append(r.el);
  group.append(line, rows);
  // The narration that led into the first step stays visible above the line, whether or not the group is open.
  const out = [];
  const note = run[0].el.querySelector(':scope > .step-note');
  if (note) out.push(note);
  out.push(group);
  if (openLast) last.el.querySelector('.tool-call')?.classList.add('is-open');
  return out;
}

// ---------------------------------------------------------------------------
// Zoom: the desktop app zooms the whole window; in a plain browser the page is scaled.
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
let zoomFactor = 1;
function setZoom(factor, { save = true } = {}) {
  zoomFactor = Math.min(3, Math.max(0.5, Math.round(factor * 100) / 100));
  if (window.bunnyDesktop?.zoom) window.bunnyDesktop.zoom.set(zoomFactor);
  else document.documentElement.style.zoom = zoomFactor === 1 ? '' : String(zoomFactor);
  const level = $('zoom-reset');
  if (level) level.textContent = `${Math.round(zoomFactor * 100)}%`;
  if (save) sendJSON('/api/settings', 'PUT', { uiZoom: zoomFactor }).catch(() => {});
}
function stepZoom(direction) {
  const next = direction > 0 ? ZOOM_STEPS.find((z) => z > zoomFactor + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < zoomFactor - 0.001);
  if (next) setZoom(next);
}

/** The same "random" choices again for the same seed: the greeting keeps its line when only the name changes. */
function seeded(seed) {
  let x = seed;
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
}

/** The time-of-day greeting on a fresh page. */
function paintGreeting() {
  const el = $('greeting');
  if (!el) return;
  const hour = new Date().getHours();
  // Your call-me name, else your first name, else your Windows user name.
  const name = String(state.settings?.callName || state.settings?.displayName || state.settings?.systemUserName || '').trim().split(/\s+/)[0];
  // English gets Bunny's playful lines with your name; other languages a translated hello.
  if ((state.language ?? 'en') === 'en') {
    // Picked again when the name arrives or changes, so it never sticks on a placeholder.
    if (!state.greeting || state.greetingName !== name) {
      state.greeting = pickGreeting({ name, hour, random: state.greetingSeed ? seeded(state.greetingSeed) : Math.random });
      state.greetingName = name;
    }
    el.textContent = state.greeting.head;
    el.setAttribute('aria-label', state.greeting.title);
    let more = $('greeting-more');
    if (!more) {
      more = element('p', { className: 'greeting-more', id: 'greeting-more' });
      el.after(more);
    }
    more.textContent = state.greeting.rest;
    more.hidden = !state.greeting.rest;
    const tag = document.querySelector('.empty-title');
    if (tag) tag.textContent = state.greeting.tagline;
    return;
  }
  const key = hour < 12 ? 'chat.greetingMorning' : hour < 18 ? 'chat.greetingAfternoon' : 'chat.greetingEvening';
  el.textContent = name ? `${say(key)}, ${name}` : say(key);
}

/** The title in the topbar: the chat's name, or the new-chat state. */
function renderTitle() {
  const el = $('chat-title');
  if (!el) return;
  el.textContent = state.session?.title || say('chat.new');
}

/**
 * W3-6: a connector that needs the person to sign in. The step says "Needs sign-in" and offers Sign in (the person's own browser opens,
 * and the chat carries on by itself once they are back) and Skip it (just dismisses; a later message works as usual once signed in).
 */
function signInStep(info) {
  const box = element('div', { className: 'signin-step' });
  const note = element('span', { className: 'hint' });
  const clientBox = element('input', { className: 'input', placeholder: 'Client ID', hidden: true });
  clientBox.setAttribute('aria-label', 'Client ID');
  const signIn = button('Sign in', { className: 'primary small' });
  const skip = button('Skip it', { className: 'ghost small', onclick: () => box.remove() });
  const finish = async (account) => {
    note.textContent = `Signed in as ${account ?? 'your account'}.`;
    signIn.remove(); skip.remove(); clientBox.hidden = true;
    if (!state.streaming && !$('input').value.trim()) { $('input').value = 'I have signed in. Please carry on.'; await send(); }
  };
  const begin = async () => {
    note.textContent = '';
    signIn.disabled = true;
    try {
      const out = await sendJSON(`/api/connectors/${info.serverId}/oauth/start`, 'POST', clientBox.value.trim() ? { clientId: clientBox.value.trim() } : {});
      window.open(out.authUrl, '_blank', 'noopener'); // the desktop app hands the link to the person's own browser
      note.textContent = 'Waiting for you to finish in your browser… (5 minutes)';
      const until = Date.now() + 5 * 60_000;
      while (box.isConnected && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1500));
        const now = await getJSON(`/api/connectors/${info.serverId}/oauth`).catch(() => null);
        if (now?.signedIn) return finish(now.account);
        if (now?.error) { note.textContent = now.error; break; }
      }
      if (box.isConnected && note.textContent.startsWith('Waiting')) note.textContent = 'The sign-in was not finished in 5 minutes. Try again.';
    } catch (e) {
      if (e.code === 'mcp.oauth.needsClientId') { note.textContent = 'This service does not let apps register themselves. Paste the client ID from its developer settings.'; clientBox.hidden = false; } else note.textContent = e.message;
    }
    signIn.disabled = false;
  };
  signIn.addEventListener('click', begin);
  box.append(signIn, skip, clientBox, note);
  return box;
}

function renderMessage(m, { skipThinking = false } = {}) {
  const wrap = element('div', { className: `msg ${m.role}`, dataset: { role: m.role, id: m.id ?? '' } });

  // Tool call block: collapsible, shows the tool name, args and result
  if (m.kind === 'tool_call') {
    // A question the model asked is shown as its card, with the answer, not as a step line.
    if (m.note) wrap.append(stepNote(m.note, true));
    if (m.question) { wrap.append(answeredQuestionCard(m.question)); return wrap; }
    const tc = element('div', { className: 'tool-call' });
    const header = element('div', { className: 'tool-call-header', role: 'button', tabindex: '0', 'aria-expanded': 'false' });
    header.append(chevron(), element('span', { textContent: m.tool ?? 'tool' }));
    const failedStep = m.status === 'failed' || m.status === 'denied';
    if (m.needsSignIn) header.append(element('span', { className: 'tag is-blocked', textContent: 'Needs sign-in' }));
    else if (m.status === 'denied') header.append(element('span', { className: 'tag is-blocked', textContent: 'Blocked' }));
    else if (failedStep) header.append(element('span', { className: 'tag is-failed', textContent: 'Failed' }));
    else if (m.status && m.status !== 'done') header.append(element('span', { className: 'tag', textContent: m.status }));
    // A read step opens that file in the Files pane.
    const readPath = stepKind(m.tool) === 'read' ? /^(?:.* › )?Read (.+)$/.exec(String(m.tool ?? ''))?.[1] : null;
    if (readPath && state.session?.folder && !failedStep) {
      header.append(button('Open', { className: 'ghost small tool-call-open', onclick: (e) => { e.stopPropagation(); openInFilesPane(readPath); } }));
    }
    const toggle = () => { const open = tc.classList.toggle('is-open'); header.setAttribute('aria-expanded', String(open)); };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    tc.append(header);
    const body = element('div', { className: 'tool-call-body' });
    body.textContent = m.content ?? '';
    tc.append(body);
    if (m.result) {
      const res = element('div', { className: 'tool-call-result' });
      res.textContent = `→ ${String(m.result).slice(0, resultLimit())}`;
      tc.append(res);
    }
    if (failedStep) {
      // The exact command and the error, in one click.
      const copy = button('Copy', { className: 'ghost small tool-call-copy' });
      copy.addEventListener('click', async () => { flash(copy, (await copyText(`${m.content ?? ''}
${m.result ?? ''}`.trim())) ? 'Copied' : 'Copy failed'); });
      tc.append(copy);
    }
    wrap.append(tc);
    if (m.needsSignIn && m.serverId) wrap.append(signInStep(m));
    if ((m.attachments ?? []).length) wrap.append(renderAttachments(m.attachments));
    if (m.artifact) wrap.append(artifactCard(m.artifact));
    if (m.linked) wrap.append(linkedChatCard(m.linked));
    if (m.question) wrap.append(answeredQuestionCard(m.question));
    return wrap;
  }

  // A reply that failed: why, kept in the chat.
  if (m.kind === 'error') {
    wrap.classList.add('error-note');
    // One line that opens to the provider's own words, with a way on: Try again, or choose another model.
    const group = element('div', { className: 'tool-group' });
    const line = element('button', { className: 'tool-group-line', type: 'button', 'aria-expanded': 'false' });
    line.append(chevron(), element('span', { className: 'tool-group-summary', textContent: 'The reply failed' }), element('span', { className: 'tool-group-meta is-failed', textContent: 'Failed' }));
    line.addEventListener('click', () => { const open = !group.classList.contains('is-open'); group.classList.toggle('is-open', open); line.setAttribute('aria-expanded', String(open)); });
    const rows = element('div', { className: 'tool-group-rows error-note-detail' });
    rows.append(element('p', { className: 'error-note-text', textContent: m.content ?? 'The reply failed.' }));
    const copyErr = button('Copy', { className: 'ghost small' });
    copyErr.addEventListener('click', async () => { flash(copyErr, (await copyText(m.content ?? '')) ? 'Copied' : 'Copy failed'); });
    const again = button('Try again', { className: 'primary small' });
    again.addEventListener('click', () => retry(m)); // drops this note, then asks again with the same history
    const another = button('Choose another model', { className: 'ghost small' });
    another.addEventListener('click', () => $('picker-button')?.click());
    rows.append(element('div', { className: 'error-note-actions' }, copyErr, again, another));
    group.append(line, rows);
    wrap.append(group);
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
  if (m.role === 'assistant' && m.model && (m.fellBackKind === 'provider' || m.fellBackKind === 'model')) {
    // W4-13 slice 3: one calm amber line, never an error
    const row = state.models?.find((x) => x.id === m.model && x.providerId === m.providerId) ?? state.models?.find((x) => x.id === m.model);
    const reason = reasonPhrase(m.fellBackReason);
    const text = m.fellBackKind === 'provider'
      ? say('model.switchedProvider', { model: row?.displayName ?? m.model, provider: row?.providerName ?? m.providerId ?? '', from: m.fellBackFrom, reason })
        + (m.fellBackTries > 1 ? ` (${m.fellBackTries - 1} other provider${m.fellBackTries - 1 === 1 ? '' : 's'} also failed)` : '')
      // the model the person picked by its name (not its id), the provider that failed, and how many others also failed, with no brackets inside brackets
      : say('model.switchedModel', {
        model: row?.displayName ?? m.model,
        from: state.models?.find((x) => x.id === m.fellBackFrom)?.displayName ?? m.fellBackFrom,
        provider: m.fellBackProvider ?? '',
        reason,
        more: m.fellBackTries > 1 ? `; ${m.fellBackTries - 1} other provider${m.fellBackTries - 1 === 1 ? '' : 's'} also failed` : '',
      });
    wrap.append(element('div', { className: 'msg-meta switch-note', textContent: `↪ ${text}.` }));
  } else if (m.role === 'assistant' && (m.auto || m.fellBackFrom) && m.model) {
    const job = JOBS[m.job]?.label ?? 'Chat';
    wrap.append(element('div', { className: 'msg-meta auto-meta',
      textContent: m.auto
        ? `Auto · ${job} → ${m.model}${m.fellBackFrom ? ` (${m.fellBackFrom} ${reasonPhrase(m.fellBackReason)}${alsoFailed(m.fellBackTries)})` : ''}`
        : `${say('model.answeredInstead', { model: m.model, from: m.fellBackFrom, reason: reasonPhrase(m.fellBackReason) })}${alsoFailed(m.fellBackTries)}` }));
  }
  if (m.role === 'assistant' && m.thinking && !skipThinking) wrap.append(thinkingBlock(m.thinking, { ms: m.thinkingMs }));
  const body = element('div', { className: 'body' });
  if (m.role === 'assistant') body.append(renderMarkdown(m.content, { foldCode: true }));
  else body.textContent = m.content;
  wrap.append(body);

  if (m.kind === 'summary' || m.kind === 'partial') {
    const meta = element('div', { className: 'meta' },
      element('span', { className: 'tag', textContent: say(m.kind === 'summary' ? 'chat.summary' : 'chat.stopped') }));
    // The messages above a summary are still here to read; the model reads the summary instead.
    if (m.kind === 'summary') meta.append(element('span', { className: 'hint', textContent: ' The messages above stay here; to save room, Bunny now reads this summary instead of them.' }));
    if (m.kind === 'partial') meta.append(element('span', { className: 'hint', textContent: ' Send "continue" and Bunny picks up where it stopped.' }));
    wrap.append(meta);
    if (m.kind === 'partial') {
      const report = stoppedReport(m);
      if (report) wrap.append(report);
    }
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
    state.mcpServers = (await getJSON('/api/mcp')).filter((s) => appliesHere(s.folders));
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
  renderRailDetails();

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

/** The Session pane's facts: where, which model and why, permissions, context and cost, running programs. Only what is known. */
function renderRailDetails() {
  const put = (id, text) => { const node = $(id); if (node) node.textContent = text; };
  const folder = (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder ?? null;
  const branch = (state.sessionId ? state.session?.branch : null) ?? state.pendingFolder?.branch ?? null;
  put('rail-folder', folder ? folder.split(/[\\/]/).filter(Boolean).pop() : 'No folder');
  $('rail-folder')?.setAttribute('title', folder ?? '');
  put('rail-branch', branch ?? (folder ? 'Not a git folder' : 'No branch'));
  const picked = state.selected;
  put('rail-model', picked ? picked.model : 'No model chosen');
  const autoPick = state.modelAuto && state.autoPick;
  const why = $('rail-why-row');
  if (why) { why.hidden = !autoPick; if (autoPick) put('rail-why', `Auto picked this for ${JOBS[state.lastJob]?.label?.toLowerCase() ?? 'this job'}${whyPicked(autoPick, state.lastJob) ? `: ${whyPicked(autoPick, state.lastJob)}` : ''}`); }
  const modes = { ask: 'Manual', accept: 'Accept edits', plan: 'Plan', auto: 'Auto' };
  const mode = (state.sessionId ? state.session?.permissionMode : state.pendingMode) ?? state.settings?.defaultPermissionMode ?? 'ask';
  put('rail-mode', modes[mode] ?? mode);
  put('rail-effort', ((state.sessionId ? state.session?.effort : state.pendingEffort) ?? state.settings?.defaultEffort ?? 'medium').replace(/^./, (c) => c.toUpperCase()));
  const ctx = state.session?.context;
  put('rail-tokens', ctx ? `${ctx.used.toLocaleString()} of ${ctx.limit.toLocaleString()}` : 'none yet');
  put('rail-messages', String(state.session?.messages?.length ?? state.messages.filter((m) => !m.local).length));
  // programs the AI left running (from the same list the Terminal pane uses)
  const running = $('rail-running');
  if (running && state.sessionId) {
    getJSON(`/api/processes?sessionId=${encodeURIComponent(state.sessionId)}`).then((list) => {
      running.replaceChildren();
      const live = list.filter((p) => p.running);
      if (!live.length) { running.append(element('div', { className: 'rail-empty', textContent: 'Nothing running.' })); return; }
      for (const p of live) {
        const row = element('div', { className: 'rail-row' }, element('span', { className: 'dot', role: 'img', 'aria-label': 'Running' }), element('span', { className: 'rail-value', textContent: p.command }));
        row.append(button('Stop', { className: 'ghost small', onclick: async () => { await sendJSON(`/api/processes/${p.id}/stop`, 'POST'); renderRailDetails(); } }));
        running.append(row);
      }
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// streaming

function setStreaming(on) {
  $('send').disabled = on && !state.openQuestion; // a waiting question card takes the typed reply
  $('stop').hidden = !on;
  // While the next model starts after a failure, the calm "X is slow. Trying Y…" line stays instead of "Streaming…".
  $('status').textContent = on ? (state.tryingNote || 'Streaming…') : '';
  if (!on) state.tryingNote = null;
  renderSidebar();
  renderRail();
}

/** "did not answer in time", "was busy (rate limit or overloaded)"...: why a model was left. A timeout is never "busy". */
function reasonPhrase(reason) {
  const key = `model.reason.${['timeout', 'rate-limit', 'unavailable', 'empty', 'refused', 'unreachable', 'key'].includes(reason) ? reason : 'other'}`;
  return say(key);
}

/** " (1 other model also failed)" when more than one model failed before the answer. */
function alsoFailed(tries) {
  const others = (Number(tries) || 0) - 1;
  return others > 0 ? ` (${say('model.alsoFailed', { n: others, models: others === 1 ? 'model' : 'models' })})` : '';
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
async function streamInto(bodyEl, { path, payload, mood = 'waiting', quietError = false }) {
  // quietError: the caller decides whether and how to show a failure (the fallback loop shows only the last one).
  let errorInfo = null;
  const showError = (text) => { errorInfo = { ...(errorInfo ?? {}), message: text }; if (!quietError) $('error').textContent = text; };
  const controller = new AbortController();
  state.streaming = controller;
  setStreaming(true);

  let assembled = '';
  // The words since the last step: they are drawn in the reply box until a step comes,
  // then kept above that step as a note, so the chat reads as a running account.
  let segment = '';
  let meter = null;
  let aborted = false;
  let errorCode = null;
  let gotDone = false;
  // The reply is drawn as Markdown while it streams, a few times a second, so long
  // code arrives already folded instead of as a wall of text.
  let paintQueued = false;
  const paintLive = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      const opened = new Set([...bodyEl.querySelectorAll('pre.is-foldable')].map((pre, i) => (pre.classList.contains('is-folded') ? -1 : i)));
      bodyEl.replaceChildren(renderMarkdown(stripToolMarkup(segment), { foldCode: true }));
      bodyEl.classList.add('is-streaming');
      [...bodyEl.querySelectorAll('pre.is-foldable')].forEach((pre, i) => {
        if (opened.has(i)) setFolded(pre, false);
        else { const code = pre.querySelector('code'); if (code) code.scrollTop = code.scrollHeight; }
      });
      bodyEl.scrollIntoView({ block: 'end' });
    });
  };
  bodyEl.textContent = '';
  // The hopping bunny under the reply, with a word that matches what is happening.
  const working = createWorking(mood, { model: state.selected?.model ?? '', openThinking: ['thinking', 'verbose'].includes(state.settings?.transcriptView) });
  bodyEl.closest('.msg')?.after(working.el);
  // The thinking the line was showing settles into a quiet "Thought for 21s" row above the reply, where it can be opened any time.
  const settleThinking = () => {
    if (!working.isThinking()) return;
    const done = working.endThinking();
    const msg = bodyEl.closest('.msg');
    // a sibling above the reply, like the steps (msg.before): so thinking, then the step it led to, in the order they happened
    if (done.text && msg) msg.before(thoughtRow(done.text, done.ms));
  };

  const handlers = {
    signal: controller.signal,
    onDelta: (delta) => {
      settleThinking();
      assembled += delta;
      segment += delta;
      working.alive();
      paintLive();
      bodyEl.scrollIntoView({ block: 'end' });
    },
    onCompacted: (info) => {
      flashStatus('Compacted automatically');
      renderContext(info.after);
    },
    onWorking: (info) => flashStatus(`Still working · step ${info.step}`),
    onDone: (info) => { gotDone = true; meter = info?.context ?? null; },
    onError: (err) => { errorCode = err.code ?? 'chat.failed'; errorInfo = { scope: err.scope, reason: err.reason, unavailable: err.modelUnavailable, coolingUntil: err.coolingUntil, coolingScope: err.coolingScope, message: err.message }; showError(err.message ?? 'The request failed.'); },
    onTool: (info) => {
      settleThinking();
      flushNote();
      showLiveTool(bodyEl, info);
      if (info.status === 'failed' || info.status === 'denied') working.thump();
      else if (info.status === 'running') working.set(/(^| › )Asked: /.test(info.tool ?? '') ? 'asking' : 'tool', info.tool);
      else working.set('thinking');
      working.el.parentNode?.append(working.el);
    },
    onPermission: (info) => { settleThinking(); working.set('asking'); showLivePermission(bodyEl, info); },
    onBrowser: (info) => runBrowserAction(info),
    onCapability: (info) => { settleThinking(); working.set('asking'); showLiveCapability(bodyEl, info); },
    onNotice: (info) => showLiveNotice(bodyEl, info),
    onTasks: (info) => showLiveTasks(bodyEl, info.tasks ?? []),
    onThinking: (info) => { working.alive(); working.addThinking(info.text ?? ''); },
    onQuestion: (info) => { settleThinking(); flushNote(); working.set('asking'); showLiveQuestion(bodyEl, info); },
    onWaiting: (info) => notifyWaiting(info), // W6-25
    onNewChat: (info) => { state.pendingNewChat = info; },
  };
  function flushNote() {
    const note = stripToolMarkup(segment);
    segment = '';
    if (!note) return;
    const msg = bodyEl.closest('.msg');
    msg?.before(stepNote(note));
    bodyEl.textContent = '';
  }

  try {
    if (path === '/api/complete') await streamComplete(payload, handlers);
    else await streamMessage(state.sessionId, payload, handlers);
  } catch (err) {
    if (err.name === 'AbortError') {
      aborted = true;
    } else {
      errorCode = 'network';
      showError(err.message);
    }
  } finally {
    // The connection ended with neither an answer nor an error: say so, so it is not just silence
    // (and Auto can try the next model).
    if (!gotDone && !errorCode && !aborted && !controller.signal.aborted) {
      errorCode = 'chat.noReply';
      showError('The reply stopped without finishing. Send "continue" to pick up where it stopped.');
    }
    settleThinking(); // thinking that was still open when the reply ended is kept as its row
    working.stop();
    state.streaming = null;
    state.openQuestion = null;
    setStreaming(false);
    bodyEl.classList.remove('is-streaming');
  }

  return { assembled, meter, aborted, errorCode, errorInfo };
}

/** Tool calls some models write out as text: they are run, so the markup is not shown. */
function stripToolMarkup(text) {
  return String(text ?? '')
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .replace(/<function=[\w.-]+>[\s\S]*?(<\/function>|$)/g, '')
    .trim();
}

/** What Bunny said before a step ("Checking the build output."). */
function stepNote(text, inline = false) {
  const note = element('div', { className: inline ? 'step-note' : 'msg assistant step-note' });
  note.append(renderMarkdown(text, { foldCode: true }));
  return note;
}

/** A tool step, shown above the reply while it streams ("↳ Read src/app.js"). */
function showLiveTool(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  // A question shows as its own card (showLiveQuestion), not as a step line too.
  if (/(^| › )Asked: /.test(info.tool ?? '')) return;
  const lines = [...msg.parentNode.querySelectorAll('.live-tool')];
  let line = lines.find((l) => l.dataset.tool === info.tool && l.dataset.status === 'running');
  if (!line) {
    line = element('div', { className: 'msg assistant live-tool' });
    line.dataset.tool = info.tool;
    line.append(renderMessage({ kind: 'tool_call', role: 'assistant', tool: info.tool, status: info.status, content: '' }).firstChild);
    msg.before(line);
  }
  line.dataset.status = info.status;
  line.querySelector('.tag')?.replaceChildren(info.needsSignIn ? 'Needs sign-in' : info.status);
  if (info.needsSignIn && info.serverId && !line.querySelector('.signin-step')) {
    line.querySelector('.tag')?.classList.add('is-blocked');
    line.append(signInStep(info));
  }
  if (info.result) {
    let res = line.querySelector('.tool-call-result');
    if (!res) { res = element('div', { className: 'tool-call-result' }); line.querySelector('.tool-call')?.append(res); }
    res.textContent = `→ ${String(info.result).slice(0, resultLimit())}`;
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

/**
 * The model asks the person something: click a choice (or tick several), or type an
 * answer. The reply waits, then carries on with the answer.
 */
function showLiveQuestion(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  const card = element('form', { className: 'permission-prompt live-permission question-card', 'aria-label': 'Bunny has a question' });
  card.append(
    element('p', { className: 'capability-eyebrow', textContent: 'Bunny has a question' }),
    element('h4', { textContent: info.question }),
  );
  const picked = new Set();
  const choiceBox = element('div', { className: 'question-choices', role: info.multiple ? 'group' : 'radiogroup' });
  const text = element('textarea', { className: 'question-text', rows: 2, placeholder: info.placeholder || (info.choices?.length ? 'Or type your own answer…' : 'Type your answer…'), 'aria-label': 'Your answer' });
  const actions = element('div', { className: 'permission-actions' });
  const send = async (answer) => {
    state.openQuestion = null;
    $('send').disabled = Boolean(state.streaming);
    actions.replaceChildren(element('span', { className: 'hint', textContent: 'Sending…' }));
    for (const el of card.querySelectorAll('button, textarea, input')) el.disabled = true;
    try {
      await sendJSON(`/api/sessions/${state.sessionId}/question/${info.id}`, 'POST', answer);
      const said = answer.skipped ? 'Skipped' : [...(answer.choices ?? []), answer.text].filter(Boolean).join(', ');
      card.replaceChildren(element('p', { className: 'capability-eyebrow', textContent: 'Bunny asked' }),
        element('h4', { textContent: info.question }),
        element('p', { className: 'question-answer', textContent: answer.skipped ? 'You skipped this question.' : `You answered: ${said}` }));
    } catch (err) {
      actions.replaceChildren(element('span', { className: 'err', textContent: err.message }));
    }
  };
  for (const raw of info.choices ?? []) {
    const choice = typeof raw === 'string' ? { label: raw, reason: '', recommended: false } : raw;
    // A choice shows its label, why it fits, and whether Bunny recommends it.
    const parts = [
      element('span', { className: 'question-choice-label' }, choice.label,
        choice.recommended ? element('span', { className: 'tag question-recommended', textContent: 'Recommended' }) : null),
      choice.reason ? element('span', { className: 'question-choice-reason', textContent: choice.reason }) : null,
    ];
    if (info.multiple) {
      const box = element('input', { type: 'checkbox', 'aria-label': choice.label });
      box.addEventListener('change', () => (box.checked ? picked.add(choice.label) : picked.delete(choice.label)));
      choiceBox.append(element('label', { className: `question-choice is-check${choice.recommended ? ' is-recommended' : ''}` }, box, element('span', { className: 'question-choice-body' }, ...parts)));
    } else {
      // One click answers: the quickest way through.
      const b = button('', { className: `question-choice${choice.recommended ? ' is-recommended' : ''}`, 'aria-label': choice.label, onclick: () => send({ choices: [choice.label], text: text.value.trim() }) });
      b.append(element('span', { className: 'question-choice-body' }, ...parts));
      choiceBox.append(b);
    }
  }
  if (info.choices?.length) card.append(choiceBox);
  card.append(text);
  actions.append(
    button('Send', { type: 'submit', className: 'primary' }),
    button('Skip', { className: 'ghost', onclick: () => send({ skipped: true }) }),
  );
  card.append(actions);
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    const answer = { choices: [...picked], text: text.value.trim() };
    if (!answer.choices.length && !answer.text) { text.focus(); return; }
    send(answer);
  });
  // Enter sends the typed answer; Shift+Enter makes a new line.
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); card.requestSubmit(); } });
  // W4-12: the message box answers it too: "stop here" typed there is the choice with that name, anything else is the answer in words
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  state.openQuestion = {
    card,
    answer: (typed) => {
      const hit = (info.choices ?? []).map((c) => (typeof c === 'string' ? c : c.label)).find((l) => norm(l) === norm(typed));
      send(hit ? { choices: [hit] } : { text: typed });
    },
  };
  $('send').disabled = false;
  msg.before(card);
  card.scrollIntoView({ block: 'end' });
  (info.choices?.length && !info.multiple ? card.querySelector('.question-choice') : text)?.focus();
}

/** A question asked earlier in the chat, with its choices and the answer given. */
function answeredQuestionCard(q) {
  const card = element('div', { className: 'permission-prompt question-card is-answered' });
  card.append(
    element('p', { className: 'capability-eyebrow', textContent: 'Bunny asked' }),
    element('h4', { textContent: q.question }),
  );
  if (q.choices?.length) {
    const list = element('div', { className: 'question-choices' });
    for (const c of q.choices) {
      const chosen = q.answer && q.answer.split(/, | \| /).includes(c.label);
      list.append(element('span', { className: `question-choice is-static${chosen ? ' is-chosen' : ''}`, title: c.reason || '' },
        element('span', { className: 'question-choice-label' }, c.label, c.recommended ? element('span', { className: 'tag question-recommended', textContent: 'Recommended' }) : null)));
    }
    card.append(list);
  }
  card.append(element('p', { className: 'question-answer', textContent: q.answer === 'Skipped' ? 'You skipped this question.' : q.answer ? `You answered: ${q.answer}` : 'Not answered' }));
  // W4-12: the choices above are only a record. Say so, and why nothing could be clicked, instead of leaving them looking like dead buttons.
  if (!q.answer) {
    card.classList.add('is-unanswered');
    card.append(element('p', { className: 'question-answer-note', textContent: 'Bunny stopped waiting (the window was closed or reloaded, or nobody answered in time), so this card can no longer be answered. Tell Bunny what you want in the message box.' }));
  }
  return card;
}

/** The model's thinking: folded under "Thinking…", open it to read along. */
/** How much of a step's result shows: all of it in the Verbose transcript view. */
const resultLimit = () => (state.settings?.transcriptView === 'verbose' ? 100_000 : 500);

/** The "Thought for" row as its own line in the thread, so it can sit among the steps. */
function thoughtRow(text, ms) {
  return element('div', { className: 'msg assistant thinking-row' }, thinkingBlock(text, { ms }));
}

/** A finished stretch of thinking as a quiet row: "Thought for 21s" (just "Thought" when the time was not kept, as in old chats). */
function thinkingBlock(text, { ms = 0 } = {}) {
  const box = element('details', { className: 'thinking' });
  if (['thinking', 'verbose'].includes(state.settings?.transcriptView)) box.open = true;
  box.append(
    element('summary', { textContent: Number(ms) >= 1000 ? `Thought for ${fmtDuration(Number(ms))}` : 'Thought' }),
    element('div', { className: 'thinking-text', textContent: text }),
  );
  return box;
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

/**
 * A stop is a report, not silence: how many steps ran, what was done, and a way on.
 * Shown only when steps ran before the stop (a stopped plain answer needs no report).
 */
function stoppedReport(m) {
  const at = state.messages.indexOf(m);
  const steps = [];
  for (let i = at - 1; i >= 0 && state.messages[i].role !== 'user'; i -= 1) {
    if (state.messages[i].kind === 'tool_call' && !state.messages[i].question) steps.unshift(state.messages[i]);
  }
  if (!steps.length) return null;
  const count = steps.length < 10 ? NUMBER_WORDS[steps.length] : String(steps.length);
  const box = element('div', { className: 'stopped-report', role: 'status' });
  box.append(
    element('h4', { textContent: 'Stopped' }),
    element('p', { textContent: `You stopped Bunny after ${count} ${steps.length === 1 ? 'step' : 'steps'}.` }),
    element('p', { className: 'stopped-done-label', textContent: 'Done:' }),
  );
  const done = element('ul', { className: 'stopped-done' });
  for (const part of summariseSteps(steps).split(', ')) done.append(element('li', { textContent: part.charAt(0).toUpperCase() + part.slice(1) }));
  box.append(done);
  const actions = element('div', { className: 'stopped-actions' });
  actions.append(button('Continue', {
    className: 'primary small',
    onclick: () => { $('input').value = 'continue'; send(); },
  }));
  if (m.checkpoint?.files && !m.checkpoint.restored) {
    actions.append(button('Undo these changes', {
      className: 'ghost small',
      onclick: () => box.closest('.msg')?.querySelector('.undo-bar button')?.click(),
    }));
  }
  box.append(actions);
  return box;
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
/** W4-14e: a plain note in the chat from Bunny's server, with the folder picker when a folder is what is missing. */
function showLiveNotice(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  const card = element('div', { className: 'permission-prompt live-permission capability-card' });
  card.append(element('p', { className: 'capability-reason', textContent: String(info.text ?? '') }));
  if (info.folderPicker) {
    const actions = element('div', { className: 'permission-actions' });
    actions.append(button(say('cap.folder'), { className: 'primary', onclick: async () => { await chooseFolder(); applyWorkMode('code', { save: true }); } }));
    card.append(actions);
  }
  msg.before(card);
}

function showLiveCapability(bodyEl, info) {
  const msg = bodyEl.closest('.msg');
  if (!msg) return;
  const yesLabel = {
    code_mode: info.hasFolder ? say('cap.code') : say('cap.folder'),
    leave_plan_mode: say('cap.leavePlan'),
    computer_use: say('cap.computer'),
    custom_tools: say('cap.build'),
    new_tool: say('cap.newTool'),
    switch_on_added: 'Switch on',
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
      if (granted && info.capability === 'leave_plan_mode') { // the server moved this chat to Ask: show it
        if (state.session) state.session.permissionMode = 'ask';
        const picker = $('permission-mode');
        if (picker) picker.value = 'ask';
        syncModeMenu();
      }
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
    mood: 'retry',
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

/**
 * A one-line question in an in-app dialog. The desktop app (Electron) has no window.prompt, so nothing here uses it.
 * Resolves with the text, or null when the person cancels (Esc, Cancel, or a click outside).
 */
function askText({ title, value = '', label = title, action = 'OK' }) {
  return new Promise((resolve) => {
    const input = element('input', { className: 'input', type: 'text', value, 'aria-label': label, maxLength: 200 });
    const cancel = element('button', { className: 'btn btn-ghost', type: 'button', textContent: 'Cancel' });
    const ok = element('button', { className: 'btn btn-primary', type: 'button', textContent: action });
    const card = element('div', { className: 'palette modal ask-text', role: 'dialog', 'aria-label': title },
      element('div', { className: 'modal-head' }, element('h3', { className: 'modal-title', textContent: title })),
      element('div', { className: 'modal-body' }, input),
      element('div', { className: 'modal-foot actions' }, element('span', { className: 'spacer' }), cancel, ok));
    const backdrop = element('div', { className: 'palette-backdrop modal-backdrop', id: 'ask-text-backdrop' }, card);
    const done = (result) => { backdrop.remove(); resolve(result); };
    cancel.addEventListener('click', () => done(null));
    ok.addEventListener('click', () => done(input.value.trim() ? input.value : null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ok.click(); } else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    });
    document.body.append(backdrop);
    input.focus();
    input.select();
  });
}

async function refreshSession({ expectAssistant = false } = {}) {
  // A stopped reply is written by the server just after the browser gives up,
  // so poll briefly rather than read the transcript too early and lose it.
  // "A reply has arrived" means MORE assistant messages than the last transcript this page read, not "any":
  // in a chat that already has replies, any would stop the wait before the stopped reply is saved (Q2-19).
  const assistants = (list) => list.filter((m) => m.role === 'assistant' && m.kind !== 'tool_call').length; // a tool step is not the reply (Q2-31)
  const known = assistants(state.session?.messages ?? []);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const session = await getJSON(`/api/sessions/${state.sessionId}`);
    state.session = session;
    state.messages = session.messages;
    const hasReply = assistants(session.messages) > known;
    if (!expectAssistant || hasReply) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  paintMessages();
  renderContext(state.session.context);
  if (state.sidePaneOpen) state.workPanes?.refresh();
}

async function openSession(id) {
  state.workPanes?.reset();
  cancelQueued({ silent: true, keepDraft: true }); // a message waiting for the network belongs to the chat it was typed in
  state.sessionId = id;
  if (state.drafts?.has(id)) { $('input').value = state.drafts.get(id); state.drafts.delete(id); }
  state.incognito = false;
  renderMode();
  const session = await getJSON(`/api/sessions/${id}?seen=1`);
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
  cancelQueued({ silent: true, keepDraft: true });
  state.sessionId = null;
  if (state.drafts?.has('new')) { $('input').value = state.drafts.get('new'); state.drafts.delete('new'); }
  state.greeting = null; // a fresh chat gets a fresh greeting
  state.greetingSeed = 1 + Math.floor(Math.random() * 2147483645);
  state.session = null;
  state.pendingMode = null;
  state.pendingEffort = null;
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

/** A message from the quick-ask bar: a NEW chat in Chat mode with no folder, the text and the optional screenshot sent as the first message. */
async function runQuickAsk() {
  const request = await window.bunnyDesktop.quickAsk.take();
  if (!request || typeof request.text !== 'string') return;
  if (state.streaming) { // keep what was typed: it waits in the message box instead of being lost
    $('input').value = request.text;
    $('error').textContent = 'Bunny is busy, so your quick ask is waiting in the message box. Send it when the answer finishes.';
    return;
  }
  startNewChat();
  state.projectId = null;
  state.pendingFolder = null;
  applyWorkMode('chat');
  state.pendingFiles = Array.isArray(request.files) ? request.files.slice(0, 1) : [];
  renderPendingFiles();
  // A quick ask is always a message, never a slash command: a leading invisible word joiner stops "/..." from being run as one.
  $('input').value = request.text.startsWith('/') ? `⁠${request.text}` : request.text;
  await send();
}

function renderMode() {
  const host = $('mode');
  if (!host) return;
  host.hidden = !state.incognito;
}

// ---------------------------------------------------------------------------
// T-3: a dead network is its own calm state. The window decides it once, from two signals that must agree:
// the browser says it is offline AND a bare probe of a few neutral hosts (asked only now, after a failure or before
// a send while the browser says offline) cannot reach any. Then no model is tried: the message waits, and goes
// once when the network is back, unless the person cancelled it or typed something new.

/** Both signals agree the network is down. */
async function networkDown() {
  if (navigator.onLine !== false) return false;
  try {
    const answer = await getJSON('/api/network'); // reaches this computer's own server even with the internet down
    return answer?.online === false;
  } catch {
    return true; // this window cannot reach anything: that is offline too
  }
}

/** A model served from this computer (a loopback address) still works offline. */
function localModel() {
  const local = new Set(state.providers.filter((p) => p.status === 'connected' && /^https?:[/][/](localhost|127[.]0[.]0[.]1|[[]::1[]])/i.test(p.baseUrl ?? '')).map((p) => p.id));
  const m = state.models.find((x) => local.has(x.providerId));
  return m ? { providerId: m.providerId, id: m.id, displayName: m.displayName ?? m.id } : null;
}

function setOfflineChip(on) { const chip = $('offline-chip'); if (chip) chip.hidden = !on; }

function paintQueued(host) {
  const q = state.queued;
  if (!q) return;
  if (q.mode !== 'retry') {
    const bubble = element('div', { className: 'msg user is-waiting', id: 'queued-msg' });
    bubble.append(element('div', { className: 'body', textContent: q.text }));
    const row = element('div', { className: 'waiting-row' }, element('span', { textContent: say('offline.waiting') }),
      button(say('offline.cancel'), { className: 'ghost small', onclick: () => cancelQueued() }));
    bubble.append(row);
    host.append(bubble);
  }
  host.append(element('div', { className: 'offline-line', role: 'status', textContent: q.note ?? say('offline.line') }));
}

function queueTurn(entry) {
  state.queued = { ...entry, id: `q-${Date.now()}` };
  setOfflineChip(true);
  $('empty').hidden = true;
  paintMessages();
  watchNetwork();
}

function cancelQueued({ silent = false, keepDraft = false } = {}) {
  if (!state.queued) return;
  // Leaving the chat: the waiting text goes back to that chat's composer as a draft, never lost.
  if (keepDraft && state.queued.mode !== 'retry' && state.queued.text) (state.drafts ??= new Map()).set(state.sessionId ?? 'new', state.queued.text);
  state.queued = null;
  clearTimeout(state.networkTimer);
  setOfflineChip(false);
  paintMessages();
  if (!silent) flashStatus(say('offline.cancelled'), 6000);
}

/** Listen for the browser's `online` event and re-check every 10 seconds, easing to 30. */
function watchNetwork() {
  clearTimeout(state.networkTimer);
  let wait = 10_000;
  const tick = async () => {
    if (!state.queued) return;
    // The probe decides: it may succeed even when the browser's own flag is stuck on "offline".
    const probed = await getJSON('/api/network').then((r) => r.online !== false).catch(() => false);
    if (probed) { await resumeQueued(); return; }
    wait = Math.min(30_000, wait + 5_000);
    state.networkTimer = setTimeout(tick, wait);
  };
  state.networkTimer = setTimeout(tick, wait);
}

async function resumeQueued() {
  const q = state.queued;
  if (!q) return;
  clearTimeout(state.networkTimer);
  state.queued = null; // cleared BEFORE sending: one pending turn, sent once
  setOfflineChip(false);
  flashStatus(say('offline.back'), 6000);
  paintMessages();
  if (q.mode === 'retry') { await streamReply({ retry: true }); return; }
  $('input').value = q.text;
  state.pendingFiles = q.files ?? [];
  renderPendingFiles();
  await send();
}

window.addEventListener('online', async () => {
  if (!state.queued) return;
  flashStatus(say('offline.checking'), 10_000);
  // The browser says it is back; the probe confirms before the waiting message goes (a cut-off or captive network stays "offline").
  const online = await getJSON('/api/network').then((r) => r.online !== false).catch(() => true);
  if (online) resumeQueued();
});

async function send() {
  const input = $('input');
  const text = input.value.trim();
  $('error').textContent = '';
  // W4-12: while the reply waits on a question card, what is typed in the message box is the answer
  if (state.openQuestion && text && !text.startsWith('/')) { input.value = ''; state.openQuestion.answer(text); return; }
  if (!text && !state.pendingFiles.length) return;
  // Typing something new while a message waits for the network: the waiting one is cancelled, not sent later.
  if (state.queued) cancelQueued(); // the waiting message is cancelled, not sent later (and the person is told)

  if (text.startsWith('/')) {
    const handled = await runCommand(text);
    if (handled) { input.value = ''; return; }
  }

  if (!state.selected && !(state.modelAuto && state.autoPick)) { $('error').textContent = 'Choose a model first.'; return; }

  input.value = '';
  state.lastSent = text;
  if ($('prompt-suggestions')) $('prompt-suggestions').hidden = true;
  const files = state.pendingFiles;
  state.pendingFiles = [];
  renderPendingFiles();

  // Offline (both signals agree): no model is tried. A model on this computer still answers; otherwise the message waits.
  let offlineLocal = null;
  if (navigator.onLine === false && await networkDown()) {
    offlineLocal = localModel();
    // A local server that is not running (Ollama closed) is no help: the message waits instead of failing in red (Q2-30).
    if (offlineLocal) {
      const owner = state.providers.find((p) => p.id === offlineLocal.providerId);
      if (!(await reachable(owner?.baseUrl ?? ''))) offlineLocal = null;
    }
    if (!offlineLocal) { queueTurn({ text, files }); return; }
    flashStatus(say('offline.local', { m: offlineLocal.displayName }), 8000);
    setOfflineChip(true);
  } else setOfflineChip(false);

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
    state.pendingMode = null;
    state.pendingEffort = null;
  }

  state.messages.push({ id: `pending-u-${Date.now()}`, role: 'user', content: text, local: true, attachments: files });
  state.messages.push({ id: `pending-a-${Date.now()}`, role: 'assistant', content: '', local: true });
  paintMessages();
  const bodyEl = $('messages').lastElementChild?.querySelector('.body');

  const job = jobFor(text, files);
  const skillCall = calledSkill(text); // S-4
  state.lastJob = job;
  // W6-19: a picture job on a model chosen by hand that cannot see is said out loud, once, before it starts
  const eyes = noEyesWarning({ job, modelAuto: Boolean(state.modelAuto), modelName: state.selected?.model, canSee: state.selected ? canSee(state.selected.providerId, state.selected.model) : true });
  if (eyes) state.tryingNote = eyes; // the status line while the reply starts (cleared when it ends)
  const fixed = state.selected ? [{ providerId: state.selected.providerId, providerName: state.selected.providerName, id: state.selected.model, displayName: state.selected.model }] : [];
  const candidates = offlineLocal ? [offlineLocal] : (state.modelAuto ? preferLastAnswered(rankModels(state.models, job), lastAnswered()).slice(0, 4) : fixed);
  if (!candidates.length) candidates.push(...fixed);
  // A model you picked yourself is used first. Only when it is busy (rate limit, overloaded,
  // not answering) does the reply go to the best other model for the job, and you are told.
  const fallbackOn = !state.modelAuto && !offlineLocal && state.settings?.fallbackWhenBusy !== false;
  // W4-13 slice 3: the same model on its other providers (the person's order) comes before any other model
  let sameModel = [];
  if (fallbackOn && state.selected) {
    const group = state.models.filter((m) => m.id === state.selected.model);
    sameModel = group.length ? providerRowsInOrder(group).filter((m) => m.providerId !== state.selected.providerId && !m.unavailable) : [];
    candidates.push(...sameModel);
  }
  if (fallbackOn) {
    candidates.push(...rankModels(state.models, job).filter((m) => m.id !== state.selected?.model).slice(0, 2));
  }
  // Errors that are not the model's fault: another model would not help.
  const notTheModel = new Set(['speech.failed', 'model.notSelected', 'provider.notConnected', 'request.invalidJson']);
  let result = { meter: null, aborted: false };
  // T-3: models are tried one at a time, at most MAX_ATTEMPTS, and a provider that just failed as a whole
  // (unreachable, bad key) is skipped for the rest of this send. Only the last failure is shown, once.
  const MAX_ATTEMPTS = Math.min(6, 3 + sameModel.length);
  const queue = [...candidates];
  const failures = []; // { name, providerId, reason }
  const badProviders = new Set();
  let attempt = 0;
  let pick = null;
  while (queue.length && attempt < MAX_ATTEMPTS) {
    pick = queue.shift();
    if (badProviders.has(pick.providerId) && queue.some((q) => !badProviders.has(q.providerId))) continue;
    const i = attempt;
    attempt += 1;
    const stillToTry = () => queue.filter((q) => !badProviders.has(q.providerId)).length;
    const f0 = failures[0];
    // the same model on the next provider ('provider'), or another model once no provider had it left ('model')
    const switchKind = !f0 || !state.selected || f0.modelId !== state.selected.model ? undefined
      : (pick.id === f0.modelId ? 'provider' : (sameModel.length ? 'model' : undefined));
    const failed = switchKind === 'provider' ? f0.providerName : (f0?.name ?? null);
    $('error').textContent = '';
    result = await streamInto(bodyEl, {
      quietError: true,
      path: `/api/sessions/${state.sessionId}/messages`,
      payload: {
        content: text,
        ...(skillCall ? { useSkill: skillCall.name } : {}),
        retry: i > 0, // the user turn is already saved after the first try
        providerId: pick.providerId,
        model: pick.id,
        ...(chosenThinking(pick.providerId, pick.id) ? { thinking: chosenThinking(pick.providerId, pick.id) } : {}),
        attachments: i > 0 ? [] : files.map((f) => ({ name: f.name, mime: f.mime, data: f.data })),
        workMode: state.workMode ?? 'chat',
        browserControl: Boolean(window.bunnyDesktop?.browserAct),
        vision: canSee(pick.providerId, pick.id),
        job,
        auto: Boolean(state.modelAuto),
        fellBackFrom: failed ?? undefined,
        fellBackReason: failures[0]?.reason,
        fellBackTries: failures.length || undefined,
        fellBackKind: switchKind,
        fellBackProvider: switchKind ? f0.providerName : undefined,
        attemptsLeft: Math.min(MAX_ATTEMPTS - attempt, stillToTry()),
      },
      mood: failed ? 'fallback' : 'waiting',
    });
    // Any failure of the model itself (busy, refused, empty, cut off mid-work, unreachable)
    // goes to the next model. What was already done is saved, so the next one carries on from there.
    const errored = Boolean(result.errorCode) && !notTheModel.has(result.errorCode) && result.errorInfo?.scope !== 'other';
    if (!errored || result.aborted) break;
    // W6-5: what the server just learned is applied here at once, so Auto does not offer a dead model or a cooling provider again.
    if (result.errorInfo?.unavailable) { const dead = state.models.find((m) => m.providerId === pick.providerId && m.id === pick.id); if (dead) dead.unavailable = result.errorInfo.message ?? 'not available for this account'; }
    if (result.errorInfo?.coolingUntil) for (const m of state.models) if (m.providerId === pick.providerId && (result.errorInfo.coolingScope === 'provider' || m.id === pick.id)) m.coolingUntil = result.errorInfo.coolingUntil;
    const reason = result.errorInfo?.reason ?? (result.errorCode === 'network' ? 'unreachable' : 'other');
    failures.push({ name: pick.displayName ?? pick.id, providerId: pick.providerId, providerName: pick.providerName ?? pick.providerId, modelId: pick.id, reason });
    if (result.errorInfo?.scope === 'provider') badProviders.add(pick.providerId);
    const next = queue.find((q) => !badProviders.has(q.providerId));
    if (!next || attempt >= MAX_ATTEMPTS) break;
    // A calm line while the next model starts: what happened, and who is trying now.
    const live = say(`model.live.${reason}`) !== `model.live.${reason}` ? say(`model.live.${reason}`) : reasonPhrase(reason);
    const sameAgain = next.id === pick.id;
    state.tryingNote = say('model.trying', sameAgain
      ? { from: failures.at(-1).providerName, state: live, to: `${next.displayName ?? next.id} on ${next.providerName ?? next.providerId}` }
      : { from: failures.at(-1).name, state: live, to: next.displayName ?? next.id });
    flashStatus(state.tryingNote, 30000);
  }
  const { meter, aborted } = result;
  if (!result.errorCode && !aborted && pick && state.modelAuto) rememberAnswered(pick); // W3-8: Auto starts from here next time
  // The reply failed because the network is down (both signals agree): not a model fault. Say so calmly,
  // keep the turn, and send it once when the network is back. No red line.
  if (!aborted && result.errorCode && navigator.onLine === false && await networkDown()) {
    await refreshSession().catch(() => {});
    $('error').textContent = '';
    queueTurn({ mode: 'retry' });
    return;
  }
  const finalFailure = Boolean(result.errorCode) && !aborted && failures.length > 0 && failures.length === attempt
    ? (failures.length > 1
      ? say('model.nothingAnswered', { detail: failures.map((f) => `${f.name} ${reasonPhrase(f.reason)}`).join('; ') })
      : (result.errorInfo?.message ?? 'The request failed.'))
    : (result.errorCode && !aborted ? (result.errorInfo?.message ?? 'The request failed.') : '');

  if (meter) renderContext(meter);
  await refreshSession({ expectAssistant: aborted });
  // One line, not two: the server kept a note of the last failure, so the live line is shown only if it did not.
  $('error').textContent = finalFailure && state.messages.at(-1)?.kind !== 'error' ? finalFailure : '';
  $('status').textContent = '';
  await loadSessions();
  notifyReply();
  const moved = state.pendingNewChat;
  state.pendingNewChat = null;
  if (moved?.message) { await openNewChatWith(moved); return; }
  suggestNextPrompts().catch(() => {});
}

/** Settings → Code → unrelated tasks: the request starts in a chat of its own, in the same project. */
async function openNewChatWith({ title, message }) {
  startNewChat({ incognito: false });
  renderSidebar();
  flashStatus(`Started a new chat: ${title}`, 5000);
  $('input').value = message;
  await send();
}

/** Settings → Code → Prompt suggestions: a few next messages that fit the chat, one click to use. */
async function suggestNextPrompts() {
  const box = $('prompt-suggestions');
  if (!box) return;
  box.hidden = true;
  box.replaceChildren();
  if (state.settings?.promptSuggestions !== true || !state.sessionId) return;
  const pick = retryPick();
  const sessionAtStart = state.sessionId;
  const { suggestions = [] } = await sendJSON(`/api/sessions/${state.sessionId}/suggest`, 'POST', { providerId: pick.providerId, model: pick.model });
  if (state.sessionId !== sessionAtStart || state.streaming || $('input').value.trim()) return;
  for (const text of suggestions.slice(0, 3)) {
    const chip = button(text, { className: 'prompt-suggestion' });
    chip.addEventListener('click', () => { $('input').value = text; box.hidden = true; $('input').focus(); });
    box.append(chip);
  }
  box.hidden = !suggestions.length;
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

/** W6-25: a question or a permission prompt has waited a while: say so in the status line, and as a notification when the window is hidden. */
function notifyWaiting(info) {
  const what = info?.kind === 'permission' ? 'a permission' : info?.kind === 'capability' ? 'a choice' : 'an answer';
  const text = `Bunny is still waiting for ${what}${info?.title ? `: ${String(info.title).slice(0, 100)}` : ''}`;
  flashStatus(text, 30000);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const note = new Notification(say('app.name'), { body: text, tag: `waiting-${state.sessionId ?? 'bunny'}` });
    note.onclick = () => { window.focus(); note.close(); };
  } catch { /* a browser that will not show notifications is not an error */ }
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

// S-4: the skills that are on, as /name entries after the commands (cached for a minute)
let skillMenu = { at: 0, list: [] };
const skillSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** W6-16: does a skill or connector with these folders apply to the chat's folder? (The server decides for real; this only keeps the menus honest.) */
function appliesHere(folders) {
  if (!Array.isArray(folders) || !folders.length) return true;
  const here = (state.sessionId ? state.session?.folder : null) ?? state.pendingFolder?.folder ?? '';
  if (!here) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const h = norm(here);
  return folders.some((f) => { const n = norm(f); return h === n || h.startsWith(`${n}/`); });
}
async function loadSkillMenu() {
  if (Date.now() - skillMenu.at < 60_000) return false;
  skillMenu.at = Date.now();
  try {
    const all = await (await fetch('/api/skills')).json();
    skillMenu.list = (Array.isArray(all) ? all : []).filter((s) => s.enabled !== false && appliesHere(s.folders)).map((s) => ({ name: s.name, slug: skillSlug(s.name), hint: s.description || 'A skill' })).filter((s) => s.slug);
  } catch { skillMenu.list = []; }
  return true;
}
/** The skill a message calls ("/my-skill do this"), or null. Commands come first. */
function calledSkill(text) {
  const m = /^\/([a-z0-9-]+)(\s|$)/.exec(String(text));
  if (!m || COMMANDS.some((c) => c.name === `/${m[1]}`)) return null;
  return skillMenu.list.find((s) => s.slug === m[1]) ?? null;
}

function renderSlashMenu() {
  const host = $('slash');
  const value = $('input').value;
  if (!value.startsWith('/') || /\s/.test(value)) { host.hidden = true; return; } // once there is a space the person is typing the request, not choosing
  loadSkillMenu().then((fresh) => { if (fresh && $('input').value === value) renderSlashMenu(); }); // the list arrived after the menu was drawn
  const word = value.split(' ')[0];
  const matches = [...COMMANDS, ...skillMenu.list.map((s) => ({ name: `/${s.slug}`, hint: s.hint, skill: true }))].filter((c) => c.name.startsWith(word));
  host.replaceChildren();
  if (!matches.length) { host.hidden = true; return; }
  for (const c of matches) {
    const item = button('', { className: 'slash-item', role: 'option' });
    item.append(element('span', { className: 'slash-name', textContent: c.name }),
      element('span', { className: 'slash-hint', textContent: c.skill ? c.hint : say(c.hint) }));
    item.addEventListener('click', () => {
      $('input').value = c.skill ? `${c.name} ` : c.name;
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
  // A plain download link cannot carry the page's token, so fetch the file and save it from memory.
  const res = await fetch(`/api/sessions/${state.sessionId}/export?format=markdown`);
  if (!res.ok) { $('error').textContent = 'Could not export this chat.'; return; }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${state.sessionId}.md`;
  const href = URL.createObjectURL(await res.blob());
  const link = element('a', { href, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
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
      // SB-2: printed from a sandboxed frame of its own (no same-origin), so a page's scripts and event handlers never run as Bunny.
      const frame = element('iframe', { title: summary?.name ?? artifact.title });
      frame.setAttribute('sandbox', PRINT_SANDBOX);
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      frame.srcdoc = printDocument(shown, summary?.name ?? artifact.title);
      document.body.append(frame);
      setTimeout(() => frame.remove(), 120000);
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
  state.autoPick = preferLastAnswered(rankModels(state.models ?? [], job), lastAnswered())[0] ?? null;
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

/** How many models the "Show models" setting is hiding right now. */
function hiddenModelCount() {
  if (state.settings?.modelFilter === 'all') return 0;
  return Math.max(0, (state.allModelCount ?? 0) - (state.models?.length ?? 0));
}

/** Settings, Models, "Show models": everything a connected provider offers. */
async function showAllModels() {
  await sendJSON('/api/settings', 'PUT', { modelFilter: 'all' });
  state.settings = { ...state.settings, modelFilter: 'all' };
  state.models = visibleModels(await getJSON('/api/models'));
  if ($('greeting')) $('greeting').hidden = false;
  if (!state.selected && state.models.length) {
    const first = state.models[0];
    state.selected = { providerId: first.providerId, providerName: first.providerName, model: first.id };
    const empty = $('empty-text');
    if (empty) { empty.replaceChildren(); empty.setAttribute('data-i18n', 'chat.startText'); applyLanguage(state.language); }
  }
  renderPicker();
  renderComposerHeader();
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
  if (!avatar) return;
  avatar.textContent = (name.match(/\p{L}|\p{N}/u)?.[0] ?? 'B').toUpperCase();
  avatar.classList.toggle('has-photo', Boolean(settings?.profilePhoto));
  if (settings?.profilePhoto) {
    const img = element('img', { alt: '', src: `/api/profile/photo?v=${settings.profilePhoto.at}` });
    img.addEventListener('error', () => { img.remove(); avatar.classList.remove('has-photo'); });
    avatar.replaceChildren(img);
  }
}

// Settings (in its frame) says when the name or photo changed, so the sidebar updates at once.
window.addEventListener('message', async (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'bunny:open-section' && typeof e.data.section === 'string') { showSettingsSection(e.data.section); return; }
  if (!['bunny:profile', 'bunny:appearance', 'bunny:settings'].includes(e.data?.type)) return;
  try {
    const settings = await getJSON('/api/settings');
    state.settings = settings;
    applyProfile(settings);
    applyAppearance(settings);
  } catch { /* the next open of the window updates it */ }
});

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
    if (on) { b.setAttribute('aria-current', 'page'); b.scrollIntoView?.({ inline: 'center', block: 'nearest' }); } else b.removeAttribute('aria-current');
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
    applyAppearance(settings);
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
  { name: 'Settings', hint: 'Open settings', run: () => openSettings('profile') },
  { name: 'Providers', hint: 'Open the providers screen', run: () => openSettings('providers') },
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

/** Keyboard use of the palette: Arrow keys move the highlight, Enter runs it (Q2-14). */
function paletteKey(e) {
  const items = [...$('palette-list').querySelectorAll('.palette-item')];
  if (!items.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
  e.preventDefault();
  let at = items.findIndex((i) => i.classList.contains('is-active'));
  if (e.key === 'Enter') { items[Math.max(at, 0)].click(); return; }
  at = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
  items.forEach((i, n) => { i.classList.toggle('is-active', n === at); i.setAttribute('aria-selected', String(n === at)); });
  items[at].scrollIntoView?.({ block: 'nearest' });
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
  host.querySelector('.palette-item')?.classList.add('is-active');
}

// ---------------------------------------------------------------------------
// import

let importFile = null;

function openImport() {
  importFile = null;
  $('import-backdrop').hidden = false;
  $('import-error').textContent = '';
  $('import-text').disabled = false;
  $('import-text').placeholder = 'Paste JSON or Markdown here…';
  $('import-text').value = '';
  $('import-text').focus();
}

function closeImport() {
  $('import-backdrop').hidden = true;
}

async function runImport() {
  const content = importFile?.text ?? $('import-text').value;
  $('import-error').textContent = '';
  const run = $('import-run');
  const label = run.textContent;
  run.disabled = true;
  run.textContent = 'Importing…';
  try {
    const result = await sendJSON('/api/import', 'POST', { content, title: importFile?.name.replace(/\.(json|jsonl|md|txt)$/i, '') });
    closeImport();
    await loadSessions();
    location.href = `./index.html?s=${result.session.id}`;
  } catch (err) {
    $('import-error').textContent = err.message ?? 'That file could not be imported.';
  } finally {
    run.disabled = false;
    run.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// boot

async function boot() {
  $('new-chat').addEventListener('click', () => startNewChat({ incognito: state.incognito }));
  $('send').addEventListener('click', send);
  $('stop').addEventListener('click', () => { state.streaming?.abort(); cancelQueued(); });

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
  // The status text (Checking…, Back online. Sending…, X is slow. Trying Y…) also shows above the composer at phone width.
  const statusEl = $('status');
  if (statusEl && $('status-line')) {
    const mirror = () => { $('status-line').textContent = statusEl.textContent; };
    new MutationObserver(mirror).observe(statusEl, { childList: true, characterData: true, subtree: true });
    mirror();
  }
  state.workPanes = initWorkPanes({
    getSessionId: () => state.sessionId,
    getPendingFolder: () => state.pendingFolder?.folder ?? null,
    onChanged: () => refreshSession(),
    copy: async (text) => { flashStatus((await copyText(text)) ? 'Path copied' : 'Could not copy'); },
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

  // Zoom: Ctrl++ / Ctrl+= in, Ctrl+- out, Ctrl+0 actual size, and the row in the account menu.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepZoom(-1); }
    else if (e.key === '0') { e.preventDefault(); setZoom(1); }
  });
  $('zoom-in')?.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(1); });
  $('zoom-out')?.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(-1); });
  $('zoom-reset')?.addEventListener('click', (e) => { e.stopPropagation(); setZoom(1); });

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
  $('palette-input').addEventListener('keydown', paletteKey);
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
    // A big file is kept aside, not poured into the text box (which freezes on megabytes of text).
    const text = await file.text();
    e.target.value = '';
    if (text.length > 200_000) {
      importFile = { name: file.name, text };
      $('import-text').value = '';
      $('import-text').placeholder = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) is ready. Press Import.`;
      $('import-text').disabled = true;
    } else {
      importFile = null;
      $('import-text').value = text;
    }
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
      state.projectEdit = null;
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
  $('terminal-new')?.addEventListener('click', () => terminalStart({ fresh: true }));

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
    if (!state.sessionId) { state.pendingMode = e.target.value; return; } // no session yet: kept until the first message
    await sessionSetting(state.sessionId, 'permissionMode', e.target.value);
  });

  // ---- effort level ----
  $('effort-level')?.addEventListener('change', async (e) => {
    if (!state.sessionId) { state.pendingEffort = e.target.value; return; }
    await sessionSetting(state.sessionId, 'effort', e.target.value);
  });

  try {
    state.providers = await getJSON('/api/providers');
    const settings = await getJSON('/api/settings');
    state.settings = settings;
    setZoom(Number(settings.uiZoom) || 1, { save: false }); // the zoom you left it at
    state.models = visibleModels(await getJSON('/api/models'));
    loadArtifacts().catch(() => {});
    bindAutoPickers();
    applyProfile(settings);
    applyCapabilities(settings);
    applyAppearance(settings);
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
      // Nothing to pick yet: the one way forward is a button, not a line of small print.
      const empty = $('empty-text');
      empty.removeAttribute('data-i18n');
      const connected = state.providers.some((p) => p.status === 'connected');
      if (connected && hiddenModelCount()) {
        const n = hiddenModelCount();
        if ($('greeting')) $('greeting').hidden = true; // the hidden-models note replaces the "Pick a model…" greeting
        const show = element('button', { type: 'button', className: 'primary empty-cta', textContent: 'Show all models' });
        show.addEventListener('click', () => { showAllModels().catch((err) => { $('error').textContent = err.message; }); });
        empty.replaceChildren(element('span', { className: 'empty-note', textContent: `${n} ${n === 1 ? 'model is' : 'models are'} hidden by your "Show models" setting.` }), show);
      } else if (connected) {
        empty.replaceChildren(element('span', { className: 'empty-note', textContent: 'Your connected providers offer no models right now.' }), element('a', { className: 'primary empty-cta', href: './providers.html', textContent: 'Manage providers' }));
      } else {
        empty.replaceChildren(element('a', { className: 'primary empty-cta', href: './providers.html', textContent: say('chat.addProvider') }));
      }
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

  // W4-8 quick ask: the bar over any app asks this window to start a new chat with its message.
  if (window.bunnyDesktop?.quickAsk) {
    window.bunnyDesktop.quickAsk.onNewChat(() => { runQuickAsk().catch((err) => { $('error').textContent = err.message; }); });
    runQuickAsk().catch((err) => { $('error').textContent = err.message; });
  }

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
