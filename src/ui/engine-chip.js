// The engine chip in a Code chat's composer row (CLI-ENGINES, the owner's approved drawing): one short chip, "Claude Code · Account"; before the first message a one-line menu per engine;
// after it the chat's engine is fixed, and the chip's tooltip says so. Bunny is the default and shows as "Bunny". Only engines that are downloaded are listed.
import { getJSON } from './api.js';

let engines = null;

export async function loadEngines() {
  try { engines = (await getJSON('/api/engines')).engines; } catch { engines = []; }
  return engines;
}

const authLabel = (a) => (a === 'local' ? 'Local' : 'Account');

/** What the chip says for this chat: { text, fixed, id } . `chosen` is the engine picked before the first message (or null). */
export function chipState({ session, settings, chosen, list = engines ?? [] }) {
  const byId = (id) => list.find((e) => e.id === id);
  const fromSession = session?.engine;
  if (fromSession) {
    if (fromSession.id === 'bunny') return { text: 'Bunny', fixed: Boolean(session.messages?.length), id: 'bunny', restricted: false };
    const e = byId(fromSession.id);
    return { text: `${e?.label ?? fromSession.id} · ${authLabel(fromSession.auth)}`, fixed: Boolean(session.messages?.length), id: fromSession.id, restricted: Boolean(fromSession.restricted) };
  }
  // ENGINE-SWITCH: a chat that already has messages and no engine record has been running on Bunny's own engine: its engine is fixed too, and the chip offers the switch
  if (session?.messages?.length) return { text: 'Bunny', fixed: true, id: 'bunny', restricted: false };
  const id = chosen?.id ?? (settings?.engine && settings.engine !== 'bunny' ? settings.engine : 'bunny');
  const e = byId(id);
  if (id === 'bunny' || !e?.downloaded) return { text: 'Bunny', fixed: false, id: 'bunny', restricted: false };
  return { text: `${e.label} · ${authLabel(chosen?.auth ?? e.auth)}`, fixed: false, id, restricted: false };
}

export function menuItems(list = engines ?? []) {
  return [{ id: 'bunny', text: 'Bunny', small: 'Default' }, ...list.filter((e) => e.downloaded).map((e) => ({ id: e.id, auth: e.auth, text: `${e.label} · ${authLabel(e.auth)}`, small: `v${e.version}` }))];
}

/**
 * ENGINE-SWITCH (v0.1.15, Design's drawing v2): the rows of "Switch this chat to…". Bunny, Claude Code, Codex CLI. The one the chat runs on is marked `current`; an engine that is not ready is shown with the
 * reason and the button that fixes it (`download`, `signin`, `enable`); while a reply runs every other row waits. { id, label, sub, current, action: 'switch' | 'download' | 'signin' | 'enable' | null, reason }
 */
export function switchRows({ session, list = engines ?? [], busy = false } = {}) {
  const now = session?.engine?.id ?? 'bunny';
  const rows = [{ id: 'bunny', label: 'Bunny', sub: 'Built in', current: now === 'bunny', action: now === 'bunny' ? null : 'switch' }];
  for (const id of ['claude-code', 'codex']) {
    const e = list.find((x) => x.id === id);
    if (!e) continue;
    const row = { id, label: e.label ?? id, sub: '', current: now === id, action: 'switch' };
    if (id === 'claude-code') row.sub = e.auth === 'local' ? 'Local: runs on Bunny\'s endpoint and your models. Not supported by Anthropic.' : 'Your own Anthropic account';
    else row.sub = `${e.version ? `v${e.version} · ` : ''}${authLabel(e.auth)}`;
    if (row.current) row.action = null;
    else if (!e.downloaded) { row.action = 'download'; row.sub = 'Not downloaded'; }
    else if (e.enabled === false) { row.action = 'enable'; row.sub = 'Switched off in Settings'; }
    else if (id === 'claude-code' && e.auth !== 'local' && e.signedIn === false) { row.action = 'signin'; row.sub = 'Your own Anthropic account. Not signed in.'; }
    row.restricted = Array.isArray(session?.engine?.restrictedFor) && session.engine.restrictedFor.includes(id);
    rows.push(row);
  }
  if (busy) for (const row of rows) if (!row.current) { row.action = null; row.reason = 'Wait for the reply to finish, or press Stop first.'; }
  return rows;
}

