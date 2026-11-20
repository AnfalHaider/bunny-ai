// Settings → Engines (CLI-ENGINES, the owner's approved drawing): one compact row per engine: tile, name and one dim line, the Local | Account switch, the one main button, and a ⋯ menu.
// Everything here goes through the engines routes; only Bunny's window can change anything (the server refuses every device).
import { getJSON, sendJSON, esc } from './api.js';
import { isDevicePage } from './browser-mode.js';

const mount = document.getElementById('engines-list');
const chooser = document.getElementById('engine-default');
const noteEl = document.getElementById('engines-note');
const recordEl = document.getElementById('engines-record');
const bunnyRules = document.getElementById('engine-bunny-rules');
const warningEl = document.getElementById('engines-warning');
const rulesBox = document.getElementById('engine-rules');
const rulesNote = document.getElementById('rules-engine-off');
let state = null; let timer = null; let openMenu = null; let unknownTries = 0;

const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const TILES = { 'claude-code': 'CC', codex: 'CX' };
const SIZE_HINT = { 'claude-code': '380 MB', codex: '390 MB' };
const deviceView = isDevicePage(); // another device never changes engines: the server refuses it, and the page does not offer the buttons

function dim(e) {
  if (e.error) return e.error;
  if (e.downloading) { const p = e.progress; return p?.total ? `Downloading ${mb(p.bytes)} of ${mb(p.total)}…` : 'Downloading…'; }
  if (!e.downloaded) return `Not installed · ${SIZE_HINT[e.id]}`;
  // the version and the sign-in only: the mode is the switch beside it
  const sign = e.id === 'claude-code' && e.auth === 'account' && typeof e.signedIn === 'boolean' ? (e.signedIn ? 'Signed in' : 'Not signed in') : null;
  return [`v${e.version}`, e.updateAvailable ? `v${e.available} is ready (tested)` : null, sign].filter(Boolean).join(' · ');
}

function authSwitch(e) {
  const local = e.auth === 'local';
  const acct = e.authModes.account;
  const dot = (side) => (e.recommendedAuth === side ? '<i class="rc" aria-hidden="true"></i>' : '');
  const tipLocal = e.id === 'claude-code' ? 'Not supported by Anthropic. Claude Code may stop working with your models after an update.' : 'Bunny\'s endpoint and your models.';
  const tipAcct = acct.available ? 'Sign in with your own account; Bunny never sees or stores the sign-in.' : acct.note;
  return `<span class="seg" role="radiogroup" aria-label="Account or Local for ${esc(e.label)}">`
    + `<button type="button" role="radio" data-auth="local" aria-checked="${local}" title="${esc(tipLocal)}" class="${local ? 'on' : ''}">Local${dot('local')}</button>`
    + `<button type="button" role="radio" data-auth="account" aria-checked="${!local}" title="${esc(tipAcct)}" ${acct.available ? '' : 'disabled aria-disabled="true"'} class="${!local ? 'on' : ''}">Account${dot('account')}</button></span>`;
}

function mainButton(e) {
  if (e.downloading) { const p = e.progress; const pct = p?.total ? Math.min(100, Math.round((p.bytes / p.total) * 100)) : 0; return `<span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span><button type="button" class="btn2" data-act="cancel">Cancel</button>`; }
  if (e.error) return '<button type="button" class="btn2 pri" data-act="download">Try again</button>';
  if (!e.downloaded) return `<button type="button" class="btn2 pri" data-act="download">Download<span class="sh2"> (${SIZE_HINT[e.id]})</span></button>`;
  if (e.updateAvailable) return `<button type="button" class="btn2 pri" data-act="update">Update to v${esc(e.available)} (tested)</button>`;
  if (e.id === 'claude-code' && e.auth === 'account' && e.signedIn === false) return '<button type="button" class="btn2 pri" data-act="signin">Sign in</button>';
  return '';
}

function menu(e) {
  if (!e.downloaded && !e.previous) return '<span class="mn none"></span>';
  const items = [];
  if (e.previous) items.push(`<button type="button" role="menuitem" data-act="rollback">Roll back to v${esc(e.previous)}<small>kept</small></button>`);
  if (e.id === 'claude-code' && e.downloaded && e.signedIn === true) items.push('<button type="button" role="menuitem" data-act="signout">Sign out<small>this account</small></button>');
  if (e.downloaded) items.push(`<button type="button" role="menuitem" data-act="remove">Remove<small>frees ${mb(e.sizeBytes)}</small></button>`);
  return `<span class="mnw"><button type="button" class="mn" aria-haspopup="menu" aria-label="More for ${esc(e.label)}" data-act="menu">···</button><div class="menu2" role="menu" hidden>${items.join('')}</div></span>`;
}

