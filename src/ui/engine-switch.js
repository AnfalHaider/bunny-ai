// ENGINE-SWITCH (v0.1.15, Design's drawing v2): the confirm card for "Switch this chat to <engine>?". It says what the new engine gets and which rules it follows, in the drawing's own words, and only
// promises what Bunny will send: "its instruction files" only when the folder is followed (ONE-INSTRUCTIONS), "(answers that used files from this PC are left out)" only when the chat has such answers.
// The card is a plain function of what the page knows (describeSwitch), so every variant can be tested without a browser.

const LABELS = { bunny: 'Bunny', 'claude-code': 'Claude Code', codex: 'Codex CLI' };
export const engineName = (id) => LABELS[id] ?? String(id ?? 'the engine');

/** Did any answer in this chat use files from this PC? (the handover leaves such answers out) */
export const chatHasPcAnswers = (session) => (session?.messages ?? []).some((m) => m && (m.pcSources || m.noAutoLoad || m.pcResults));

/**
 * @param {{ to: string, session: object, folder: string, view?: object|null, useBunnyEngine?: boolean, restrictedAgain?: boolean }} o
 * @returns {{ title: string, paragraphs: string[], foot: string[], button: string }}
 */
export function describeSwitch({ to, session, folder = '', view = null, useBunnyEngine = true, restrictedAgain = false }) {
  const name = engineName(to);
  const title = `Switch this chat to ${name}?`;
  const button = `Switch to ${name}`;
  const paragraphs = [];
  const foot = [];
  if (to === 'bunny') {
    paragraphs.push("Bunny's engine carries on from this chat's messages. It also gets the list of files this chat changed, so it knows what we've been doing. It follows Bunny's rules.");
    return { title, paragraphs, foot, button };
  }
  if (folder) paragraphs.push(`It carries on in ${folder}.`);
  if (restrictedAgain) paragraphs.push(`${name} runs restricted in this chat: Bunny's check failed for it earlier. It works in a copy of your folder, and you review the changes before they reach it.`);
  else if (useBunnyEngine === false && to === 'codex') paragraphs.push("Bunny's engine is off, so Codex follows its own rules: it asks you about every command and file change.");
  else if (useBunnyEngine === false) paragraphs.push("Bunny's engine is off, so Claude Code follows the rules you set for it in Settings → Engines: Allow runs with no question, Ask shows a card, Deny stops it.");
  else paragraphs.push(`${name} follows Bunny's rules.`);
  const followed = Boolean(view?.enabled && view?.chatSwitch !== false && view?.trusted && (view?.files ?? []).some((f) => f.state === 'in-use' || f.state === 'changed' || f.state === 'gone'));
  const hasFiles = (view?.files ?? []).length > 0 && view?.enabled && view?.chatSwitch !== false;
  const parts = [];
  parts.push("this chat's folder");
  if (followed) parts.push('its instruction files');
  parts.push(`a summary of the conversation${chatHasPcAnswers(session) ? ' (answers that used files from this PC are left out)' : ''}`);
  parts.push('the list of files this chat changed');
  paragraphs.push(`It gets ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`);
  if (hasFiles && !followed) paragraphs.push('Not followed yet: it will not get the folder\'s instruction files until you choose Follow them.');
  if (restrictedAgain) foot.push('If you switch away later, the other engine runs in full mode, and ' + name + ' stays restricted if you come back.');
  foot.push('Your files and Undo stay as they are.');
  return { title, paragraphs, foot, button };
}

const el = (tag, props = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'className') n.className = v; else if (k === 'textContent') n.textContent = v; else if (k === 'role' || k.startsWith('aria-')) n.setAttribute(k, String(v)); else n[k] = v; } n.append(...kids.filter((c) => c !== null && c !== undefined && c !== false)); return n; };

/** Show the card; resolves true on the confirm button, false on Cancel, Esc or a click outside. */
export function openSwitchCard(opts) {
  const d = describeSwitch(opts);
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'modal-backdrop' });
    const box = el('div', { className: 'modal engine-switch-card', role: 'dialog', 'aria-label': d.title });
    const done = (v) => { backdrop.remove(); resolve(v); };
    const ok = el('button', { type: 'button', className: 'btn btn-primary', textContent: d.button });
    const cancel = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel' });
    ok.addEventListener('click', () => done(true)); cancel.addEventListener('click', () => done(false));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(false); });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    box.append(
      el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: d.title })),
      el('div', { className: 'modal-body' }, ...d.paragraphs.map((p) => el('p', { className: 'es-p', textContent: p })), ...d.foot.map((f) => el('p', { className: 'modal-sub', textContent: f }))),
      el('div', { className: 'modal-foot' }, cancel, ok));
    backdrop.append(box);
    document.body.append(backdrop);
    ok.focus();
  });
}

/** "No folder to carry over": an engine needs a folder; Bunny's own engine is always allowed. Resolves 'folder', 'bunny' or null. */
export function openNoFolderCard() {
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'modal-backdrop' });
    const box = el('div', { className: 'modal engine-switch-card', role: 'dialog', 'aria-label': 'No folder to carry over' });
    const done = (v) => { backdrop.remove(); resolve(v); };
    const folder = el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Choose a folder' });
    const bunny = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Switch to Bunny' });
    const cancel = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Cancel' });
    folder.addEventListener('click', () => done('folder')); bunny.addEventListener('click', () => done('bunny')); cancel.addEventListener('click', () => done(null));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    box.append(el('div', { className: 'modal-head' }, el('h3', { className: 'modal-title', textContent: 'No folder to carry over' })),
      el('div', { className: 'modal-body' }, el('p', { className: 'es-p', textContent: 'An engine needs a folder. Choose a folder first, or switch to Bunny.' })),
      el('div', { className: 'modal-foot' }, cancel, bunny, folder));
    backdrop.append(box);
    document.body.append(backdrop);
    folder.focus();
  });
}

/** The divider line in the transcript: "Now on Codex CLI". */
export function switchDivider(message) {
  const line = el('div', { className: 'es-divider', role: 'separator' }, el('span', { textContent: `Now on ${engineName(message?.to)}` }));
  return line;
}
