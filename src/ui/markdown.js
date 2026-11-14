/**
 * A small, safe Markdown renderer.
 *
 * Everything is escaped before any tag is produced, so a reply containing HTML
 * shows that HTML as text instead of running it. Only the tags this file builds
 * ever reach the DOM. It covers what model replies actually use: headings,
 * paragraphs, lists, quotes, rules, fenced code, inline code, bold, italic,
 * strikethrough and links.
 */

import { highlight } from './highlight.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Only these schemes are turned into links; anything else stays text. */
function safeHref(raw) {
  const href = String(raw ?? '').trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return null;
}

/** Inline formatting, applied to already-escaped text. */
function inline(text) {
  let out = escapeHtml(text);

  // Code first, so ** or _ inside a code span is left alone. The placeholder
  // keeps the span out of the bold/italic passes below.
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    const safe = safeHref(href);
    if (!safe) return whole;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  out = out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
  return out;
}

function codeBlock(language, code) {
  const pre = document.createElement('pre');
  pre.className = 'code';
  const bar = document.createElement('div');
  bar.className = 'code-bar';
  const label = document.createElement('span');
  label.className = 'code-lang';
  label.textContent = language || 'text';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'code-copy';
  copy.dataset.copy = '1';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', `Copy ${language || 'code'} block`);
  bar.append(label, copy);
  const body = document.createElement('code');
  body.append(highlight(code, language));
  if (language) body.className = `language-${language}`;
  pre.append(bar, body);
  return pre;
}

/**
 * @param {string} markdown
 * @returns {DocumentFragment}
 */
export function renderMarkdown(markdown) {
  const frag = document.createDocumentFragment();
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');

  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const p = document.createElement('p');
    p.innerHTML = inline(paragraph.join(' '));
    frag.append(p);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Fenced code
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flush();
      const language = fence[1] ?? '';
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      frag.append(codeBlock(language, code.join('\n')));
      continue;
    }

    if (!line.trim()) { flush(); continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const el = document.createElement(`h${Math.min(6, heading[1].length + 2)}`);
      el.innerHTML = inline(heading[2]);
      frag.append(el);
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      frag.append(document.createElement('hr'));
      continue;
    }

    if (/^\s*>/.test(line)) {
      flush();
      const quote = document.createElement('blockquote');
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      i -= 1;
      quote.innerHTML = inline(inner.join(' '));
      frag.append(quote);
      continue;
    }

    const listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      flush();
      const ordered = /\d/.test(listItem[1]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const next = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!next) break;
        const li = document.createElement('li');
        li.innerHTML = inline(next[2]);
        list.append(li);
        i += 1;
      }
      i -= 1;
      frag.append(list);
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return frag;
}
