// Lets the model work a page in the browser panel, the way a person would.
// The panel's tabs are iframes named bunny-tab-<n>. Electron can run script
// inside such a frame even when the site is on another origin. Clicks and
// typing happen as page events (the same ones a click or keystroke fires), so
// they work whether or not the window has focus. Only the fixed script below
// ever runs in a page.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page. Numbers the links, buttons and fields it can see,
// and answers one request at a time.
function pageScript(action, args) {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],'
    + '[role=menuitem],[role=checkbox],[role=switch],[role=option],[role=combobox],[role=searchbox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const clean = (t, n = 80) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const byRef = (ref) => document.querySelector(`[data-bunny-ref="${Number(ref)}"]`);
  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'select';
    if (tag === 'textarea' || el.isContentEditable) return 'field';
    if (tag === 'input') return ['button', 'submit', 'reset', 'image'].includes(type) ? 'button'
      : ['checkbox', 'radio'].includes(type) ? type : `field${type && type !== 'text' ? ` (${type})` : ''}`;
    return el.getAttribute('role') || 'button';
  }
  function snapshot() {
    for (const el of document.querySelectorAll('[data-bunny-ref]')) el.removeAttribute('data-bunny-ref');
    const elements = [];
    let n = 1;
    for (const el of document.querySelectorAll(SEL)) {
      if (n > 150) break;
      if (!visible(el)) continue;
      el.setAttribute('data-bunny-ref', String(n));
      const kind = kindOf(el);
      const label = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder')
        || el.getAttribute('title') || el.querySelector?.('img[alt]')?.alt || el.getAttribute('name') || el.value);
      const secret = (el.getAttribute('type') || '').toLowerCase() === 'password';
      const value = kind.startsWith('field') && !secret && el.value ? clean(el.value, 60) : el.checked ? 'checked' : '';
      elements.push({ ref: n, kind, label, value });
      n += 1;
    }
    const text = String(document.body?.innerText ?? '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').slice(0, 7000);
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    return {
      url: location.href, title: document.title, text, elements,
      scroll: height > innerHeight + 4 ? `${Math.round(((scrollY + innerHeight) / height) * 100)}% down the page` : '',
    };
  }

  if (action === 'read') return snapshot();
  if (action === 'scroll') { scrollBy(0, (args.direction === 'up' ? -1 : 1) * innerHeight * 0.85); return null; }
  const el = byRef(args.ref);
  if (!el) return { error: `There is no element ${args.ref} on the page now. Read the page again for fresh numbers.` };
  if (action === 'click') {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.click();
    return { clicked: true };
  }
  if (action === 'type') {
    const tag = el.tagName.toLowerCase();
    const editable = el.isContentEditable || tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file'].includes((el.type || '').toLowerCase()));
    if (!editable) return { error: `Element ${args.ref} cannot be typed into.` };
    el.scrollIntoView({ block: 'center' });
    el.focus();
    const text = String(args.text ?? '');
    if (el.isContentEditable) {
      const range = document.createRange(); range.selectNodeContents(el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } else {
      el.select?.();
    }
    // insertText behaves like typing (frameworks see it); set the value directly if the page refuses it.
    let typed = false;
    try { typed = document.execCommand('insertText', false, text); } catch { typed = false; }
    if (!typed || (!el.isContentEditable && el.value !== text)) {
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      if (!el.isContentEditable) Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      else el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (args.submit) {
      const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      const go = el.dispatchEvent(new KeyboardEvent('keydown', key));
      el.dispatchEvent(new KeyboardEvent('keypress', key));
      el.dispatchEvent(new KeyboardEvent('keyup', key));
      if (go && el.form) { if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit(); else el.form.submit(); }
    }
    return { typed: true };
  }
  return { error: `Unknown action ${action}` };
}

const ACTIONS = new Set(['read', 'click', 'type', 'scroll', 'screenshot']);

function findFrame(contents, name) {
  return contents.mainFrame.framesInSubtree.find((f) => f.name === name && f.parent === contents.mainFrame) ?? null;
}

async function inPage(contents, name, action, args = {}) {
  // A page that is still loading has no script context yet: try for a few seconds.
  let lastError = null;
  for (let i = 0; i < 12; i += 1) {
    const frame = findFrame(contents, name);
    if (frame) {
      try {
        return await frame.executeJavaScript(`(${pageScript.toString()})(${JSON.stringify(action)}, ${JSON.stringify(args)})`);
      } catch (err) { lastError = err; }
    }
    await wait(400);
  }
  throw new Error(lastError ? `The page could not be reached: ${lastError.message}` : 'The browser tab is not open.');
}

/** Where the panel's frame sits in the window, in page pixels. */
async function frameBox(contents, name) {
  const box = await contents.mainFrame.executeJavaScript(`(() => {
    const f = document.querySelector('iframe[name=${JSON.stringify(name)}]');
    if (!f || f.hidden) return null;
    const r = f.getBoundingClientRect();
    return { x: r.left + f.clientLeft, y: r.top + f.clientTop, width: f.clientWidth, height: f.clientHeight };
  })()`);
  if (!box || box.width < 4 || box.height < 4) throw new Error('The browser panel is hidden. Open it and try again.');
  return box;
}

/**
 * Do one browser action in the panel tab `name`.
 * @returns {Promise<{page?: object, image?: string, note?: string, error?: string}>}
 */
export async function controlFrame(contents, name, action, args = {}) {
  if (!/^bunny-tab-\d+$/.test(String(name)) || !ACTIONS.has(action)) return { error: 'Not a browser action' };
  const zoom = contents.getZoomFactor();

  if (action === 'read') return { page: await inPage(contents, name, 'read') };

  if (action === 'scroll') {
    await inPage(contents, name, 'scroll', { direction: args.direction });
    await wait(250);
    return { page: await inPage(contents, name, 'read') };
  }

  if (action === 'click' || action === 'type') {
    const pageArgs = action === 'click' ? { ref: args.ref } : { ref: args.ref, text: String(args.text ?? '').slice(0, 5000), submit: Boolean(args.submit) };
    const done = await inPage(contents, name, action, pageArgs);
    if (done?.error) return done;
    await wait(action === 'type' && !args.submit ? 250 : 1500); // a click or Enter often loads something
    const note = action === 'click' ? `Clicked element ${args.ref}.` : `Typed into element ${args.ref}${args.submit ? ' and pressed Enter' : ''}.`;
    let page = await inPage(contents, name, 'read');
    if (!page?.text) { await wait(1500); page = await inPage(contents, name, 'read'); } // still loading
    return { note, page };
  }

  // screenshot: the part of the window the frame covers.
  const box = await frameBox(contents, name);
  const rect = { x: Math.round(box.x * zoom), y: Math.round(box.y * zoom), width: Math.round(box.width * zoom), height: Math.round(box.height * zoom) };
  let image = await contents.capturePage(rect);
  if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
  return { image: image.toDataURL(), note: 'Screenshot taken and shown in the chat.' };
}

/** The page script in a view's own page (W6-24): a view is a top-level page, so there is no frame to find. A page still loading is tried for a few seconds. */
async function inView(contents, action, args = {}) {
  let lastError = null;
  for (let i = 0; i < 12; i += 1) {
    try {
      return await contents.executeJavaScript(`(${pageScript.toString()})(${JSON.stringify(action)}, ${JSON.stringify(args)})`);
    } catch (err) { lastError = err; }
    await wait(400);
  }
  throw new Error(lastError ? `The page could not be reached: ${lastError.message}` : 'The browser tab is not open.');
}

/**
 * The same browser actions as controlFrame, for a tab that is a view (W6-24): read, click, type, scroll and screenshot.
 * @param {object} contents the view's webContents
 * @returns {Promise<{page?: object, image?: string, note?: string, error?: string}>}
 */
export async function controlView(contents, name, action, args = {}) {
  if (!/^bunny-tab-\d+$/.test(String(name)) || !ACTIONS.has(action)) return { error: 'Not a browser action' };
  if (action === 'read') return { page: await inView(contents, 'read') };
  if (action === 'scroll') {
    await inView(contents, 'scroll', { direction: args.direction });
    await wait(250);
    return { page: await inView(contents, 'read') };
  }
  if (action === 'click' || action === 'type') {
    const pageArgs = action === 'click' ? { ref: args.ref } : { ref: args.ref, text: String(args.text ?? '').slice(0, 5000), submit: Boolean(args.submit) };
    const done = await inView(contents, action, pageArgs);
    if (done?.error) return done;
    await wait(action === 'type' && !args.submit ? 250 : 1500);
    const note = action === 'click' ? `Clicked element ${args.ref}.` : `Typed into element ${args.ref}${args.submit ? ' and pressed Enter' : ''}.`;
    let page = await inView(contents, 'read');
    if (!page?.text) { await wait(1500); page = await inView(contents, 'read'); }
    return { note, page };
  }
  // screenshot: the whole view is the page
  let image = await contents.capturePage();
  if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
  return { image: image.toDataURL(), note: 'Screenshot taken and shown in the chat.' };
}
