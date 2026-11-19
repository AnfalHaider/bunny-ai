/**
 * CLI-ENGINES §3.1: the bridge. It decides every action an engine wants to take with the SAME functions Bunny's own engine uses, in the same order:
 *
 *   1. Plan mode refuses edits and commands.
 *   2. The person's deny rules (checkToolCall: commands and paths, paths canonicalised against the workspace).
 *   3. Protected places: the data folder, every engine home and the key folders are always refused; a write outside the workspace is refused;
 *      a read outside it is an Ask in EVERY mode, Auto included (CE-1.6).
 *   4. Ask rules, then the mode (needsOk): an Ask reaches the person through `ctx.ask`, and no answer means no.
 *   5. Allow rules, then allow.
 *
 * An unknown tool (an MCP tool, a subagent tool, a tool a new version added) is judged as a command (`run`). A call whose input cannot be read is refused.
 * Nothing is cached: every call is judged afresh, and a CLI's "allow always" is never used (CE-1.5). The bridge never throws: any trouble is a refusal with a reason.
 *
 * What the bridge needs (`ctx`), all injected so the whole table can be tested without a server:
 *   mode            'ask' | 'accept' | 'auto' | 'plan'
 *   rules           the permission rules for this folder (permissionRules.rulesFor)
 *   root            the workspace folder
 *   protect         absolute paths always refused (the data folder; engine homes are under it)
 *   keyFolders      absolute paths always refused when they lie outside the workspace (the person's ~\.ssh, ~\.claude, %APPDATA% ...)
 *   ask(summary, detail) -> Promise<boolean>
 *   canon(path) -> optional: the workspace's own canon(); when missing the bridge canonicalises itself
 */
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { checkToolCall, describeRule } from '../permissionRules.js';

export const RISK = Object.freeze({ read_file: 'read', find_files: 'read', search_files: 'read', write_file: 'edit', edit_file: 'edit', run_command: 'run' });
const lower = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const within = (path, base) => path === base || path.startsWith(`${base}/`);

