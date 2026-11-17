/**
 * Workspace tools: what the model may do inside the folder a chat works in.
 *
 * Every path is resolved against the chosen folder and refused if it leaves it
 * (including through "..", an absolute path, or a symlink that points outside).
 * Tools are split by risk so the permission mode can decide what runs freely:
 *   read  - list_files, read_file, search_files, find_files
 *   edit  - write_file, edit_file, multi_edit
 *   run   - run_command
 */
import { exec, execFile, spawn } from 'node:child_process';
import { clip } from './clip.js';
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { documentKind, readDocument } from './documents.js';
import { readTextInPictures } from './ocr.js';
import { globMatcher } from './glob.js';
import { checkEnvironment } from './environment.js';
import { createContext, Script } from 'node:vm';
import { fetchLimited } from './download.js';

const MAX_READ = 200_000;          // characters returned from one read
const MAX_LIST = 400;              // entries in one listing
const MAX_MATCHES = 80;            // search hits
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', 'coverage', '__pycache__', '.venv']);
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_SECONDS = 600;   // the longest a run_command may be given (W6-17)
const KEEP_OUTPUT = 2_000_000;     // characters of command output kept; the app saves the whole of it in .bunny/notes
const REGEX_TIMEOUT_MS = 1000;     // one file's scan with a model-written regular expression
const REGEX_BUDGET_MS = 5000;      // all of one search's regex time together (files just under the limit must not add up to minutes)
const MAX_EDIT_BYTES = 20_000_000; // an edit may not grow a file past this
// Nobody can answer a prompt from a command Bunny runs: tools are told not to ask.
export const NON_INTERACTIVE = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', npm_config_yes: 'true', NO_UPDATE_NOTIFIER: '1' };

/**
 * Said before every command the model runs. In Windows PowerShell 5.1 "curl" is
 * Invoke-WebRequest, which can stop on a hidden Internet Explorer prompt; the real
 * curl.exe ships with Windows, so curl means that. Web requests skip the IE engine,
 * and progress bars (which slow output to a crawl) are off.
 */
export const POWERSHELL_PRELUDE = [
  "$ProgressPreference = 'SilentlyContinue'",
  "$PSDefaultParameterValues['Invoke-WebRequest:UseBasicParsing'] = $true",
  'Remove-Item Alias:curl -ErrorAction SilentlyContinue',
  'Remove-Item Alias:wget -ErrorAction SilentlyContinue',
  // > and Out-File write UTF-16 in Windows PowerShell 5.1, which nothing else reads well; and
  // programs' output is read as UTF-8 so their words do not come back garbled.
  "$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'",
  "$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'",
  "$PSDefaultParameterValues['Add-Content:Encoding'] = 'utf8'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$OutputEncoding = [Text.Encoding]::UTF8',
].join('; ');

/**
 * A text file as words, whatever it was saved as: UTF-8 (with or without a byte-order mark)
 * or UTF-16, which is what Windows PowerShell 5.1 writes with > .
 */
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

/**
 * Windows PowerShell 5.1 has no && or ||. Models write them all the time, so a chain is
 * rewritten into the form 5.1 understands: a && b  ->  a; if ($?) { b }. Quoted text is left alone.
 */
export function translateChains(command) {
  // A trailing "&" (run in the background) is not PowerShell 5.1 syntax and fails with AmpersandNotAllowed.
  // run_command refuses it with a pointer to start_process; start_process is already the background form.
  if (endsInBackground(command)) command = command.replace(/\s*&\s*$/, '');
  const parts = [];
  const ops = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === '`' && i + 1 < command.length) { current += command[i + 1]; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { parts.push(current.trim()); ops.push(two); current = ''; i += 1; continue; }
    current += ch;
  }
  parts.push(current.trim());
  if (!ops.length || parts.some((x) => !x)) return command;
  let out = parts[parts.length - 1];
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    out = ops[i] === '&&' ? `${parts[i]}; if ($?) { ${out} }` : `${parts[i]}; if (-not $?) { ${out} }`;
  }
  return out;
}

/** Does the command end with an unquoted single "&" (a background job in bash)? */
export function endsInBackground(command) {
  let quote = null;
  let last = '';
  let before = '';
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === '`' && i + 1 < command.length) { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; before = last; last = ch; continue; }
    if (/\s/.test(ch)) continue;
    before = last;
    last = ch;
  }
  return !quote && last === '&' && before !== '&';
}

