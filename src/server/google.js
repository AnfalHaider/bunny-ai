/**
 * Gmail, Calendar and Drive, for a Google account signed in with them allowed.
 *
 * Reading follows the permission mode as reading does everywhere. Writing a draft
 * or adding a calendar event is an edit (asks in Manual and Accept edits). Sending
 * an email always asks, whatever the mode: it speaks for the person.
 */

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
];

export const GOOGLE_TOOL_RISK = {
  gmail_search: 'read', gmail_read: 'read', gmail_draft: 'edit', gmail_send: 'send',
  calendar_events: 'read', calendar_create_event: 'edit',
  drive_search: 'read', drive_read: 'read',
};

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export function googleToolDefinitions(risks) {
  return [
    fn('gmail_search', 'Search the person\'s Gmail with Gmail search syntax (from:, subject:, newer_than:7d, is:unread). Returns sender, subject, date and a snippet.',
      { query: { type: 'string' }, limit: { type: 'integer', description: 'Up to 25, default 10' } }, ['query']),
    fn('gmail_read', 'Read one email in full by its id (from gmail_search).', { id: { type: 'string' } }, ['id']),
    fn('gmail_draft', 'Write an email as a draft in Gmail, for the person to check and send.',
      { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, ['to', 'subject', 'body']),
    fn('gmail_send', 'Send an email from the person\'s Gmail. The person always confirms first. Prefer gmail_draft unless they asked to send.',
      { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, ['to', 'subject', 'body']),
    fn('calendar_events', 'List the person\'s upcoming Google Calendar events.',
      { days_ahead: { type: 'integer', description: 'How many days ahead, default 7' }, query: { type: 'string', description: 'Only events matching this text' } }),
    fn('calendar_create_event', 'Add an event to the person\'s Google Calendar.',
      { title: { type: 'string' }, start: { type: 'string', description: 'ISO date-time, e.g. 2026-11-20T15:00:00+05:00' },
        end: { type: 'string', description: 'ISO date-time' }, description: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses' } }, ['title', 'start', 'end']),
    fn('drive_search', 'Search the person\'s Google Drive by file name or text.', { query: { type: 'string' } }, ['query']),
    fn('drive_read', 'Read a Google Drive file as text: Docs as text, Sheets as CSV, Slides as text, and plain text files.',
      { id: { type: 'string' } }, ['id']),
  ].filter((d) => risks.includes(GOOGLE_TOOL_RISK[d.function.name]));
}

export function isGoogleTool(name) {
  return Object.hasOwn(GOOGLE_TOOL_RISK, name);
}

export function describeGoogleTool(name, a = {}) {
  const s = (v, n = 60) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  switch (name) {
    case 'gmail_search': return `Search Gmail for "${s(a.query)}"`;
    case 'gmail_read': return 'Read an email';
    case 'gmail_draft': return `Draft an email to ${s(a.to, 80)}: "${s(a.subject)}"`;
    case 'gmail_send': return `Send an email to ${s(a.to, 80)}: "${s(a.subject)}"`;
    case 'calendar_events': return 'Look at the calendar';
    case 'calendar_create_event': return `Add "${s(a.title)}" to the calendar`;
    case 'drive_search': return `Search Drive for "${s(a.query)}"`;
    case 'drive_read': return 'Read a Drive file';
    default: return name;
  }
}

const MAX = 12_000;
const clip = (t) => (t.length > MAX ? `${t.slice(0, MAX)}\n… (cut short)` : t);
const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';

/** The plain text of an email, from its parts (HTML stripped when there is no text part). */
function bodyText(payload) {
  const parts = [];
  const walk = (p) => { if (!p) return; parts.push(p); (p.parts ?? []).forEach(walk); };
  walk(payload);
  const decode = (d) => Buffer.from(String(d).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return decode(plain.body.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  return html ? decode(html.body.data).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** An email as Gmail wants it to send or draft: RFC 2822, base64url. */
function rawEmail({ to, subject, body }) {
  const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ');
  const text = [`To: ${clean(to)}`, `Subject: =?UTF-8?B?${Buffer.from(clean(subject)).toString('base64')}?=`, 'Content-Type: text/plain; charset=UTF-8', 'MIME-Version: 1.0', '', String(body ?? '')].join('\r\n');
  return Buffer.from(text).toString('base64url');
}

/** Run one Google tool with an access token. */
export async function runGoogleTool(name, a = {}, { token, fetchImpl = globalThis.fetch }) {
  const call = async (url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.status === 401) throw new Error('Google refused the sign-in. Sign in again in Settings, Profile.');
    if (res.status === 403) throw new Error(`Google said no: ${data?.error?.message ?? 'this needs Gmail, Calendar and Drive allowed at sign-in'}`);
    if (!res.ok) throw new Error(`Google answered ${res.status}: ${data?.error?.message ?? String(text).slice(0, 200)}`);
    return data;
  };
  const gmail = 'https://gmail.googleapis.com/gmail/v1/users/me';
  switch (name) {
    case 'gmail_search': {
      const n = Math.max(1, Math.min(25, Number(a.limit) || 10));
      const list = await call(`${gmail}/messages?maxResults=${n}&q=${encodeURIComponent(String(a.query ?? ''))}`);
      if (!list.messages?.length) return 'No emails found.';
      const rows = [];
      for (const m of list.messages) {
        const msg = await call(`${gmail}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        rows.push(`[${m.id}] ${header(msg, 'date')} · ${header(msg, 'from')} · ${header(msg, 'subject')}\n  ${String(msg.snippet ?? '').slice(0, 200)}`);
      }
      return rows.join('\n');
    }
    case 'gmail_read': {
      const msg = await call(`${gmail}/messages/${encodeURIComponent(String(a.id ?? ''))}?format=full`);
      return clip([`From: ${header(msg, 'from')}`, `To: ${header(msg, 'to')}`, `Date: ${header(msg, 'date')}`, `Subject: ${header(msg, 'subject')}`, '', bodyText(msg.payload) || msg.snippet || '(no text)'].join('\n'));
    }
    case 'gmail_draft': {
      const d = await call(`${gmail}/drafts`, { method: 'POST', body: JSON.stringify({ message: { raw: rawEmail(a) } }) });
      return `Saved a draft to ${a.to} in Gmail (draft ${d.id}). It is waiting in Drafts for the person to send.`;
    }
    case 'gmail_send': {
      const m = await call(`${gmail}/messages/send`, { method: 'POST', body: JSON.stringify({ raw: rawEmail(a) }) });
      return `Sent the email to ${a.to} (message ${m.id}).`;
    }
    case 'calendar_events': {
      const days = Math.max(1, Math.min(60, Number(a.days_ahead) || 7));
      const from = new Date();
      const to = new Date(Date.now() + days * 86_400_000);
      const q = a.query ? `&q=${encodeURIComponent(a.query)}` : '';
      const list = await call(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${from.toISOString()}&timeMax=${to.toISOString()}${q}`);
      const items = list.items ?? [];
      return items.length ? items.map((e) => `${e.start?.dateTime ?? e.start?.date} → ${e.end?.dateTime ?? e.end?.date}: ${e.summary ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''}`).join('\n') : `Nothing in the next ${days} days.`;
    }
    case 'calendar_create_event': {
      const e = await call('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        body: JSON.stringify({ summary: String(a.title ?? ''), description: a.description ?? '', start: { dateTime: a.start }, end: { dateTime: a.end },
          ...(Array.isArray(a.attendees) ? { attendees: a.attendees.map((email) => ({ email })) } : {}) }),
      });
      return `Added "${e.summary}" on ${e.start?.dateTime ?? a.start}: ${e.htmlLink ?? ''}`;
    }
    case 'drive_search': {
      const term = String(a.query ?? '').replace(/'/g, "\\'");
      const list = await call(`https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime)&q=${encodeURIComponent(`(name contains '${term}' or fullText contains '${term}') and trashed = false`)}`);
      return (list.files ?? []).map((f) => `[${f.id}] ${f.name} (${f.mimeType.replace('application/vnd.google-apps.', 'Google ')}) · ${String(f.modifiedTime).slice(0, 10)}`).join('\n') || 'No files found.';
    }
    case 'drive_read': {
      const id = encodeURIComponent(String(a.id ?? ''));
      const meta = await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`);
      const exportAs = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv', 'application/vnd.google-apps.presentation': 'text/plain' }[meta.mimeType];
      const url = exportAs ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(exportAs)}` : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
      if (!exportAs && !/^text\/|json|xml|csv|markdown/.test(meta.mimeType)) return `${meta.name} is a ${meta.mimeType} file, not readable as text here.`;
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Google answered ${res.status} for ${meta.name}`);
      return clip(`${meta.name}:\n${await res.text()}`);
    }
    default:
      throw new Error(`There is no Google tool called ${name}`);
  }
}