function row(e) {
  if (deviceView) return `<div class="er" data-id="${e.id}"><span class="ti">${TILES[e.id]}</span><div class="nm"><div class="l1"><b>${esc(e.label)}</b></div><div class="l2">${esc(dim(e))}</div></div></div>`;
  return `<div class="er" data-id="${e.id}"><span class="ti">${TILES[e.id]}</span><div class="nm"><div class="l1"><b>${esc(e.label)}</b></div><div class="l2" title="${esc(dim(e))}">${esc(dim(e))}</div></div>`
    + `<div class="act2"><div class="cc">${e.downloaded ? authSwitch(e) : ''}</div><div class="bt">${mainButton(e)}</div></div>${menu(e)}</div>`;
}

/** ER-6: the warning, word for word, with the engine's name. */
const engineNames = () => {
  const list = state.engines.filter((e) => e.downloaded && e.enabled !== false && e.ownRules);
  const chosen = state.engine !== 'bunny' ? list.find((e) => e.id === state.engine) : null;
  return (chosen ? [chosen] : list).map((e) => e.label);
};
const warningText = (names) => { const n = names.length ? names.join(' or ') : 'the engine'; return `Bunny's engine is off. Chats run on ${n} and follow ${n}'s rules, which you set here. Bunny no longer checks each step against your Bunny rules, including your Deny rules: ${n} asks you itself, and Bunny shows its questions. Bunny still blocks its own data, its keys and the engines' sign-ins. A command you allow can read any file on this PC that you can.`; };

// The locked rows under the three boxes: what Bunny always protects while its engine is off (the floor in src/server/engines/bridge.js). Read only, not rules the person can change.
const FLOOR_LIST = '<div class="floor" id="engine-floor"><div class="floor-h">Always protected, whatever the rules say</div><ul>'
  + `<li>Bunny's own data folder: your chats, memory, settings and keys.</li>`
  + `<li>Every engine's own folder, where its sign-in is kept.</li>`
  + '<li>Your private folders (keys, sign-ins, app data) when they lie outside the project.</li>'
  + `<li>Bunny's own tools: the model may not use them.</li>`
  + '</ul><div class="d">A command that names one of these folders is flagged on its card.</div></div>';

const rulesLines = (list) => (Array.isArray(list) ? list : []).join('\n');
function paintRules() {
  const off = state.useBunnyEngine === false;
  if (bunnyRules) { bunnyRules.checked = !off; const st = document.getElementById('engine-bunny-rules-state'); if (st) st.textContent = off ? 'off' : 'on'; bunnyRules.disabled = deviceView; }
  const names = engineNames();
  if (warningEl) { warningEl.hidden = !off; if (off) { const t = warningText(names); warningEl.innerHTML = `<b>${esc(t.slice(0, t.indexOf('.') + 1))}</b>${esc(t.slice(t.indexOf('.') + 1))}`; } }
  if (rulesNote) { rulesNote.hidden = !off; rulesNote.textContent = off ? `Not used while Bunny's engine is off. ${names.length ? names.join(' or ') : 'The engine'}'s rules apply.` : ''; }
  if (!rulesBox) return;
  rulesBox.hidden = !off || deviceView;
  if (rulesBox.hidden) return;
  const cc = state.engines.find((e) => e.id === 'claude-code');
  const cx = state.engines.find((e) => e.id === 'codex');
  const keepOpen = rulesBox.querySelector('details')?.open;
  let html = '';
  if (cc?.downloaded && cc.ownRules) {
    html += `<div class="row stack"><div class="meta-col"><div class="name">Claude Code's rules</div><div class="desc">In Claude Code's own form, one per line, for example <code>Bash(npm test:*)</code> or <code>Read(./docs/**)</code>. Allow runs with no question, Ask shows a card, Deny always stops. Bunny never loads rules from a folder or from your own Claude Code.</div></div>`
      + ['deny', 'ask', 'allow'].map((k) => `<label class="rl">${k[0].toUpperCase()}${k.slice(1)}<textarea data-kind="${k}" rows="3" maxlength="40000" spellcheck="false" aria-label="${k} rules">${esc(rulesLines(cc.rules?.[k]))}</textarea></label>`).join('')
      + FLOOR_LIST
      + `<div><button type="button" class="btn2 pri" id="engine-rules-save">Save rules</button> <span class="d" id="engine-rules-said" role="status"></span></div></div>`;
  } else if (cc?.downloaded) html += `<div class="row"><div class="desc">Claude Code stays on Bunny's rules: its permission question has not been checked for this version.</div></div>`;
  if (cx?.downloaded) html += `<div class="row"><div class="desc">Codex asks you about every command and file change, and you answer on a card. Its own rules are not offered yet.</div></div>`;
  if (!html) html = `<div class="row"><div class="desc">Download an engine to set its rules.</div></div>`;
  rulesBox.innerHTML = html;
  void keepOpen;
}

