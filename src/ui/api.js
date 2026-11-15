/** Thin client for the Bunny AI server. */

export async function getJSON(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message ?? `HTTP ${res.status}`), body);
  return body;
}

export async function sendJSON(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), data);
  return data;
}

/**
 * POST and consume a server-sent token stream.
 *
 * Both the stored-chat route and the incognito one-shot speak the same stream,
 * so there is one reader rather than two that can drift apart.
 *
 * @param {string} path
 * @param {object} body
 * @param {{onDelta?: (t: string) => void, onDone?: (d: any) => void, onError?: (e: any) => void, onCompacted?: (d: any) => void, signal?: AbortSignal}} handlers
 */
export async function streamAt(path, body, handlers = {}) {
  const { onDelta, onDone, onError, onCompacted, signal } = handlers;
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    onError?.(data);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'delta') onDelta?.(parsed.text ?? '');
      else if (event === 'done') onDone?.(parsed);
      else if (event === 'error') onError?.(parsed);
      else if (event === 'compacted') onCompacted?.(parsed);
      else if (event === 'tool') handlers.onTool?.(parsed);
      else if (event === 'permission') handlers.onPermission?.(parsed);
      else if (event === 'browser') handlers.onBrowser?.(parsed);
      else if (event === 'capability') handlers.onCapability?.(parsed);
      else if (event === 'tasks') handlers.onTasks?.(parsed);
      else if (event === 'thinking') handlers.onThinking?.(parsed);
    }
  }
}

/** A message in a stored conversation. */
export function streamMessage(sessionId, body, handlers) {
  return streamAt(`/api/sessions/${sessionId}/messages`, body, handlers);
}

/** A one-shot completion that is never written to disk (incognito). */
export function streamComplete(body, handlers) {
  return streamAt('/api/complete', body, handlers);
}

/** Computer use operations. */
export async function computerScreenshot(sessionId) {
  return sendJSON('/api/computer/screenshot', 'POST', { sessionId });
}
export async function computerClick(sessionId, x, y, button = 'left', count = 1) {
  return sendJSON('/api/computer/click', 'POST', { sessionId, x, y, button, count });
}
export async function computerType(sessionId, text) {
  return sendJSON('/api/computer/type', 'POST', { sessionId, text });
}
export async function computerKey(sessionId, keys) {
  return sendJSON('/api/computer/key', 'POST', { sessionId, keys });
}
export async function computerWait(sessionId, ms) {
  return sendJSON('/api/computer/wait', 'POST', { sessionId, ms });
}
export async function computerReset(sessionId) {
  return sendJSON('/api/computer/reset', 'POST', { sessionId });
}

/** Terminal operations. */
export async function terminalCreate({ shell = 'powershell.exe', cwd, rows = 40, cols = 120 } = {}) {
  return sendJSON('/api/terminal/create', 'POST', { shell, cwd, rows, cols });
}
export async function terminalWrite(id, text) {
  return sendJSON('/api/terminal/write', 'POST', { id, text });
}
export async function terminalRead(id) {
  return getJSON(`/api/terminal/read?id=${encodeURIComponent(id)}`);
}
export async function terminalResize(id, rows, cols) {
  return sendJSON('/api/terminal/resize', 'POST', { id, rows, cols });
}
export async function terminalKill(id) {
  return sendJSON('/api/terminal/kill', 'POST', { id });
}
export async function terminalList() {
  return getJSON('/api/terminal/list');
}

/** Session setting (folder, branch, permissionMode, effort). */
export async function sessionSetting(sessionId, name, value) {
  return sendJSON(`/api/sessions/${sessionId}/setting/${name}`, 'PATCH', { value });
}

/** Model ability labels. */
export async function fetchAbilities() {
  return getJSON('/api/abilities');
}

/** Escape text for safe insertion into HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Apply a saved theme. Anything other than light or dark clears the override so
 * the stylesheet's prefers-color-scheme rules decide.
 */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' || theme === 'dark' ? theme : '';
}
