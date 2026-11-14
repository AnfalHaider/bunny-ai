/**
 * What an artifact really is, read from the reply it was saved from.
 *
 * Models rarely answer with bare HTML: they say "Here is your page:" and put the
 * page in a ```html block. Treating any reply with ``` as "code" showed those
 * pages as raw text. This finds the real content instead:
 *   - a reply that starts with an HTML tag is HTML;
 *   - otherwise the largest fenced block decides: html/svg (or a block that
 *     starts with a tag) is HTML, anything else is code in that language;
 *   - a reply with no fenced block is Markdown.
 * Pure function, no DOM: the server's "Open" route uses it too.
 */
const TAG_START = /^\s*(<!doctype html|<html|<head|<body|<svg|<div|<main|<section|<h1|<style|<canvas|<table)/i;
const HTML_LANGS = new Set(['html', 'htm', 'svg', 'xhtml']);

export function resolveArtifact(content, storedKind = '') {
  const text = String(content ?? '');
  if (TAG_START.test(text)) return { kind: 'html', body: text, lang: 'html' };

  const blocks = [];
  const fence = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;
  for (let m = fence.exec(text); m; m = fence.exec(text)) blocks.push({ lang: m[1].toLowerCase(), body: m[2] });
  if (blocks.length) {
    const main = blocks.reduce((a, b) => (b.body.length > a.body.length ? b : a));
    if (HTML_LANGS.has(main.lang) || TAG_START.test(main.body)) return { kind: 'html', body: main.body, lang: 'html' };
    // A reply that is mostly one block of code is that code; prose with snippets stays Markdown.
    if (main.body.length >= text.length * 0.6) return { kind: 'code', body: main.body, lang: main.lang };
  }
  return { kind: storedKind === 'code' && !blocks.length ? 'code' : 'markdown', body: text, lang: '' };
}

/** HTML fragments get a minimal page around them so they render with sane defaults. */
export function htmlDocument(body) {
  if (/<html[\s>]/i.test(body) || /<!doctype/i.test(body)) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:16px;line-height:1.5}</style></head><body>
${body}
</body></html>`;
}

/**
 * A readable name for an artifact: the page's <title> or first heading, else the
 * saved title without the reply's lead-in ("Here is a clean, modern …").
 */
export function artifactName(content, fallback = '') {
  const shown = resolveArtifact(content);
  const text = (t) => String(t ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (shown.kind === 'html') {
    const named = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(shown.body)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(shown.body)?.[1];
    if (text(named)) return text(named).slice(0, 80);
  }
  if (shown.kind === 'markdown') {
    const heading = /^#{1,3}\s+(.+)$/m.exec(shown.body)?.[1];
    if (text(heading)) return text(heading).slice(0, 80);
  }
  const cleaned = String(fallback).replace(/^(here(?:'s| is| are)|sure[,!.]?|okay[,!.]?|certainly[,!.]?)\s+(?:is\s+)?(?:an?|the|your)?\s*/i, '').trim();
  return (cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : fallback).slice(0, 80);
}