/** Paint the chip and its menu. `onPick({id, auth})` is called with what the person chose (only before the first message). */
export function paintEngineChip({ chip, menu, session, settings, chosen, onPick, canSwitch = false, busy = false, onSwitch = null, onFix = null, deviceNote = '' }) {
  if (!chip) return;
  const st = chipState({ session, settings, chosen });
  const list = engines ?? [];
  const any = list.some((e) => e.downloaded) || Boolean(session?.engine && session.engine.id !== 'bunny');
  chip.hidden = !any;
  chip.querySelector('.engine-text').textContent = st.text;
  chip.classList.toggle('on', st.id !== 'bunny');
  chip.classList.toggle('restricted', st.restricted);
  const switchable = st.fixed && canSwitch && typeof onSwitch === 'function';
  chip.title = st.fixed ? (switchable ? `This chat runs on ${st.text.split(' · ')[0]}. Switch this chat to another engine.` : `This chat runs on ${st.text.split(' · ')[0]}.${deviceNote ? ` ${deviceNote}` : ' To use another engine, start a new chat.'}`) + (st.restricted ? ' This run is restricted: it works in a copy and Bunny checks each change.' : '') : 'Engine for this chat';
  chip.setAttribute('aria-disabled', st.fixed && !switchable ? 'true' : 'false');
  chip.setAttribute('aria-haspopup', 'menu');
  chip.onclick = (ev) => {
    ev.stopPropagation();
    if (switchable && menu) { openSwitchMenu({ menu, rows: switchRows({ session, list, busy }), onSwitch, onFix }); return; }
    if (st.fixed || !menu) return;
    menu.innerHTML = menuItems(list).map((m) => `<button type="button" role="menuitem" data-id="${m.id}" data-auth="${m.auth ?? ''}" class="${m.id === st.id ? 'on' : ''}"><span>${m.text}</span><small>${m.small}</small></button>`).join('');
    menu.hidden = !menu.hidden;
    menu.onclick = (e2) => {
      const b = e2.target.closest('button'); if (!b) return;
      menu.hidden = true;
      onPick?.({ id: b.dataset.id, ...(b.dataset.auth ? { auth: b.dataset.auth } : {}) });
    };
  };
}

/** The menu "Switch this chat to…": one row per engine, built with the DOM (no engine name is ever put in as HTML). */
function openSwitchMenu({ menu, rows, onSwitch, onFix }) {
  const wasOpen = !menu.hidden && menu.dataset.kind === 'switch';
  menu.dataset.kind = 'switch';
  menu.replaceChildren();
  const head = document.createElement('div'); head.className = 'es-head'; head.textContent = 'Switch this chat to…'; menu.append(head);
  for (const row of rows) {
    const line = document.createElement('div'); line.className = `es-row${row.action ? '' : ' is-idle'}`; line.dataset.id = row.id;
    const text = document.createElement('span'); text.className = 'es-text';
    const name = document.createElement('b'); name.textContent = row.label;
    const sub = document.createElement('small'); sub.textContent = row.reason ?? row.sub;
    text.append(name, sub);
    line.append(text);
    if (row.current) { const chip = document.createElement('span'); chip.className = 'es-now'; chip.textContent = 'now'; line.append(chip); }
    else if (row.action) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'es-act';
      b.textContent = row.action === 'switch' ? 'Switch' : row.action === 'download' ? 'Download' : row.action === 'signin' ? 'Sign in' : 'Open Engines';
      b.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = true; if (row.action === 'switch') onSwitch?.(row); else onFix?.(row, row.action); });
      line.append(b);
    }
    menu.append(line);
  }
  menu.hidden = wasOpen;
}
