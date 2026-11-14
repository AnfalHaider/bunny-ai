/**
 * Scheduled tasks: a prompt that runs on its own, on an interval.
 *
 * The schedule is kept in the profile and run by the server process. Each task
 * names a provider and model, so a task runs on the same footing as a chat the
 * person started by hand.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const MIN_INTERVAL_MINUTES = 1;

export function createScheduleStore({ file }) {
  let schedules = [];
  let loaded = false;

  async function load() {
    if (loaded) return schedules;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed)) schedules = parsed;
    } catch {
      schedules = [];
    }
    loaded = true;
    return schedules;
  }

  async function persist() {
    await writeFile(file, JSON.stringify(schedules, null, 2), 'utf8');
  }

  async function list() {
    await load();
    return [...schedules].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function get(id) {
    await load();
    return schedules.find((s) => s.id === id) ?? null;
  }

  async function add({ name, prompt, everyMinutes = 60, providerId = null, model = null, enabled = true }) {
    await load();
    const cleanName = String(name ?? '').trim();
    const cleanPrompt = String(prompt ?? '').trim();
    if (!cleanName) throw Object.assign(new Error('A schedule needs a name'), { code: 'schedule.nameRequired' });
    if (!cleanPrompt) throw Object.assign(new Error('A schedule needs a prompt'), { code: 'schedule.promptRequired' });
    const every = Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(everyMinutes) || 60));
    const schedule = {
      id: randomUUID(),
      name: cleanName.slice(0, 80),
      prompt: cleanPrompt.slice(0, 4000),
      everyMinutes: every,
      providerId,
      model,
      enabled: Boolean(enabled),
      lastRun: null,
      lastResult: null,
      createdAt: new Date().toISOString(),
    };
    schedules.push(schedule);
    await persist();
    return schedule;
  }

  async function update(id, patch) {
    await load();
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) throw Object.assign(new Error('No such schedule'), { code: 'schedule.notFound' });
    if (patch.name !== undefined) schedule.name = String(patch.name).trim().slice(0, 80) || schedule.name;
    if (patch.prompt !== undefined) schedule.prompt = String(patch.prompt).trim().slice(0, 4000) || schedule.prompt;
    if (patch.everyMinutes !== undefined) {
      schedule.everyMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(patch.everyMinutes) || 60));
    }
    if (patch.providerId !== undefined) schedule.providerId = patch.providerId;
    if (patch.model !== undefined) schedule.model = patch.model;
    if (patch.enabled !== undefined) schedule.enabled = Boolean(patch.enabled);
    await persist();
    return schedule;
  }

  async function remove(id) {
    await load();
    const before = schedules.length;
    schedules = schedules.filter((s) => s.id !== id);
    await persist();
    return schedules.length !== before;
  }

  /** The schedules that are due, and have not run since their last tick. */
  async function due(now = Date.now()) {
    await load();
    return schedules.filter((s) => {
      if (!s.enabled) return false;
      if (!s.lastRun) return true;
      return now - new Date(s.lastRun).getTime() >= s.everyMinutes * 60_000;
    });
  }

  async function markRun(id, result) {
    await load();
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) return null;
    schedule.lastRun = new Date().toISOString();
    schedule.lastResult = String(result ?? '').slice(0, 1000);
    await persist();
    return schedule;
  }

  return { list, get, add, update, remove, due, markRun };
}
