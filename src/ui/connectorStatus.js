/**
 * W3-6b: how a remote connector's state and its sign-in are shown, shared by Customize and Automation.
 * Plain ES module, no imports: the pages hand in their own `getJSON` / `sendJSON`.
 *
 *   connectorStatus(server, flow)  -> { word, detail, tone, wait, canSignIn, signInLabel }   (pure; tested without a browser)
 *   renderStatus(status, doc)      -> the nodes for a `.cz-status` cell: a coloured word and a dim line under it
 *   createSignInFlows({...})       -> the sign-in the person is in the middle of, per connector: start, cancel, sign out
 *
 * `server` is a row of GET /api/mcp with `oauth` (GET /api/connectors/:id/oauth) added; `flow` is what createSignInFlows keeps.
 * No token ever passes through here: the server only says whether, and as whom, the person is signed in.
 */

export const WAIT_MS = 5 * 60_000;
/** These two sentences are the server's own (src/server/connectorSignIn.js): the page matches on them to tell the cases apart. */
export const SIGN_IN_EXPIRED = 'Your sign-in expired. Sign in again.';
export const KEY_REFUSED = 'The service refused the key. Check it in Customize.';
export const NEEDS_CLIENT_ID = 'This service does not let apps register themselves. Paste the client ID from its developer settings.';

export function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

/** One status word in the status colour and one dim line with the reason or the account. */
export function connectorStatus(server, flow = null) {
  const host = hostOf(server.url);
  const signedIn = server.oauth?.signedIn === true;
  const needs = !signedIn && server.status === 'needsSignIn';
  const expired = needs && server.lastError === SIGN_IN_EXPIRED;
  const out = { word: '', detail: '', tone: '', wait: false, canSignIn: false, signInLabel: 'Sign in' };

  if (flow?.phase === 'waiting') {
    return { ...out, word: 'Waiting for your browser', detail: `Opens ${host || 'the service'} in your browser. 5 minutes to finish.`, tone: 'warn', wait: true };
  }
  if (flow?.phase === 'error' || flow?.phase === 'needsClientId') {
    const cancelled = /cancel/i.test(flow.message ?? '');
    return { ...out, word: cancelled ? 'Sign-in cancelled' : flow.phase === 'needsClientId' ? 'Needs a client ID' : 'Sign-in failed',
      detail: flow.phase === 'needsClientId' ? '' : flow.message ?? '', tone: cancelled || flow.phase === 'needsClientId' ? 'warn' : 'bad',
      canSignIn: needs && flow.phase === 'error', signInLabel: 'Try again' };
  }
  if (signedIn) return { ...out, word: 'Signed in', detail: server.oauth.account ?? 'Your account', tone: 'ok' };
  if (expired) return { ...out, word: 'Sign-in expired', detail: 'Sign in again to keep using it', tone: 'warn', canSignIn: true, signInLabel: 'Sign in again' };
  if (needs) return { ...out, word: 'Needs sign-in', detail: `Opens ${host || 'the service'} in your browser`, tone: 'warn', canSignIn: true };
  if (!server.enabled) return { ...out, word: 'Off' };
  if (server.status === 'connected') return { ...out, word: `✓ ${server.tools?.length ?? 0} tools`, tone: 'ok' };
  if (server.status === 'error') {
    return { ...out, word: server.lastError === KEY_REFUSED ? 'Key refused' : 'Error', detail: server.lastError ?? '', tone: 'bad' };
  }
  return { ...out, word: 'Not checked' };
}

const TONE = { ok: 'text-ok', warn: 'is-warn', bad: 'text-bad', '': '' };

/** Fill a `.cz-status` element (or make one) with the word and its dim line. */
export function renderStatus(status, doc = document, cell = null) {
  const box = cell ?? doc.createElement('span');
  box.className = `cz-status ${TONE[status.tone] ?? ''}`.trim();
  const word = doc.createElement('span');
  word.className = 'cz-status-word';
  word.textContent = status.word;
  box.replaceChildren(word);
  if (status.detail) {
    const detail = doc.createElement('small');
    detail.className = 'cz-status-detail';
    detail.textContent = status.detail;
    box.append(detail);
  }
  return box;
}

/**
 * The sign-ins in progress. `onChange()` asks the page to paint again; `onSignedIn(server, state)` runs when the person is back;
 * `open(url)` hands the address to the person's own browser.
 */
export function createSignInFlows({ getJSON, sendJSON, onChange, onSignedIn, open = (url) => window.open(url, '_blank', 'noopener'), pollMs = 1500 }) {
  const flows = new Map(); // connector id -> { phase: 'waiting' | 'needsClientId' | 'error', message?, until? }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function watch(server) {
    while (flows.get(server.id)?.phase === 'waiting') {
      await wait(pollMs);
      const flow = flows.get(server.id);
      if (flow?.phase !== 'waiting') return;
      const now = await getJSON(`/api/connectors/${server.id}/oauth`).catch(() => null);
      if (now?.signedIn) { flows.delete(server.id); await onSignedIn(server, now); return; }
      if (now?.error) { flows.set(server.id, { phase: 'error', message: now.error }); onChange(); return; }
      if (Date.now() > flow.until) { flows.set(server.id, { phase: 'error', message: 'The sign-in was not finished in 5 minutes. Try again.' }); onChange(); return; }
    }
  }

  async function start(server, clientId = '') {
    try {
      const out = await sendJSON(`/api/connectors/${server.id}/oauth/start`, 'POST', clientId ? { clientId } : {});
      flows.set(server.id, { phase: 'waiting', until: Date.now() + WAIT_MS });
      open(out.authUrl);
      onChange();
      watch(server);
    } catch (e) {
      flows.set(server.id, e.code === 'mcp.oauth.needsClientId' ? { phase: 'needsClientId', message: NEEDS_CLIENT_ID } : { phase: 'error', message: e.message });
      onChange();
    }
  }

  /** Sign out; resolves to the sentence to show (whether the service was told to end the access). */
  async function signOut(server) {
    try { return (await sendJSON(`/api/connectors/${server.id}/oauth/signout`, 'POST', {})).message; } catch (e) { return e.message; }
  }

  /** The line under a connector's name when it asks for a client ID: the sentence, a box, and Continue. */
  function clientIdBox(server, doc = document) {
    const flow = flows.get(server.id);
    if (flow?.phase !== 'needsClientId') return null;
    const box = doc.createElement('span');
    box.className = 'cz-signin-note';
    const text = doc.createElement('span');
    text.textContent = flow.message;
    const input = doc.createElement('input');
    input.className = 'input';
    input.placeholder = 'Client ID';
    input.setAttribute('aria-label', `Client ID for ${server.name}`);
    input.spellcheck = false;
    const go = doc.createElement('button');
    go.type = 'button';
    go.className = 'btn btn-primary btn-sm';
    go.textContent = 'Continue';
    go.addEventListener('click', () => { if (input.value.trim()) start(server, input.value.trim()); });
    box.append(text, input, go);
    return box;
  }

  return { start, signOut, clientIdBox, get: (id) => flows.get(id) ?? null, clear: (id) => { flows.delete(id); } };
}
