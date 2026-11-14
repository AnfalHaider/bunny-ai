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
import { exec } from 'node:child_process';
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
    fn('run_command', 'Run a PowerShell command in the workspace folder and return its output (2 minute limit).',
      { command: { type: 'string' } }, ['command']),
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

export function createWorkspace(rootFolder) {
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
      text = await readFile(abs, 'utf8');
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
    await writeFile(abs, text.replace(old, String(new_text ?? '')), 'utf8');
    return `Edited ${show(abs)}`;
  }

  function run_command({ command } = {}) {
    const cmd = String(command ?? '').trim();
    if (!cmd) throw new Error('run_command needs a command');
    return new Promise((done) => {
      exec(cmd, { cwd: root, shell: 'powershell.exe', timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
        let out = `${stdout ?? ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim();
        if (err && err.killed) out += '\n[stopped after 2 minutes]';
        else if (err) out += `\n[exit code ${err.code ?? 1}]`;
        done(out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT)}\n… (output truncated)` : out || '(no output)');
      });
    });
  }

  const tools = { list_files, read_file, search_files, write_file, edit_file, run_command };
  return {
    root,
    has: (name) => Object.hasOwn(tools, name),
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