/** The key folders of the person (CE-1.6): never readable by an engine, whatever the mode. `home` is the person's home folder; the Windows ones come from the environment. */
export function keyFolders({ home, appData = process.env.APPDATA, localAppData = process.env.LOCALAPPDATA } = {}) {
  const out = [];
  if (home) for (const name of ['.claude', '.codex', '.cline', '.aider', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', join('.config', 'gh')]) out.push(join(home, name));
  if (appData) out.push(appData);
  if (localAppData) out.push(localAppData);
  return out;
}

// ---------------------------------------------------------------- mapping an engine's tool onto Bunny's step names

const CLAUDE_TOOLS = {
  Read: ['read_file', (i) => i.file_path ?? i.path], NotebookRead: ['read_file', (i) => i.notebook_path ?? i.file_path],
  Write: ['write_file', (i) => i.file_path ?? i.path], Edit: ['edit_file', (i) => i.file_path ?? i.path], MultiEdit: ['edit_file', (i) => i.file_path ?? i.path], NotebookEdit: ['edit_file', (i) => i.notebook_path ?? i.file_path],
  Glob: ['find_files', (i) => i.path ?? '.'], Grep: ['search_files', (i) => i.path ?? '.'], LS: ['find_files', (i) => i.path ?? '.'],
  Bash: ['run_command', null], PowerShell: ['run_command', null],
};

/** What Claude Code's tool call is, in Bunny's words: { name, path?, command?, unknown?, engineTool } or { bad: why }. */
export function mapClaudeCall(tool, input) {
  const engineTool = String(tool ?? '');
  const i = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const row = CLAUDE_TOOLS[engineTool];
  if (!row) return { name: 'run_command', unknown: true, engineTool }; // MCP, Agent, WebFetch, a new tool: judged as a command
  if (!i) return { bad: 'The request could not be read.', engineTool };
  if (row[0] === 'run_command') {
    if (typeof i.command !== 'string' || !i.command.trim()) return { bad: 'The command could not be read.', engineTool };
    return { name: 'run_command', command: i.command, engineTool };
  }
  const path = row[1](i);
  if (typeof path !== 'string' || !path.trim()) return { bad: 'The path could not be read.', engineTool };
  return { name: row[0], path, engineTool };
}

/** A Codex command approval: judged as run_command on its text. */
export function mapCodexCommand(params) {
  const command = params && typeof params === 'object' ? params.command : null;
  if (typeof command !== 'string' || !command.trim()) return { bad: 'The command could not be read.', engineTool: 'commandExecution' };
  return { name: 'run_command', command, engineTool: 'commandExecution' };
}

/** A Codex file change: one entry per path (an add or a delete is a write; an update or a move is an edit; a move names both paths). */
export function mapCodexChanges(changes) {
  if (!Array.isArray(changes) || !changes.length) return [{ bad: 'The file change could not be read.', engineTool: 'fileChange' }];
  const out = [];
  for (const c of changes) {
    const kind = c?.kind?.type ?? c?.kind;
    if (typeof c?.path !== 'string' || !c.path.trim() || !['add', 'delete', 'update'].includes(kind)) { out.push({ bad: 'The file change could not be read.', engineTool: 'fileChange' }); continue; }
    out.push({ name: kind === 'update' ? 'edit_file' : 'write_file', path: c.path, engineTool: 'fileChange' });
    const to = c?.kind?.move_path;
    if (kind === 'update' && typeof to === 'string' && to) out.push({ name: 'write_file', path: to, engineTool: 'fileChange' });
  }
  return out;
}

// ---------------------------------------------------------------- the paths

/** The real path of something that may not exist yet: the nearest existing parent made real, the rest put back. Short names (8.3), links and junctions resolve. */
export async function realPath(abs) {
  const rest = [];
  let cur = abs;
  for (let guard = 0; guard < 128; guard += 1) {
    try { return join(await realpath(cur), ...rest.reverse()); } catch (err) {
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') return null;
      const up = dirname(cur);
      if (up === cur) return null;
      rest.push(basename(cur)); cur = up;
    }
  }
  return null;
}

/** Where a path lies: { abs, real, inside, rel } with rel relative to the workspace root (forward slashes), or { unresolved: true }. */
export async function placeOf(path, root) {
  if (typeof path !== 'string' || path.includes('\0')) return { unresolved: true };
  const abs = resolve(root, path);
  const real = await realPath(abs);
  const realRoot = await realPath(resolve(root));
  if (!real || !realRoot) return { unresolved: true, abs };
  const rel = relative(realRoot, real);
  const inside = !(rel.startsWith('..') || isAbsolute(rel));
  return { abs, real, inside, rel: inside ? (rel.split(sep).join('/') || '.') : null };
}

// ---------------------------------------------------------------- the bridge

const planNote = (what) => `Plan mode is read-only, so ${what} was not run. Propose what you would do and let the person switch mode.`;

const short = (t, n = 160) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

export function createBridge(ctx) {
  const protect = [...new Set((ctx.protect ?? []).filter(Boolean).flatMap((p) => [lower(resolve(p))]))];
  const keys = [...new Set((ctx.keyFolders ?? []).filter(Boolean).map((p) => lower(resolve(p))))];
  const rules = () => (typeof ctx.rules === 'function' ? ctx.rules() : ctx.rules) ?? [];
  const mode = () => (typeof ctx.mode === 'function' ? ctx.mode() : ctx.mode) ?? 'ask';

  const needsOk = (risk) => (mode() === 'ask' && (risk === 'edit' || risk === 'run')) || (mode() === 'accept' && risk === 'run');

  async function asked(summary, detail) {
    try { return (await ctx.ask(summary, detail)) === true; } catch { return false; }
  }

  /** Judge one mapped call. Returns { allow, reason, name, risk, summary, asked }. Never throws. */
  async function judge(call) {
    try {
      if (call.bad) return { allow: false, reason: call.bad, name: 'unknown', risk: 'run', summary: call.engineTool };
      const name = call.name;
      const risk = RISK[name] ?? 'run';
      // 1. Plan mode
      if (mode() === 'plan' && (risk === 'edit' || risk === 'run')) {
        const what = call.command ? `the command` : call.path ? `${name} on ${short(call.path, 80)}` : `${call.engineTool}`;
        return { allow: false, reason: planNote(what), name, risk, summary: summaryOf(call) };
      }
      const summary = summaryOf(call);
      // commands (and unknown tools)
      if (name === 'run_command') {
        if (call.command !== undefined) {
          const lowText = String(call.command).replace(/[`'"^]/g, '').replace(/\\/g, '/').toLowerCase();
          if (protect.some((p) => lowText.includes(p))) return { allow: false, reason: 'That command names a folder Bunny keeps private.', name, risk, summary };
          const ruled = checkToolCall(rules(), 'run_command', { command: call.command });
          if (ruled?.effect === 'deny') return { allow: false, reason: `Blocked by your permission rule ${describeRule(ruled)}.`, name, risk, summary };
          if (ruled?.effect === 'ask' || (needsOk(risk) && !(ruled?.effect === 'allow'))) {
            const ok = await asked(summary, ruled?.effect === 'ask' ? `${call.command}\n\nAsked because of your rule ${describeRule(ruled)}.` : call.command);
            return ok ? { allow: true, reason: 'Allowed by the person.', name, risk, summary, asked: true } : { allow: false, reason: 'The person did not allow this.', name, risk, summary, asked: true };
          }
          return { allow: true, reason: 'Allowed.', name, risk, summary };
        }
        // an unknown tool: judged as a command with no text; no rule can read it, so only the mode speaks
        if (needsOk(risk)) {
          const ok = await asked(summary, `The engine wants to use "${call.engineTool}". Bunny cannot read what it will do, so it asks as it would for a command.`);
          return ok ? { allow: true, reason: 'Allowed by the person.', name, risk, summary, asked: true } : { allow: false, reason: 'The person did not allow this.', name, risk, summary, asked: true };
        }
        return { allow: true, reason: 'Allowed.', name, risk, summary };
      }
      // paths
      const place = await placeOf(call.path, ctx.root);
      if (place.unresolved) return { allow: false, reason: 'Where that path leads could not be worked out.', name, risk, summary };
      const real = lower(place.real);
      if (protect.some((p) => within(real, p) || within(lower(place.abs), p))) return { allow: false, reason: 'That is a folder Bunny keeps private.', name, risk, summary };
      if (!place.inside && keys.some((k) => within(real, k) || within(lower(place.abs), k))) return { allow: false, reason: 'That is one of your private folders (keys, sign-ins or app data): an engine never reaches it.', name, risk, summary };
      if (!place.inside) {
        if (risk === 'edit') return { allow: false, reason: 'An engine cannot change a file outside the workspace folder.', name, risk, summary };
        // a read outside the folder: an Ask in every mode, Auto included
        const ok = await asked(summary, `The engine wants to read a path outside the workspace folder:\n${place.real}`);
        return ok ? { allow: true, reason: 'Allowed by the person.', name, risk, summary, asked: true } : { allow: false, reason: 'The person did not allow this.', name, risk, summary, asked: true };
      }
      const ruled = checkToolCall(rules(), name, { path: place.rel }, place.rel);
      if (ruled?.effect === 'deny') return { allow: false, reason: `Blocked by your permission rule ${describeRule(ruled)}.`, name, risk, summary };
      if (ruled?.effect === 'ask' || (needsOk(risk) && !(ruled?.effect === 'allow'))) {
        const ok = await asked(summary, ruled?.effect === 'ask' ? `${place.rel}\n\nAsked because of your rule ${describeRule(ruled)}.` : place.rel);
        return ok ? { allow: true, reason: 'Allowed by the person.', name, risk, summary, asked: true } : { allow: false, reason: 'The person did not allow this.', name, risk, summary, asked: true };
      }
      return { allow: true, reason: 'Allowed.', name, risk, summary };
    } catch (err) {
      return { allow: false, reason: `Bunny could not judge this call (${short(err?.message, 80)}), so it was refused.`, name: call?.name ?? 'unknown', risk: 'run', summary: call?.engineTool ?? '' };
    }
  }

  const summaryOf = (call) => (call.command !== undefined ? `Run: ${short(call.command, 120)}` : call.path ? `${call.name === 'read_file' ? 'Read' : call.name === 'write_file' ? 'Write' : call.name === 'edit_file' ? 'Edit' : call.name === 'find_files' ? 'List' : 'Search'} ${short(call.path, 120)}` : `Engine tool: ${short(call.engineTool, 80)}`);

  return {
    judge,
    /** A Claude Code hook request: { tool, input } -> judge. */
    async claude({ tool, input }) { return judge(mapClaudeCall(tool, input)); },
    /** A Codex command approval. */
    async codexCommand(params) { return judge(mapCodexCommand(params)); },
    /** A Codex file change: every path must be allowed; the first refusal stops it. */
    async codexChanges(changes) {
      const calls = mapCodexChanges(changes);
      let last = null;
      for (const c of calls) { last = await judge(c); if (!last.allow) return last; }
      return last ?? { allow: false, reason: 'The file change could not be read.', name: 'unknown', risk: 'edit', summary: 'fileChange' };
    },
  };
}
