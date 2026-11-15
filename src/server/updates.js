/**
 * Version and updates.
 *
 * The app runs from a folder on your own machine, so there is nothing to
 * auto-update behind your back. What it can do is tell you whether the
 * version you are running is the one that has been published, if you point it
 * at a feed.
 *
 * The feed is a small JSON file:
 *
 *   { "version": "0.2.0", "url": "https://example.com/bunny-ai", "notes": "..." }
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where new versions are published: the latest GitHub release. */
export const RELEASES_FEED = 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest';

let cached = null;

/** The version of the app, from package.json. */
export async function appVersion() {
  if (cached) return cached;
  try {
    const raw = await readFile(join(ROOT, 'package.json'), 'utf8');
    cached = String(JSON.parse(raw).version ?? '0.0.0');
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

/**
 * Compare two dotted versions.
 * @returns {number} negative when a is older, 0 when equal, positive when newer
 */
export function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => Number(part) || 0);
  const right = String(b).split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Check a feed for a newer version.
 *
 * @param {{url: string, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 */
export async function checkForUpdate({ url, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const current = await appVersion();
  const feed = String(url ?? '').trim();
  if (!feed) {
    return { current, latest: current, updateAvailable: false, source: null, message: 'No update source is configured.' };
  }
  if (!/^https?:\/\//i.test(feed)) {
    return { current, latest: current, updateAvailable: false, source: feed, message: 'The update source must be an http address.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(feed, { headers: { accept: 'application/json' }, signal: controller.signal });
  } catch (err) {
    return {
      current,
      latest: current,
      updateAvailable: false,
      source: feed,
      message: err?.name === 'AbortError' ? 'The update source did not answer in time.' : 'The update source could not be reached.',
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { current, latest: current, updateAvailable: false, source: feed, message: `The update source answered ${res.status}.` };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { current, latest: current, updateAvailable: false, source: feed, message: 'The update source did not send a version.' };
  }

  // A small feed says { version }, a GitHub release says { tag_name: 'v0.2.0' }.
  const latest = String(payload?.version ?? payload?.tag_name ?? '').replace(/^v/i, '').trim();
  if (!latest) {
    return { current, latest: current, updateAvailable: false, source: feed, message: 'The update source did not send a version.' };
  }
  const updateAvailable = compareVersions(latest, current) > 0;
  return {
    current,
    latest,
    updateAvailable,
    source: feed,
    url: payload?.html_url ?? payload?.url ?? null,
    notes: payload?.notes ?? payload?.body ?? null,
    message: updateAvailable ? `Version ${latest} is available.` : `You are on the latest version (${current}).`,
  };
}
