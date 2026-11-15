/**
 * Workspace tools: what the model may do inside the folder a chat works in.
 *
 * Every path is resolved against the chosen folder and refused if it leaves it
 * (including through "..", an absolute path, or a symlink that points outside).
 * Tools are split by risk so the permission mode can decide what runs freely:
 *   read  - list_files, read_file, search_files
 *   edit  - write_file, edit_file
 *   run   - run_command
 */
import { exec, execFile, spawn } from 'node:child_process';
import { clip } from './clip.js';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { documentKind, readDocument } from './documents.js';
import { readTextInPictures } from './ocr.js';

const MAX_READ = 200_000;          // characters returned from one read
const MAX_OUTPUT = 8_000;          // characters of command output kept
const MAX_LIST = 400;              // entries in one listing
const MAX_MATCHES = 80;            // search hits
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'out', 'coverage', '__pycache__', '.venv']);
const COMMAND_TIMEOUT_MS = 120_000;
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

export const TOOL_RISK = {
  list_files: 'read', read_file: 'read', search_files: 'read',
  write_file: 'edit', edit_file: 'edit',
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
    fn('search_files', 'Search file contents in the workspace for a plain-text string (case-insensitive). Returns path:line: text.',
      { query: { type: 'string' }, path: { type: 'string', description: 'Folder to search, default "."' } }, ['query']),
    fn('write_file', 'Create or overwrite a whole text file in the workspace.',
      { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    fn('edit_file', 'Replace one exact snippet in a file. old_text must appear exactly once.',
      { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, ['path', 'old_text', 'new_text']),
    fn('run_command', 'Run a command yourself and get its output (2 minute limit). It runs in Windows PowerShell 5.1: '
      + 'set variables with $env:NAME = "value", and separate commands with ; (&& and || are translated for you). '
      + 'Each call starts fresh in the workspace folder: cd does not carry over, so pass cwd to run somewhere else.',
      { command: { type: 'string' }, cwd: { type: 'string', description: 'Folder inside the workspace to run in, e.g. "rea". Default: the workspace folder' } }, ['command']),
  ];
  return all.filter((d) => risks.includes(TOOL_RISK[d.function.name]));
}

/** A short, human line for the transcript: "Read src/app.js". */
export function describeToolCall(name, args = {}) {
  switch (name) {
    case 'list_files': return `List ${args.path || '.'}`;
    case 'read_file': return `Read ${args.path}`;
    case 'search_files': return `Search "${String(args.query ?? '').slice(0, 60)}"`;
    case 'write_file': return `Write ${args.path}`;
    case 'edit_file': return `Edit ${args.path}`;
    case 'run_command': return `Run ${String(args.command ?? '').slice(0, 120)}`;
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
export function createWorkspace(rootFolder, { beforeWrite = null, signal = null } = {}) {
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
        lines.push(`${'  '.repeat(level)}${show(abs)}${e.isDirectory() ? '/' : ''}`);
        if (e.isDirectory() && level + 1 < max) await walk(abs, level + 1);
      }
    }
    await walk(start, 0);
    return lines.join('\n') || '(empty folder)';
  }

  async function read_file({ path, start_line, end_line } = {}) {
    const abs = await inside(path);
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

  async function search_files({ query, path = '.' } = {}) {
    const needle = String(query ?? '').toLowerCase();
    if (!needle) throw new Error('search_files needs a query');
    const start = await inside(path);
    const hits = [];
    async function walk(dir) {
      if (hits.length >= MAX_MATCHES) return;
      let entries = [];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (hits.length >= MAX_MATCHES) return;
        const abs = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(abs); continue; }
        let text;
        try {
          const info = await stat(abs);
          if (info.size > 1_000_000) continue;
          text = await readFile(abs, 'utf8');
        } catch { continue; }
        if (text.includes('\u0000')) continue; // binary
        text.split('\n').forEach((line, i) => {
          if (hits.length < MAX_MATCHES && line.toLowerCase().includes(needle)) hits.push(`${show(abs)}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
    }
    await walk(start);
    return hits.join('\n') || 'No matches.';
  }

  async function write_file({ path, content = '' } = {}) {
    const abs = await inside(path, { mustExist: false });
    await beforeWrite?.(abs);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, String(content), 'utf8');
    return `Wrote ${show(abs)} (${String(content).split('\n').length} lines)`;
  }

  async function edit_file({ path, old_text, new_text } = {}) {
    const abs = await inside(path);
    const text = await readFile(abs, 'utf8');
    const old = String(old_text ?? '');
    if (!old) throw new Error('edit_file needs old_text');
    const count = text.split(old).length - 1;
    if (count === 0) throw new Error(`old_text was not found in ${path}`);
    if (count > 1) throw new Error(`old_text appears ${count} times in ${path}; include more surrounding lines`);
    await beforeWrite?.(abs);
    await writeFile(abs, text.replace(old, String(new_text ?? '')), 'utf8');
    return `Edited ${show(abs)}`;
  }

  async function run_command({ command, cwd } = {}) {
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
      const timer = setTimeout(() => killTree('timeout'), COMMAND_TIMEOUT_MS);
      const sig = typeof signal === 'function' ? signal() : signal;
      const onAbort = () => killTree('stopped');
      sig?.addEventListener?.('abort', onAbort, { once: true });
      let finished = false;
      const finish = (code, spawnErr) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        sig?.removeEventListener?.('abort', onAbort);
        const stdout = decodeText(Buffer.concat(outBufs)).trim();
        const stderr = decodeText(Buffer.concat(errBufs)).trim();
        const body = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim();
        let status = '';
        if (spawnErr) status = `[could not start: ${spawnErr.message}]`;
        else if (killedFor === 'timeout') status = '[stopped after 2 minutes: it may be waiting for input, or it keeps running. Use start_process for a program that keeps running, and non-interactive flags such as --yes]';
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
        const out = [status, clip(body, MAX_OUTPUT)].filter(Boolean).join('\n');
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

  const tools = { list_files, read_file, search_files, write_file, edit_file, run_command };
  return {
    root,
    has: (name) => Object.hasOwn(tools, name),
    // A folder inside the workspace (checked), for programs started there.
    folder: (path) => inside(path),
    run: (name, args) => tools[name](args ?? {}),
  };
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
  let running = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    running = res.status > 0;
  } catch { running = false; }
  return { command: name === 'start' ? 'npm start' : `npm run ${name}`, script, port, running };
}
