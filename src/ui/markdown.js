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

  // Images: https addresses, or a picture a model returned inline (data:image/...;base64).
  // Held as placeholders so the bold/italic passes cannot touch the address.
  const images = [];
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, src) => {
    const ok = /^https:\/\//i.test(src) || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src);
    if (!ok) return whole;
    images.push(`<img class="md-image" src="${src}" alt="${alt}" loading="lazy" />`);
    return `\u0001${images.length - 1}\u0001`;
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
  out = out.replace(/\u0001(\d+)\u0001/g, (_, index) => images[Number(index)]);
  return out;
}

/** Code longer than this many lines is folded in a reply until the person opens it. */
export const FOLD_LINES = 15;

function codeBlock(language, code, { fold = false } = {}) {
  const pre = document.createElement('pre');
  pre.className = 'code';
  const lineCount = code ? code.split('\n').length : 0;
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
  bar.append(label);
  const body = document.createElement('code');
  body.append(highlight(code, language));
  if (language) body.className = `language-${language}`;
  pre.append(bar, body);
  if (fold && lineCount > FOLD_LINES) {
    // Long code starts folded: a few lines, a fade, and a button to see it all.
    pre.classList.add('is-foldable', 'is-folded');
    pre.dataset.lines = String(lineCount);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'code-fold';
    toggle.dataset.fold = '1';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = `Show all ${lineCount} lines`;
    const foot = document.createElement('div');
    foot.className = 'code-foot';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'code-keep';
    keep.dataset.toArtifact = '1';
    keep.textContent = /^(html|htm|svg)$/i.test(language) ? 'Open as artifact' : 'Save as artifact';
    foot.append(toggle, keep);
    const top = toggle.cloneNode(true);
    top.className = 'code-fold code-fold-top';
    top.textContent = 'Expand';
    bar.append(top);
    pre.append(foot);
  }
  bar.append(copy);
  return pre;
}

/**
 * @param {string} markdown
 * @returns {DocumentFragment}
 */
export function renderMarkdown(markdown, { foldCode = false } = {}) {
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
      frag.append(codeBlock(language, code.join('\n'), { fold: foldCode }));
      continue;
    }

    if (!line.trim()) { flush(); continue; }

    // Table: a row of cells, then a |---|---| line, then more rows.
    const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (/^\s*\|?.*\|.*$/.test(line) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const table = document.createElement('table');
      table.className = 'md-table';
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      head.forEach((c, k) => {
        const th = document.createElement('th');
        th.innerHTML = inline(c);
        if (align[k]) th.style.textAlign = align[k];
        hr.append(th);
      });
      thead.append(hr);
      const tbody = document.createElement('tbody');
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const tr = document.createElement('tr');
        cells(lines[i]).slice(0, head.length).forEach((c, k) => {
          const td = document.createElement('td');
          td.innerHTML = inline(c);
          if (align[k]) td.style.textAlign = align[k];
          tr.append(td);
        });
        tbody.append(tr);
        i += 1;
      }
      i -= 1;
      table.append(thead, tbody);
      const wrap = document.createElement('div');
      wrap.className = 'md-table-wrap';
      wrap.append(table);
      frag.append(wrap);
      continue;
    }

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
