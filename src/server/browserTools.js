/**
 * Browser tools: the model drives the browser panel the person can see.
 *
 * The server never touches the page. It asks the open Bunny window to act
 * (an SSE "browser" event), and the window answers with what happened.
 * Only the desktop app can reach inside other sites, so the window says
 * whether it can (browserControl in the message body) and the tools are
 * offered only then.
 *
 *   read  - browser_open, browser_read, browser_scroll, browser_back, browser_screenshot
 *   edit  - browser_click, browser_type   (they change things on a page, so they follow the permission mode)
 */

export const BROWSER_TOOL_RISK = {
  browser_open: 'read', browser_read: 'read', browser_scroll: 'read', browser_back: 'read', browser_screenshot: 'read',
  browser_click: 'edit', browser_type: 'edit',
};

export function browserToolDefinitions(risks = ['read', 'edit']) {
  const fn = (name, description, properties = {}, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  return [
    fn('browser_open', 'Open a web page in the browser panel the person can see. Returns the page\'s text and its numbered links, buttons and fields.',
      { url: { type: 'string' } }, ['url']),
    fn('browser_read', 'Read the page now in the browser panel: its text and numbered links, buttons and fields (use the numbers with browser_click and browser_type).'),
    fn('browser_click', 'Click a link, button or other element on the page, by its number from browser_read.',
      { ref: { type: 'integer' } }, ['ref']),
    fn('browser_type', 'Type into a field on the page, by its number from browser_read. Replaces what the field had. submit: press Enter afterwards.',
      { ref: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' } }, ['ref', 'text']),
    fn('browser_scroll', 'Scroll the page up or down by about one screen.',
      { direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']),
    fn('browser_back', 'Go back to the previous page in the browser panel.'),
    fn('browser_screenshot', 'Take a picture of the browser panel and show it in the chat, so the person sees what you see.'),
  ].filter((d) => risks.includes(BROWSER_TOOL_RISK[d.function.name]));
}

export function describeBrowserTool(name, args = {}) {
  switch (name) {
    case 'browser_open': return `Open ${String(args.url ?? '').slice(0, 100)}`;
    case 'browser_read': return 'Read the page';
    case 'browser_click': return `Click element ${args.ref}`;
    case 'browser_type': return `Type into element ${args.ref}${args.submit ? ' and press Enter' : ''}`;
    case 'browser_scroll': return `Scroll ${args.direction === 'up' ? 'up' : 'down'}`;
    case 'browser_back': return 'Go back';
    case 'browser_screenshot': return 'Take a screenshot of the page';
    default: return name;
  }
}

export const isBrowserTool = (name) => Object.hasOwn(BROWSER_TOOL_RISK, name);

/** What the window answered, as text for the model. */
export function browserResultText(answer) {
  if (!answer) return 'The browser panel did not answer.';
  if (answer.error) throw new Error(answer.error);
  const page = answer.page;
  if (!page) return String(answer.note ?? 'Done.');
  const lines = [];
  if (answer.note) lines.push(answer.note);
  lines.push(`Page: ${page.title || '(no title)'} — ${page.url}`);
  if (page.scroll) lines.push(`Scrolled ${page.scroll}`);
  if (page.elements?.length) {
    lines.push('Elements:');
    for (const e of page.elements) lines.push(`[${e.ref}] ${e.kind}${e.label ? ` "${e.label}"` : ''}${e.value ? ` value="${e.value}"` : ''}`);
  }
  lines.push('Text:', page.text || '(no text)');
  return lines.join('\n');
}
