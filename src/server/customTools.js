/**
 * Tools the model builds for itself, with the person's OK.
 *
 * When nothing Bunny AI has can do a job, the model may write a small
 * PowerShell script and describe it as a tool. The person sees the script and
 * approves it before it is saved; after that the model can call it like any
 * other tool (named my_<name>), and each run follows the permission mode as a
 * command would. Off unless switched on in Settings, Capabilities.
 *
 * The script receives its arguments as a JSON object in $env:BUNNY_ARGS and
 * as $params (already parsed). Whatever it prints is the tool's answer.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { powershellPath } from './safeExec.js';

const NAME = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_SCRIPT = 20_000;
const MAX_OUTPUT = 8_000;
const RUN_TIMEOUT_MS = 120_000;
export const CUSTOM_PREFIX = 'my_';

export function createCustomTools({ dir }) {
  async function list() {
    let names = [];
    try { names = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch { return []; }
    const tools = [];
    for (const file of names) {
      try { tools.push(JSON.parse(await readFile(join(dir, file), 'utf8'))); } catch { /* skip a broken file */ }
    }
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Check a proposed tool; returns the clean version or throws with the reason. */
  function check({ name, description, parameters, script }) {
    const clean = String(name ?? '').trim().toLowerCase();
    if (!NAME.test(clean)) throw new Error('The name must be 2 to 40 lowercase letters, digits or _, starting with a letter.');
    const text = String(script ?? '');
    if (!text.trim()) throw new Error('The tool needs a script.');
    if (text.length > MAX_SCRIPT) throw new Error(`The script is longer than ${MAX_SCRIPT} characters.`);
    const params = {};
    if (parameters && typeof parameters === 'object') {
      for (const [key, value] of Object.entries(parameters).slice(0, 12)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
        params[key] = String(typeof value === 'string' ? value : value?.description ?? '').slice(0, 300);
      }
    }
    return { name: clean, description: String(description ?? '').trim().slice(0, 500) || clean, parameters: params, script: text };
  }

  async function save(tool) {
    const clean = check(tool);
    await mkdir(dir, { recursive: true });
    const saved = { ...clean, created: new Date().toISOString() };
    await writeFile(join(dir, `${clean.name}.json`), JSON.stringify(saved, null, 2));
    return saved;
  }

  async function remove(name) {
    if (!NAME.test(String(name))) return;
    await rm(join(dir, `${name}.json`), { force: true });
  }

  async function get(name) {
    if (!NAME.test(String(name))) return null;
    try { return JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')); } catch { return null; }
  }

  /** The tools in the function format the chat layer uses. */
  function definitions(tools) {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: `${CUSTOM_PREFIX}${t.name}`,
        description: `${t.description} (a tool you built)`,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(t.parameters ?? {}).map(([k, d]) => [k, { type: 'string', description: d }])),
          required: [],
        },
      },
    }));
  }

  async function run(name, args, cwd) {
    const tool = await get(name);
    if (!tool) throw new Error(`There is no tool called ${CUSTOM_PREFIX}${name}.`);
    const work = join(tmpdir(), `bunny-tool-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    try {
      const file = join(work, `${tool.name}.ps1`);
      const prelude = '$ErrorActionPreference = "Stop"\n[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$params = $env:BUNNY_ARGS | ConvertFrom-Json\n';
      await writeFile(file, `﻿${prelude}${tool.script}`, 'utf8');
      const output = await new Promise((resolve) => {
        execFile(powershellPath() ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
          { cwd: cwd || work, timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 << 20, env: { ...process.env, BUNNY_ARGS: JSON.stringify(args ?? {}) } },
          (err, stdout, stderr) => {
            const text = `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim();
            resolve(err && !text ? `The tool failed: ${err.message}` : text || '(no output)');
          });
      });
      return output.slice(0, MAX_OUTPUT);
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { list, check, save, remove, get, definitions, run };
}
