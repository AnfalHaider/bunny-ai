/**
 * Syntax highlighting for code blocks.
 *
 * No dependencies and no language server: a small tokeniser per language family
 * that covers the highlighting that matters in a chat reply. Every token is
 * built as a DOM element with text content, so nothing a model writes can
 * become markup.
 */

/** @type {Record<string, {keywords: string[], line?: boolean, comment?: string[]}>} */
const LANGUAGES = {
  js: {
    keywords: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
      'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
      'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'super', 'switch',
      'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'],
    comment: ['//'],
  },
  ts: {
    keywords: ['abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class',
      'const', 'continue', 'declare', 'default', 'do', 'else', 'enum', 'export', 'extends', 'finally',
      'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'interface', 'keyof', 'let',
      'namespace', 'new', 'number', 'of', 'private', 'protected', 'public', 'readonly', 'return',
      'static', 'string', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void',
      'while', 'yield'],
    comment: ['//'],
  },
  python: {
    keywords: ['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
      'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
      'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try',
      'while', 'with', 'yield'],
    comment: ['#'],
  },
  bash: {
    keywords: ['case', 'do', 'done', 'elif', 'else', 'esac', 'export', 'fi', 'for', 'function', 'if',
      'in', 'local', 'return', 'then', 'until', 'while'],
    comment: ['#'],
  },
  json: { keywords: ['true', 'false', 'null'] },
  css: { keywords: ['important', 'inherit', 'initial', 'unset'] },
  html: { keywords: [] },
};

const ALIASES = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  typescript: 'ts', tsx: 'ts',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  yml: 'yaml',
  md: 'markdown', htm: 'html', xml: 'html', svg: 'html',
};

export function languageOf(name) {
  const key = String(name ?? '').toLowerCase();
  const resolved = ALIASES[key] ?? key;
  return Object.keys(LANGUAGES).includes(resolved) ? resolved : '';
}

/**
 * Split code into styled tokens.
 * @param {string} code
 * @param {string} language
 * @returns {DocumentFragment}
 */
export function highlight(code, language) {
  const frag = document.createDocumentFragment();
  const name = languageOf(language);
  if (!name) {
    frag.append(document.createTextNode(code));
    return frag;
  }

  const spec = LANGUAGES[name];
  const keywords = new Set(spec.keywords);
  const commentStart = spec.comment ?? [];

  const lines = String(code).split('\n');
  lines.forEach((line, index) => {
    if (index) frag.append(document.createTextNode('\n'));

    // A comment runs to the end of the line.
    const commentAt = commentStart
      .map((marker) => line.indexOf(marker))
      .filter((at) => at >= 0)
      .sort((a, b) => a - b)[0];

    if (commentAt !== undefined) {
      frag.append(highlightLine(line.slice(0, commentAt), name, keywords));
      const comment = document.createElement('span');
      comment.className = 'tok-comment';
      comment.textContent = line.slice(commentAt);
      frag.append(comment);
      return;
    }
    frag.append(highlightLine(line, name, keywords));
  });

  return frag;
}

/** Highlight one line of code, without the comment rule. */
function highlightLine(line, language, keywords) {
  const frag = document.createDocumentFragment();
  const pattern = language === 'html'
    ? /(<\/?[a-zA-Z][\w-]*|\/?>|[\w-]+=)/g
    : /("[^"]*"|'[^']*'|`[^`]*`|\b\d[\w.]*\b|\b[A-Za-z_$][\w$]*\b)/g;

  let last = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) {
      frag.append(document.createTextNode(line.slice(last, match.index)));
    }
    const token = match[0];
    const kind = classify(token, language, keywords);
    if (kind) {
      const span = document.createElement('span');
      span.className = `tok-${kind}`;
      span.textContent = token;
      frag.append(span);
    } else {
      frag.append(document.createTextNode(token));
    }
    last = match.index + token.length;
  }
  if (last < line.length) frag.append(document.createTextNode(line.slice(last)));
  return frag;
}

function classify(token, language, keywords) {
  if (/^["'`]/.test(token)) return 'string';
  if (/^\d/.test(token)) return 'number';
  if (language === 'html') {
    if (token.startsWith('<')) return 'tag';
    if (/^[\w-]+=$/.test(token)) return 'attr';
    return null;
  }
  if (keywords.has(token)) return 'keyword';
  if (token === 'true' || token === 'false' || token === 'null') return 'literal';
  if (/^[A-Z]/.test(token)) return 'type';
  return null;
}