function render() {
  if (!state || !mount) return;
  const bunny = '<div class="er"><span class="ti">B</span><div class="nm"><div class="l1"><b>Bunny</b></div><div class="l2">Built in · Default · always there</div></div><div class="act2"><div class="cc"></div><div class="bt"></div></div><span class="mn none"></span></div>';
  const ws = document.getElementById('engines-window-only'); if (ws) ws.hidden = !deviceView;
  if (deviceView) { const d = document.getElementById('engine-default'); if (d) d.closest('.group').hidden = true; }
  mount.innerHTML = bunny + state.engines.map(row).join('');
  if (chooser) {
    const keep = chooser.value;
    chooser.innerHTML = '<option value="bunny">Bunny</option>' + state.engines.filter((e) => e.downloaded).map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('');
    chooser.value = [...chooser.options].some((o) => o.value === state.engine) ? state.engine : (keep || 'bunny');
  }
  paintRules();
  if (noteEl) {
    const cc = state.engines.find((e) => e.id === 'claude-code');
    noteEl.hidden = !(cc?.downloaded && cc.auth === 'local');
  }
  const busy = state.engines.some((e) => e.downloading);
  clearTimeout(timer);
  const unknownSign = state.engines.some((e) => e.id === 'claude-code' && e.downloaded && e.auth === 'account' && e.signedIn === null) && (unknownTries += 1) <= 5;
  if (!state.engines.some((e) => e.signedIn !== null)) { /* nothing to wait for */ }
  if (busy) timer = setTimeout(load, 600); else if (unknownSign) timer = setTimeout(load, 1500); else if (!state.engines.some((e) => e.id === 'claude-code' && e.signedIn === null)) unknownTries = 0;
}

let watching = 0;
/** After a sign-in starts: look again every 3 s for two minutes (the page also refreshes by itself). */
function watchSignIn() { const run = (watching += 1); let n = 0; const tick = async () => { if (run !== watching || n >= 40) return; n += 1; await load(); if (state?.engines.find((e) => e.id === 'claude-code')?.signedIn === true) return; setTimeout(tick, 3000); }; setTimeout(tick, 3000); }

const parseLines = (box) => box.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

async function load() {
  try { state = await getJSON('/api/engines'); render(); loadRecord(); } catch (err) { if (mount) mount.textContent = `Engines could not be loaded: ${err.message}`; }
}

const NAMES = { 'claude-code': 'Claude Code', codex: 'Codex CLI', bunny: 'Bunny\'s engine' };
function said(r) {
  const n = NAMES[r.engine] ?? r.engine;
  if (r.action === 'download') return `${n} downloaded${r.to ? ` v${r.to}` : ''}`;
  if (r.action === 'update') return `${n} updated${r.from ? ` from v${r.from}` : ''}${r.to ? ` to v${r.to}` : ''}`;
  if (r.action === 'rollback') return `${n} rolled back${r.to ? ` to v${r.to}` : ''}`;
  if (r.action === 'remove') return `${n} removed`;
  if (r.action === 'rules-off') return 'Bunny\'s engine turned off (from Bunny\'s window)';
  if (r.action === 'rules-on') return 'Bunny\'s engine turned on (from Bunny\'s window)';
  if (r.action === 'signin') return `${n} sign-in started`;
  if (r.action === 'signout') return `${n} signed out`;
  return `${n}: ${r.action}`;
}
async function loadRecord() {
  if (!recordEl) return;
  try {
    const { record } = await getJSON('/api/engines/record');
    recordEl.innerHTML = record.slice(0, 8).map((r) => `<div class="rec-row"><span class="when">${esc(new Date(r.at).toLocaleString())}</span><b>${esc(said(r))}</b>${r.sha12 ? `<code>${esc(r.sha12)}</code>` : ''}</div>`).join('') || '<div class="d">Nothing yet.</div>';
  } catch { recordEl.textContent = ''; }
}