export const TOOL_RISK = {
  list_files: 'read', read_file: 'read', search_files: 'read', find_files: 'read', check_environment: 'read',
  write_file: 'edit', edit_file: 'edit', multi_edit: 'edit', download_file: 'edit',
  run_command: 'run',
};

/** Tool definitions in the OpenAI function format the chat layer already uses. */
export function workspaceToolDefinitions(risks = ['read', 'edit', 'run']) {
  const fn = (name, description, properties, required) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  const all = [
    fn('list_files', 'List files and folders in the workspace (relative paths). Skips .git, node_modules and build output.',
      { path: { type: 'string', description: 'Folder relative to the workspace root. Default "."' },
        depth: { type: 'integer', description: 'How many levels deep, 1 to 4. Default 2' } }, []),
    fn('read_file', 'Read a file from the workspace: text and code, and documents (PDF, Word, Excel, PowerPoint, OpenDocument, RTF, old .doc/.xls/.ppt) as their text, with the words in their pictures. Optionally a line range.',
      { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, ['path']),
    fn('search_files', 'Search file contents in the workspace. By default query is plain text, case-insensitive; set regex for a regular expression and case_sensitive for exact case. '
      + 'include / exclude are file patterns such as "*.js", "src/**" or "*.{ts,tsx}" (comma-separated for several). context adds lines around each match. '
      + 'output: "lines" (path:line: text, the default), "files" (only the names of files that match) or "counts" (matches per file). '
      + 'Skips .git, node_modules, build output and binary files, and says so when it stops at the limit.',
      { query: { type: 'string', description: 'Text, or a regular expression when regex is true' },
        path: { type: 'string', description: 'Folder (or one file) to search, default "."' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression' },
        case_sensitive: { type: 'boolean', description: 'Match case exactly. Default false' },
        include: { type: 'string', description: 'Only files matching this pattern, e.g. "*.js,src/**"' },
        exclude: { type: 'string', description: 'Skip files matching this pattern, e.g. "*.test.js"' },
        context: { type: 'integer', description: 'Lines to show before and after each match, 0 to 10' },
        output: { type: 'string', enum: ['lines', 'files', 'counts'], description: 'Result shape. Default "lines"' },
        limit: { type: 'integer', description: 'Most results to return, up to 1000. Default 80' } }, ['query']),
    fn('find_files', 'Find files by name pattern, newest first. pattern examples: "**/*.test.js", "src/**", "*.{ts,tsx}", "README*" (a pattern with no / matches the file name at any depth). Skips .git, node_modules and build output. Use it to locate files; use search_files to look inside them.',
      { pattern: { type: 'string', description: 'File pattern, comma-separated for several' },
        path: { type: 'string', description: 'Folder to search in, default "."' },
        limit: { type: 'integer', description: 'Most files to return, up to 1000. Default 100' } }, ['pattern']),
    fn('check_environment', 'Check which of node, npm, git and python (and their versions) are installed, compare them with what the project asks for (package.json engines, .nvmrc, .python-version, pyproject.toml, runtime.txt, .tool-versions) and get plain advice. Read-only; installs nothing. Call it once before installing a project\'s packages.',
      { path: { type: 'string', description: 'Folder inside the workspace to inspect. Default "."' } }, []),
    fn('write_file', 'Create or overwrite a whole text file in the workspace.',
      { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    fn('download_file', 'Download a file from an http or https address into the workspace (up to 50 MB, public addresses only). Returns the saved path, size and content type.',
      { url: { type: 'string', description: 'http or https address' }, path: { type: 'string', description: 'Where to save it, relative to the workspace root' } }, ['url', 'path']),
    fn('edit_file', 'Replace an exact snippet in a file. old_text must appear exactly once, unless replace_all is true, which replaces every occurrence (renaming a variable, say).',
      { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence of old_text. Default false' } }, ['path', 'old_text', 'new_text']),
    fn('multi_edit', 'Apply several exact replacements to ONE file in order, all or nothing: if any one fails, the file is left untouched. One Undo covers all of them. Each edit sees the result of the ones before it.',
      { path: { type: 'string' },
        edits: { type: 'array', description: 'The replacements, applied in order (at most 50)',
          items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['old_text', 'new_text'] } } }, ['path', 'edits']),
    fn('run_command', 'Run a command yourself and get its output (2 minute limit by default; pass timeout_seconds, up to 600, for a long build or install). It runs in Windows PowerShell 5.1: '
      + 'set variables with $env:NAME = "value", and separate commands with ; (&& and || are translated for you; a trailing & is not allowed: use start_process for anything that keeps running). '
      + 'Each call starts fresh in the workspace folder: cd does not carry over, so pass cwd to run somewhere else.',
      { command: { type: 'string' }, cwd: { type: 'string', description: 'Folder inside the workspace to run in, e.g. "rea". Default: the workspace folder' }, timeout_seconds: { type: 'integer', description: 'How long it may run before it is stopped: 1 to 600 seconds. Default 120.' } }, ['command']),
  ];
  return all.filter((d) => risks.includes(TOOL_RISK[d.function.name]));
}

/** A short, human line for the transcript: "Read src/app.js". */
export function describeToolCall(name, args = {}) {
  switch (name) {
    case 'list_files': return `List ${args.path || '.'}`;
    case 'read_file': return `Read ${args.path}`;
    case 'search_files': {
      const q = String(args.query ?? '').slice(0, 60);
      return `Search ${args.regex ? `/${q}/` : `"${q}"`}${args.path && args.path !== '.' ? ` in ${args.path}` : ''}${args.include ? ` (${String(args.include).slice(0, 40)})` : ''}`;
    }
    case 'find_files': return `Find ${String(args.pattern ?? '').slice(0, 60)}${args.path && args.path !== '.' ? ` in ${args.path}` : ''}`;
    case 'check_environment': return `Check environment${args.path && args.path !== '.' ? ` in ${args.path}` : ''}`;
    case 'write_file': return `Write ${args.path}`;
    case 'download_file': return `Download ${String(args.url ?? '').slice(0, 100)} to ${args.path}`;
    case 'edit_file': return `Edit ${args.path}${args.replace_all ? ' (all occurrences)' : ''}`;
    case 'multi_edit': return `Edit ${args.path} (${Array.isArray(args.edits) ? args.edits.length : 0} changes)`;
    case 'run_command': return `Run ${String(args.command ?? '').slice(0, 120)}${Number(args.timeout_seconds) > 120 ? ` (up to ${Math.round(Math.min(600, Number(args.timeout_seconds)) / 60 * 10) / 10} min)` : ''}`;
    default: return name;
  }
}

/** Is this a folder the workspace can use? */
export async function checkFolder(folder) {
  const raw = String(folder ?? '').trim();
  if (!raw || !isAbsolute(raw)) return { ok: false, reason: 'Give the full path of a folder, for example D:\\Projects\\my-app.' };
  try {
    const info = await stat(raw);
    if (!info.isDirectory()) return { ok: false, reason: 'That path is a file, not a folder.' };
    return { ok: true, folder: await realpath(raw) };
  } catch {
    return { ok: false, reason: 'That folder does not exist.' };
  }
}

/** The git branch the folder is on, or null. */
export function gitBranch(folder) {
  return new Promise((done) => {
    exec('git rev-parse --abbrev-ref HEAD', { cwd: folder, timeout: 5000, windowsHide: true }, (err, stdout) => {
      done(err ? null : String(stdout).trim() || null);
    });
  });
}

/** beforeWrite(absolutePath) runs before a file is written or edited (for undo). */
export function createWorkspace(rootFolder, { envRunner = undefined, beforeWrite = null, signal = null, hidden = null, clock = Date.now, allowLoopback = process.env.BUNNY_ALLOW_LOOPBACK_DOWNLOAD === '1' } = {}) {
  const root = resolve(rootFolder);

  async function inside(path = '.', { mustExist = true } = {}) {
    const target = resolve(root, String(path || '.'));
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${path} is outside the workspace folder`);
    if (mustExist) {
      const real = await realpath(target);
      const realRoot = await realpath(root);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error(`${path} points outside the workspace folder`);
    } else {
      // A new file: its nearest existing parent must still be inside.
      let parent = dirname(target);
      for (;;) {
        try {
          const real = await realpath(parent);
          const realRoot = await realpath(root);
          if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error(`${path} points outside the workspace folder`);
          break;
        } catch (err) {
          if (err.message.includes('outside')) throw err;
          const up = dirname(parent);
          if (up === parent) break;
          parent = up;
        }
      }
    }
    return target;
  }

  const show = (abs) => relative(root, abs).split(sep).join('/') || '.';

  // W6-NEW-1: a file written inside .git (a hook, the config) runs the next time the person commits, so the edit tools refuse it.
  // ".git", ".git." and ".git::$DATA" are all the same folder on NTFS, and so is its short name GIT~1.
  const GIT_SEGMENT = /^(.git|git~d+)(?:[. ]*|:.*)$/i;
  const inGit = (from, abs) => relative(from, abs).split(sep).some((part) => GIT_SEGMENT.test(part));
  async function refuseGit(abs, path) {
    let bad = inGit(root, abs);
    if (!bad) { // where it really leads: the nearest folder that exists, with its links resolved
      let cur = abs;
      for (let guard = 0; guard < 256 && !bad; guard += 1) {
        try {
          const real = join(await realpath(cur), relative(cur, abs));
          bad = inGit(await realpath(root), real);
          break;
        } catch {
          const up = dirname(cur);
          if (up === cur) break;
          cur = up;
        }
      }
    }
    if (bad) throw new Error(`${path} is inside .git. Bunny does not write there: a file in .git (a hook, the config) runs the next time you commit. Change it yourself in a terminal if you mean to.`);
    return abs;
  }
  /** inside(), for the tools that change a file. */
  const insideEdit = async (path, opts) => refuseGit(await inside(path, opts), path);

  /** The path as the file system will see it (links resolved, ".." applied), relative to the folder; null when it leaves the folder; false when it cannot be worked out (a dangling link, no permission). For the person's rules. */
  async function canon(path = '.') {
    const rest = [];
    let cur = resolve(root, String(path || '.'));
    for (let guard = 0; guard < 256; guard += 1) {
      try {
        const real = join(await realpath(cur), ...rest.reverse());
        const rel = relative(await realpath(root), real);
        return rel.startsWith('..') || isAbsolute(rel) ? null : (rel.split(sep).join('/') || '.');
      } catch (err) {
        // A link that points nowhere is not "a file that does not exist yet": where a write through it would land is unknown. Say so (false).
        if (err?.code !== 'ENOENT') return false;
        const link = await lstat(cur).catch(() => null);
        if (link?.isSymbolicLink()) return false;
        const up = dirname(cur);
        if (up === cur) return null;
        rest.push(basename(cur));
        cur = up;
      }
    }
    return false;
  }

  async function list_files({ path = '.', depth = 2 } = {}) {
    const start = await inside(path);
    const max = Math.min(Math.max(Number(depth) || 2, 1), 4);
    const lines = [];
    async function walk(dir, level) {
      if (lines.length >= MAX_LIST) return;
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (lines.length >= MAX_LIST) { lines.push('… (more not shown)'); return; }
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
        const abs = join(dir, e.name);
        if (hidden?.(show(abs))) continue; // a path the person's rules do not let Bunny read
        lines.push(`${'  '.repeat(level)}${show(abs)}${e.isDirectory() ? '/' : ''}`);
        if (e.isDirectory() && level + 1 < max) await walk(abs, level + 1);
      }
    }
    await walk(start, 0);
    return lines.join('\n') || '(empty folder)';
  }

  async function read_file({ path, start_line, end_line } = {}) {
    const abs = await inside(path);
    if ((await stat(abs)).isDirectory()) {
      const listing = (await list_files({ path })).split('\n').slice(0, 200).join('\n');
      return `(that is a folder; its contents:)\n${listing}`;
    }
    const kind = documentKind(abs);
    let text;
    if (kind && kind !== 'html') {
      const doc = await readDocument(await readFile(abs), { name: abs });
      const texts = await readTextInPictures(doc.pictures.map((p) => p.data));
      const pictures = doc.pictures.map((p, i) => `[picture ${i + 1}${p.page ? `, page ${p.page}` : ''}: ${texts[i] ? `words in it: ${texts[i]}` : 'no words found in it'}]`);
      text = [`[${doc.label}${doc.pages ? `, ${doc.pages} pages` : ''}]`, doc.note ? `(${doc.note})` : '', doc.text, ...pictures].filter(Boolean).join('\n');
    } else {
      text = decodeText(await readFile(abs));
    }
    if (start_line || end_line) {
      const all = text.split('\n');
      const a = Math.max(1, Number(start_line) || 1);
      const b = Math.min(all.length, Number(end_line) || all.length);
      text = all.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join('\n');
    }
    return text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n… (file truncated)` : text;
  }

  async function search_files({ query, path = '.', regex = false, case_sensitive = false, include, exclude, context = 0, output = 'lines', limit } = {}) {
    const text0 = String(query ?? '');
    if (!text0) throw new Error('search_files needs a query');
    if (text0.length > 500) throw new Error('The search text is longer than 500 characters.');
    const shape = String(output || 'lines').toLowerCase();
    if (!['lines', 'files', 'counts'].includes(shape)) throw new Error('search_files output must be "lines", "files" or "counts"');
    let re;
    try {
      re = new RegExp(regex ? text0 : text0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), case_sensitive ? '' : 'i');
    } catch (err) {
      throw new Error(`The search pattern is not a valid regular expression: ${err.message}`);
    }
    // A pattern the model wrote can backtrack for hours ((a+)+$ over 40 letters). A literal cannot, so only a regex runs in a
    // separate context with a time limit; the limit stops the match mid-way.
    let hitsOf = (lines) => { const at = []; for (let i = 0; i < lines.length; i += 1) if (re.test(lines[i])) at.push(i); return at; };
    let regexSpent = 0;
    if (regex) {
      const sandbox = createContext({ lines: [], at: [] });
      const script = new Script(`(() => { const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)}); const at = []; for (let i = 0; i < lines.length; i += 1) if (re.test(lines[i])) at.push(i); return at; })()`);
      hitsOf = (lines) => {
        if (regexSpent >= REGEX_BUDGET_MS) throw new Error('Search stopped after 5 s; narrow the folder or the pattern.');
        sandbox.lines = lines;
        const began = clock();
        try { return [...script.runInContext(sandbox, { timeout: Math.max(50, Math.min(REGEX_TIMEOUT_MS, REGEX_BUDGET_MS - regexSpent)) })]; } catch (err) {
          if (err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error('That pattern is too slow; simplify it.');
          throw err;
        } finally { regexSpent += Math.max(0, clock() - began); }
      };
    }
    const around = Math.min(Math.max(Number(context) || 0, 0), 10);
    const max = Math.min(Math.max(Number(limit) || MAX_MATCHES, 1), 1000);
    const start = await inside(path);
    const wanted = globMatcher(include);
    const unwanted = exclude ? globMatcher(exclude) : () => false;
    const out = [];
    let found = 0;       // result rows counted against the limit
    let cut = false;
    let filesSeen = 0;
    const isFile = (rel) => wanted(rel) && !unwanted(rel);

    // Files are read a few at a time (the disk, not the CPU, is the wait), then judged in order so the output stays stable.
    async function load(abs) {
      try {
        const buf = await readFile(abs);
        if (buf.length > 1_000_000 || buf.subarray(0, 8192).includes(0)) return null; // too big, or binary
        return buf.toString('utf8').split('\n');
      } catch { return null; }
    }

    function scan(abs, lines) {
      const rel = show(abs);
      if (!lines) return;
      filesSeen += 1;
      // A very long line (minified code) is judged by its first 2,000 characters.
      const hitAt = hitsOf(lines.map((l) => (l.length > 2000 ? l.slice(0, 2000) : l)));
      if (!hitAt.length) return;
      if (shape !== 'lines') {
        if (found >= max) { cut = true; return; }
        out.push(shape === 'files' ? rel : `${rel}: ${hitAt.length}`);
        found += 1;
        return;
      }
      const shown = new Set();
      const keep = [];
      for (const i of hitAt) {
        if (found >= max) { cut = true; break; }
        found += 1;
        for (let j = Math.max(0, i - around); j <= Math.min(lines.length - 1, i + around); j += 1) {
          if (!shown.has(j)) { shown.add(j); keep.push(j); }
        }
      }
      keep.sort((a, b) => a - b);
      const hitSet = new Set(hitAt);
      let prev = -2;
      for (const j of keep) {
        if (around && prev >= 0 && j > prev + 1) out.push('--');
        out.push(`${rel}${hitSet.has(j) ? ':' : '-'}${j + 1}${hitSet.has(j) ? ':' : '-'} ${lines[j].replace(/\r$/, '').trim().slice(0, 200)}`);
        prev = j;
      }
      if (around) out.push('--');
    }

    const candidates = [];
    async function walk(dir) {
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const abs = join(dir, e.name);
        if (hidden?.(show(abs))) continue;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(abs); continue; }
        if (e.isFile() && isFile(show(abs))) candidates.push(abs);
      }
    }

    const info = await stat(start);
    if (info.isFile()) candidates.push(start); else await walk(start);
    for (let i = 0; i < candidates.length && !cut; i += 48) {
      const batch = candidates.slice(i, i + 48);
      const loaded = await Promise.all(batch.map(load));
      for (let k = 0; k < batch.length && !cut; k += 1) {
        scan(batch[k], loaded[k]);
        if (regex) await new Promise((r) => setImmediate(r)); // the event loop keeps ticking between files
      }
    }
    while (out.length && out[out.length - 1] === '--') out.pop();
    if (!out.length) return `No matches in ${filesSeen} file${filesSeen === 1 ? '' : 's'} searched.`;
    if (cut) out.push(`… (stopped at the limit of ${max} ${shape === 'lines' ? 'matches' : 'files'}; narrow the search with path or include, or raise limit)`);
    return out.join('\n');
  }

  async function find_files({ pattern, path = '.', limit } = {}) {
    const text = String(pattern ?? '').trim();
    if (!text) throw new Error('find_files needs a pattern');
    const matches = globMatcher(text);
    const max = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    const start = await inside(path);
    const found = [];
    let seen = 0;
    async function walk(dir) {
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = join(dir, e.name);
        if (hidden?.(show(abs))) continue;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(abs); continue; }
        if (!e.isFile() || !matches(relative(start, abs).split(sep).join('/'))) continue;
        seen += 1;
        found.push(abs);
      }
    }
    await walk(start);
    if (!found.length) return `No files match ${text}.`;
    // Newest first: what changed last is usually what is wanted. A file that vanished meanwhile sorts last.
    const dated = await Promise.all(found.map(async (abs) => ({ abs, at: await stat(abs).then((s) => s.mtimeMs, () => 0) })));
    dated.sort((a, b) => b.at - a.at || a.abs.localeCompare(b.abs));
    const lines = dated.slice(0, max).map((f) => show(f.abs));
    if (seen > max) lines.push(`… (${seen - max} more not shown; narrow the pattern or raise limit)`);
    return lines.join('\n');
  }

  async function write_file({ path, content = '' } = {}) {
    const abs = await insideEdit(path, { mustExist: false });
    await beforeWrite?.(abs);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, String(content), 'utf8');
    return `Wrote ${show(abs)} (${String(content).split('\n').length} lines)`;
  }

  async function download_file({ url, path } = {}) {
    if (!String(path ?? '').trim()) throw new Error('download_file needs a path to save to');
    const abs = await insideEdit(path, { mustExist: false });
    const got = await fetchLimited(url, { signal: typeof signal === 'function' ? signal() : signal, allowLoopback });
    await beforeWrite?.(abs);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, got.bytes);
    return `Downloaded to ${show(abs)}\nSize: ${got.bytes.length} bytes\nContent type: ${got.type}\nFinal URL: ${got.url}`;
  }

  // One replacement on text already in memory. Plain split/join, so "$&" and friends in new_text stay literal.
  function replaceIn(text, { old_text, new_text, replace_all = false }, path, label = 'old_text') {
    const old = String(old_text ?? '');
    if (!old) throw new Error(`${label === 'old_text' ? 'edit_file' : label} needs old_text`);
    const count = text.split(old).length - 1;
    if (count === 0) throw new Error(`${label} was not found in ${path}`);
    if (count > 1 && !replace_all) throw new Error(`${label} appears ${count} times in ${path}; include more surrounding lines, or set replace_all`);
    const grown = text.length + count * (String(new_text ?? '').length - old.length);
    if (grown > MAX_EDIT_BYTES) throw new Error(`That edit would make ${path} about ${Math.round(grown / 1e6)} MB, past the ${MAX_EDIT_BYTES / 1e6} MB limit. Nothing was changed.`);
    return { text: text.split(old).join(String(new_text ?? '')), count };
  }

  async function edit_file({ path, old_text, new_text, replace_all = false } = {}) {
    const abs = await insideEdit(path);
    const text = await readFile(abs, 'utf8');
    const done = replaceIn(text, { old_text, new_text, replace_all: replace_all === true }, path);
    await beforeWrite?.(abs);
    await writeFile(abs, done.text, 'utf8');
    return `Edited ${show(abs)}${done.count > 1 ? ` (${done.count} replacements)` : ''}`;
  }

  async function multi_edit({ path, edits } = {}) {
    if (!Array.isArray(edits) || !edits.length) throw new Error('multi_edit needs a list of edits');
    if (edits.length > 50) throw new Error('multi_edit takes at most 50 edits at a time; split it up');
    const abs = await insideEdit(path);
    let text = await readFile(abs, 'utf8');
    let total = 0;
    for (let i = 0; i < edits.length; i += 1) {
      try {
        const done = replaceIn(text, { ...edits[i], replace_all: edits[i]?.replace_all === true }, path, `edit ${i + 1}'s old_text`);
        text = done.text;
        total += done.count;
      } catch (err) {
        throw new Error(`${err.message}. Nothing was changed: no edit was applied.`);
      }
    }
    await beforeWrite?.(abs); // once, so one Undo restores the file
    await writeFile(abs, text, 'utf8');
    return `Edited ${show(abs)} (${edits.length} edits, ${total} replacements)`;
  }

  async function run_command({ command, cwd, timeout_seconds } = {}, { onProgress = null } = {}) {
    // W6-17: the model may ask for longer than the 2 minute default, up to 10 minutes.
    const limitMs = Math.round(Math.min(MAX_COMMAND_SECONDS, Math.max(1, Number(timeout_seconds) || COMMAND_TIMEOUT_MS / 1000)) * 1000);
    if (endsInBackground(String(command ?? ''))) {
      throw new Error('run_command waits for the command to finish, so a trailing & cannot start a background program here (Windows PowerShell 5.1 rejects it). '
        + 'Use start_process for a server or watcher that should keep running, then browser_open the address once it is up.');
    }
    const cmd = translateChains(String(command ?? '').trim());
    if (!cmd) throw new Error('run_command needs a command');
    const where = cwd ? await inside(cwd) : root;
    return new Promise((done) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${POWERSHELL_PRELUDE}\n${cmd}`],
        { cwd: where, windowsHide: true, env: { ...process.env, ...NON_INTERACTIVE } });
      const outBufs = [];
      const errBufs = [];
      let size = 0;
      const keep = (into) => (d) => { if (size < 8 << 20) { into.push(d); size += d.length; } };
      child.stdout.on('data', keep(outBufs));
      child.stderr.on('data', keep(errBufs));
      // A timeout or Stop ends the whole tree: npm, node and anything they started, not just PowerShell.
      let killedFor = null;
      const killTree = (why) => {
        if (killedFor || finished) return;
        killedFor = why;
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      };
      const timer = setTimeout(() => killTree('timeout'), limitMs);
      // A visible countdown: the step line shows how long it has run and how long it may.
      const startedAt = Date.now();
      const tick = onProgress && limitMs > 10_000 ? setInterval(() => onProgress(`Running… ${Math.round((Date.now() - startedAt) / 1000)} s of up to ${Math.round(limitMs / 1000)} s`), 5000) : null;
      const sig = typeof signal === 'function' ? signal() : signal;
      const onAbort = () => killTree('stopped');
      sig?.addEventListener?.('abort', onAbort, { once: true });
      let finished = false;
      const finish = (code, spawnErr) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (tick) clearInterval(tick);
        sig?.removeEventListener?.('abort', onAbort);
        const stdout = decodeText(Buffer.concat(outBufs)).trim();
        const stderr = decodeText(Buffer.concat(errBufs)).trim();
        const body = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim();
        let status = '';
        if (spawnErr) status = `[could not start: ${spawnErr.message}]`;
        else if (killedFor === 'timeout') status = `[stopped after ${limitMs >= 120_000 && limitMs % 60_000 === 0 ? `${limitMs / 60_000} minutes` : `${Math.round(limitMs / 1000)} seconds`}: it may be waiting for input, or it keeps running. Give it more time with timeout_seconds (up to ${MAX_COMMAND_SECONDS}), use start_process for a program that keeps running, and non-interactive flags such as --yes]`;
        else if (killedFor === 'stopped') status = '[stopped by the person]';
        else if (code) {
          status = `[exit code ${code}]`;
          // A failure that printed nothing usually sent its message to a file with > .
          if (!body) {
            status += /[^2]>\s*\S/.test(cmd)
              ? ' It printed nothing here because its output went to the file after >: read that file to see the error.'
              : ' It printed nothing: run it again without redirecting its output to see why.';
          }
        }
        // The status comes first, so it survives even when long output is cut.
        const out = [status, clip(body, KEEP_OUTPUT)].filter(Boolean).join('\n');
        done(out || '(no output)');
      };
      child.on('error', (err) => finish(null, err));
      // Programs it started may keep the output open after it ends; do not wait for them.
      child.on('exit', (code) => setTimeout(() => finish(code), 200));
      if (sig?.aborted) onAbort();
      // Nobody can type into it: a command that waits for input ends instead of hanging.
      child.stdin?.end();
    });
  }

  async function check_environment({ path } = {}) {
    return checkEnvironment({ folder: await inside(path || '.'), root, run: envRunner });
  }

  // read_url on a file:// address: read-only, only a real path inside this folder (links out are refused by inside()).
  /** The path a file: address names, or null when it is not a valid one (for the person's read rules). */
  function fileUrlPath(url) {
    try { return fileURLToPath(String(url)); } catch { return null; }
  }

  async function readFileUrl(url) {
    let path;
    try { path = fileURLToPath(String(url)); } catch { throw new Error('That file address is not valid.'); }
    const abs = await inside(path).catch(() => { throw new Error('read_url can only read files inside the workspace folder.'); });
    return read_file({ path: abs });
  }

  const tools = { list_files, read_file, search_files, find_files, check_environment, write_file, download_file, edit_file, multi_edit, run_command };
  return {
    root,
    has: (name) => Object.hasOwn(tools, name),
    // A folder inside the workspace (checked), for programs started there.
    folder: (path) => inside(path),
    readFileUrl,
    fileUrlPath,
    canon,
    run: (name, args, ctx) => tools[name](args ?? {}, ctx ?? {}),
  };
}

/**
 * Is the server answering on the port this folder's own? Q2-21: another project's site on the same port
 * must not show as "running". Own = the page names the package or the folder.
 */
async function probeDevServer(folder, pkg, port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    if (!(res.status > 0)) return { running: false };
    const body = (await res.text().catch(() => '')).slice(0, 200_000).toLowerCase();
    const names = [pkg.name, basename(String(folder).replace(/[\/]+$/, ''))].filter((n) => typeof n === 'string' && n.length >= 2).map((n) => n.toLowerCase().replace(/^@[^/]+\//, ''));
    const own = names.some((n) => body.includes(n));
    return own ? { running: true } : { running: false, otherSite: true };
  } catch { return { running: false }; }
}

/**
 * The dev server a folder would run, read from its package.json:
 * the first of dev / start / serve / preview, and the port it is likely to use.
 */
export async function detectDevServer(folder) {
  let pkg;
  try { pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')); } catch { return null; }
  const scripts = pkg.scripts ?? {};
  const name = ['dev', 'start', 'serve', 'preview'].find((n) => typeof scripts[n] === 'string');
  if (!name) return null;
  const script = scripts[name];
  const explicit = /(?:--port[ =]|-p\s+|PORT=)(\d{2,5})/.exec(script)?.[1];
  const guess = /\bvite\b/.test(script) ? 5173
    : /\bastro\b/.test(script) ? 4321
      : /webpack(-dev-server| serve)/.test(script) ? 8080
        : /\bng serve\b/.test(script) ? 4200
          : 3000;
  const port = Number(explicit ?? guess);
  const { running, otherSite } = await probeDevServer(folder, pkg, port);
  return { command: name === 'start' ? 'npm start' : `npm run ${name}`, script, port, running, ...(otherSite ? { otherSite: true } : {}) };
}
