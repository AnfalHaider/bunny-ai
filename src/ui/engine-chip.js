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
  const id = chosen?.id ?? (settings?.engine && settings.engine !== 'bunny' ? settings.engine : 'bunny');
  const e = byId(id);
  if (id === 'bunny' || !e?.downloaded) return { text: 'Bunny', fixed: false, id: 'bunny', restricted: false };
  return { text: `${e.label} · ${authLabel(chosen?.auth ?? e.auth)}`, fixed: false, id, restricted: false };
}

export function menuItems(list = engines ?? []) {
  return [{ id: 'bunny', text: 'Bunny', small: 'Default' }, ...list.filter((e) => e.downloaded).map((e) => ({ id: e.id, auth: e.auth, text: `${e.label} · ${authLabel(e.auth)}`, small: `v${e.version}` }))];
}

/** Paint the chip and its menu. `onPick({id, auth})` is called with what the person chose (only before the first message). */
export function paintEngineChip({ chip, menu, session, settings, chosen, onPick }) {
  if (!chip) return;
  const st = chipState({ session, settings, chosen });
  const list = engines ?? [];
  const any = list.some((e) => e.downloaded) || Boolean(session?.engine && session.engine.id !== 'bunny');
  chip.hidden = !any;
  chip.querySelector('.engine-text').textContent = st.text;
  chip.classList.toggle('on', st.id !== 'bunny');
  chip.classList.toggle('restricted', st.restricted);
  chip.title = st.fixed ? `This chat runs on ${st.text.split(' · ')[0]}. To use another engine, start a new chat.${st.restricted ? ' This run is restricted: it works in a copy and Bunny checks each change.' : ''}` : 'Engine for this chat';
  chip.setAttribute('aria-disabled', st.fixed ? 'true' : 'false');
  chip.onclick = (ev) => {
    ev.stopPropagation();
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
