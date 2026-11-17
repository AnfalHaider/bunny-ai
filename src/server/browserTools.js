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
  browser_inspect: 'read', // W6-10: looks only
  browser_compare: 'read', // W6-11: photographs two pages off screen and compares the pictures; changes nothing
  browser_capture: 'edit', // W6-10: writes files into the chat's folder, so Plan mode refuses it and the permission mode and the person's rules apply
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
    fn('browser_inspect', 'Look at the page in the browser panel without changing it: what "html" is the page as it is now (after its scripts), "css" is the computed style of the element matching `selector`, "network" is the list of files the page loaded (address, kind, size, time), "fonts" is the fonts it uses.',
      { what: { type: 'string', enum: ['html', 'css', 'network', 'fonts'] }, selector: { type: 'string', description: 'For what "css": a CSS selector' } }, ['what']),
    fn('browser_compare', 'Compare two web pages as pictures: each address is opened off screen, photographed at each width, and the two pictures are compared pixel by pixel. Returns, for each width, the share of pixels that differ, and shows a picture of both pages and where they differ. Quote the score when you say whether a page matches a design or another page. Only http and https pages (a local dev server is fine); it does not use the page open in the panel.',
      { a: { type: 'string', description: 'The first address' }, b: { type: 'string', description: 'The second address' }, widths: { type: 'array', items: { type: 'integer' }, description: 'Page widths in pixels, 320 to 1920, at most 3. Default 1280 and 390.' } }, ['a', 'b']),
    fn('browser_capture', 'Save a copy of the page in the browser panel into the chat\'s folder, under captures/<site>-<date and time>/: its HTML as it is now, and its pictures, style sheets, fonts and scripts, with the links changed to the saved copies so it opens offline. At most 300 files and 50 MB. Needs a folder for the chat.'),
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
    case 'browser_inspect': return `Inspect the page (${String(args.what ?? 'html').slice(0, 20)}${args.selector ? ` ${String(args.selector).slice(0, 60)}` : ''})`;
    case 'browser_capture': return 'Save a copy of the page';
    case 'browser_compare': return `Compare ${String(args.a ?? '').slice(0, 60)} with ${String(args.b ?? '').slice(0, 60)}`;
    default: return name;
  }
}

export const isBrowserTool = (name) => Object.hasOwn(BROWSER_TOOL_RISK, name);

/** What the window answered, as text for the model. */
export function browserResultText(answer) {
  if (!answer) return 'The browser panel did not answer.';
  if (answer.error) throw new Error(answer.error);
  if (answer.inspected) return inspectedText(answer.inspected);
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

/** The answer of browser_inspect as plain text for the model. */
export function inspectedText(got) {
  if (got?.error) throw new Error(got.error);
  if (got.what === 'html') return String(got.text ?? '');
  if (got.what === 'css') {
    return [`Computed style of ${got.selector} (<${got.tag}>), values that are not the default:`, ...(got.props ?? []).map(([name, value]) => `${name}: ${value}`)].join('\n');
  }
  if (got.what === 'network') {
    const rows = (got.entries ?? []).map((e) => `${e.type || 'other'}  ${e.size} bytes  ${e.ms} ms  ${e.url}`);
    return [`${got.total ?? rows.length} requests${(got.total ?? 0) > rows.length ? ` (the first ${rows.length} are listed)` : ''}:`, ...rows].join('\n');
  }
  if (got.what === 'fonts') return (got.fonts ?? []).length ? ['Fonts in use:', ...got.fonts.map((f) => `${f.family} ${f.weight} ${f.style}`)].join('\n') : 'No web fonts are loaded on this page.';
  return 'Nothing to show.';
}