/** Bunny's own question card (never the browser's confirm or alert). Resolves true on the action button. */
function ask({ title, body, action, danger = false, single = false }) {
  return new Promise((resolve) => {
    const mk = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
    const cancel = mk('button', 'btn btn-ghost', 'Cancel'); cancel.type = 'button';
    const ok = mk('button', `btn ${danger ? 'btn-danger' : 'btn-primary'}`, action); ok.type = 'button';
    const head = mk('div', 'modal-head'); head.append(mk('h3', 'modal-title', title));
    const bodyEl = mk('div', 'modal-body', body);
    const foot = mk('div', 'modal-foot actions'); foot.append(mk('span', 'spacer'));
    if (!single) foot.append(cancel);
    foot.append(ok);
    const card = mk('div', 'palette modal engine-confirm'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', title); card.append(head, bodyEl, foot);
    const backdrop = mk('div', 'palette-backdrop modal-backdrop'); backdrop.append(card);
    const done = (v) => { backdrop.remove(); resolve(v); };
    cancel.addEventListener('click', () => done(false)); ok.addEventListener('click', () => done(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(false); });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    document.body.append(backdrop); ok.focus();
  });
}
const tell = (message) => ask({ title: 'Engines', body: message, action: 'OK', single: true });

async function act(id, what) {
  try {
    if (what === 'download' || what === 'update') await sendJSON(`/api/engines/${id}/download`, 'POST', {});
    else if (what === 'signin') { await sendJSON(`/api/engines/${id}/signin`, 'POST', {}); await tell('A window opened with Claude Code\'s own sign-in. Finish it there and in your browser. Bunny never sees your sign-in. This page updates by itself.'); watchSignIn(); }
    else if (what === 'signout') { if (!(await ask({ title: 'Sign out of Claude Code?', body: 'Claude Code signs out of this account. Chats on it will ask you to sign in again.', action: 'Sign out', danger: true }))) return; await sendJSON(`/api/engines/${id}/signout`, 'POST', {}); }
    else if (what === 'cancel') await sendJSON(`/api/engines/${id}/cancel`, 'POST', {});
    else if (what === 'rollback') { if (!(await ask({ title: 'Roll back?', body: 'Go back to the earlier version? New chats use it.', action: 'Roll back' }))) return; await sendJSON(`/api/engines/${id}/rollback`, 'POST', {}); }
    else if (what === 'remove') { if (!(await ask({ title: 'Remove this engine?', body: 'Remove this engine and everything it saved? You can download it again.', action: 'Remove', danger: true }))) return; await sendJSON(`/api/engines/${id}`, 'DELETE', {}); }
  } catch (err) { tell(err.message); }
  await load();
}

mount?.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t || deviceView) return;
  const id = t.closest('.er')?.dataset.id;
  if (t.dataset.act === 'menu') { const m = t.parentElement.querySelector('.menu2'); const was = !m.hidden; if (openMenu) openMenu.hidden = true; m.hidden = was; openMenu = was ? null : m; return; }
  if (openMenu) { openMenu.hidden = true; openMenu = null; }
  if (t.dataset.act && id) { await act(id, t.dataset.act); return; }
  if (t.dataset.auth && id && !t.disabled) {
    try { await sendJSON('/api/settings', 'PUT', { engines: { [id]: { auth: t.dataset.auth } } }); } catch (err) { tell(err.message); }
    await load();
  }
});
document.addEventListener('click', (ev) => { if (openMenu && !ev.target.closest('.mnw')) { openMenu.hidden = true; openMenu = null; } });
bunnyRules?.addEventListener('change', async () => {
  if (deviceView || !state) return;
  const wantOff = !bunnyRules.checked;
  if (wantOff) {
    const t = warningText(engineNames());
    if (!(await ask({ title: 'Turn off Bunny\'s engine?', body: t, action: 'Turn it off', danger: true }))) { bunnyRules.checked = true; return; }
  }
  try { await sendJSON('/api/settings', 'PUT', { useBunnyEngine: !wantOff }); } catch (err) { bunnyRules.checked = wantOff; await tell(err.message); }
  await load();
});
rulesBox?.addEventListener('click', async (ev) => {
  const b = ev.target.closest('#engine-rules-save');
  if (!b || deviceView) return;
  const rules = {};
  for (const ta of rulesBox.querySelectorAll('textarea[data-kind]')) rules[ta.dataset.kind] = parseLines(ta);
  const said = document.getElementById('engine-rules-said');
  try { await sendJSON('/api/settings', 'PUT', { engines: { 'claude-code': { rules } } }); await load(); const again = document.getElementById('engine-rules-said'); if (again) again.textContent = 'Saved. New runs use these rules.'; } catch (err) { if (said) said.textContent = err.message; }
});
chooser?.addEventListener('change', async () => { try { await sendJSON('/api/settings', 'PUT', { engine: chooser.value }); } catch (err) { tell(err.message); } await load(); });

load();
