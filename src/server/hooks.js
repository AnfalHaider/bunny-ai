/**
 * Hooks: a command that runs when something happens.
 *
 * A hook is a name, an event and a command line. It runs when a message is
 * sent, when a chat is created, or when a reply finishes. The output is kept
 * so a person can see what happened.
 *
 * Hooks run commands, so they are off by default and have to be turned on
 * deliberately, one at a time.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const EVENTS = ['message.sent', 'chat.created', 'reply.finished'];

export function createHookStore({ file }) {
  let hooks = [];
  let loaded = false;

  async function load() {
    if (loaded) return hooks;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) hooks = parsed;
    } catch {
      hooks = [];
    }
    loaded = true;
    return hooks;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(hooks, null, 2), 'utf8');
  }

  async function list() {
    await load();
    return [...hooks].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function add({ name, event, command, enabled = false }) {
    await load();
    const cleanName = String(name ?? '').trim();
    const cleanCommand = String(command ?? '').trim();
    if (!cleanName) throw Object.assign(new Error('A hook needs a name'), { code: 'hook.nameRequired' });
    if (!cleanCommand) throw Object.assign(new Error('A hook needs a command'), { code: 'hook.commandRequired' });
    if (!EVENTS.includes(event)) {
      throw Object.assign(new Error(`Unknown event: ${event}`, 'mcp.unknownEvent'), { code: 'hook.unknownEvent' });
    }
    const hook = {
      id: randomUUID(),
      name: cleanName.slice(0, 80),
      event,
      command: cleanCommand.slice(0, 1000),
      enabled: Boolean(enabled),
      lastRun: null,
      lastOutput: null,
      createdAt: new Date().toISOString(),
    };
    hooks.push(hook);
    await persist();
    return hook;
  }

  async function update(id, patch) {
    await load();
    const hook = hooks.find((h) => h.id === id);
    if (!hook) throw Object.assign(new Error('No such hook'), { code: 'hook.notFound' });
    if (patch.name !== undefined) hook.name = String(patch.name).trim().slice(0, 80) || hook.name;
    if (patch.command !== undefined) hook.command = String(patch.command).trim().slice(0, 1000) || hook.command;
    if (patch.event !== undefined) {
      if (!EVENTS.includes(patch.event)) {
        throw Object.assign(new Error(`Unknown event: ${patch.event}`), { code: 'hook.unknownEvent' });
      }
      hook.event = patch.event;
    }
    if (patch.enabled !== undefined) hook.enabled = Boolean(patch.enabled);
    await persist();
    return hook;
  }

  async function remove(id) {
    await load();
    const before = hooks.length;
    hooks = hooks.filter((h) => h.id !== id);
    await persist();
    return hooks.length !== before;
  }

  /** The hooks waiting for an event. */
  async function forEvent(event) {
    await load();
    return hooks.filter((h) => h.enabled && h.event === event);
  }

  async function markRun(id, output) {
    await load();
    const hook = hooks.find((h) => h.id === id);
    if (!hook) return null;
    hook.lastRun = new Date().toISOString();
    hook.lastOutput = String(output ?? '').slice(0, 2000);
    await persist();
    return hook;
  }

  return { list, add, update, remove, forEvent, markRun };
}
