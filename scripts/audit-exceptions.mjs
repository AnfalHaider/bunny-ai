// The gate's dependency audit with the owner's written exceptions (docs/security/audit-exceptions.json).
// `npm audit` is run over ALL dependencies. A high or critical advisory passes only if it is listed here for that package path, signed by the owner
// (accepted_by is a name, never "PENDING OWNER") and not expired (review_by is today or later, and at most 30 days ahead, so every exception is looked at again).
import { readFileSync } from 'node:fs';

export const MAX_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const ADVISORY = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

/** Read the exceptions file: { entries: [...valid], problems: [text] }. A missing file means no exceptions. An entry with a problem never counts. */
export function checkExceptions(list, now = new Date()) {
  const problems = [];
  const entries = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const [i, e] of (Array.isArray(list) ? list : []).entries()) {
    const label = `entry ${i + 1}${e && e.advisory ? ` (${e.advisory})` : ''}`;
    const text = (k) => typeof e?.[k] === 'string' && e[k].trim();
    const fail = (why) => problems.push(`${label}: ${why}`);
    if (!e || typeof e !== 'object') { fail('not an object'); continue; }
    if (!ADVISORY.test(String(e.advisory ?? ''))) { fail('advisory must be a GHSA id'); continue; }
    if (!text('package_path') || !/^node_modules\//.test(e.package_path)) { fail('package_path must be a node_modules path'); continue; }
    if (!text('why')) { fail('why it does not reach the shipped app is missing'); continue; }
    if (!text('accepted_by') || /^pending/i.test(e.accepted_by.trim())) { fail('not signed by the owner yet (accepted_by)'); continue; }
    const review = /^\d{4}-\d{2}-\d{2}$/.test(String(e.review_by ?? '')) ? Date.parse(`${e.review_by}T00:00:00Z`) : NaN;
    if (Number.isNaN(review)) { fail('review_by must be a date, YYYY-MM-DD'); continue; }
    if (review < today) { fail(`expired on ${e.review_by}`); continue; }
    if (review > today + MAX_DAYS * DAY) { fail(`review_by is more than ${MAX_DAYS} days ahead`); continue; }
    entries.push({ advisory: e.advisory.toUpperCase(), package_path: e.package_path });
  }
  return { entries, problems };
}

/** The advisories npm audit found at high or critical: each `via` that is an advisory (not just another package's name), with the paths it sits at. */
export function highAdvisories(audit) {
  const found = new Map();
  for (const v of Object.values(audit?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (!via || typeof via !== 'object') continue;
      if (via.severity !== 'high' && via.severity !== 'critical') continue;
      const id = (/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(via.url ?? '') ?? [null])[0];
      for (const path of v.nodes ?? [v.name]) found.set(`${id ?? via.source ?? via.title}|${path}`, { advisory: id ?? String(via.source ?? via.title), package_path: path, title: via.title ?? '', severity: via.severity });
    }
  }
  return [...found.values()];
}

/** Judge one audit result against the exceptions. ok only when no high or critical finding is left unexcused. */
export function judgeAudit(audit, list, now = new Date()) {
  const { entries, problems } = checkExceptions(list, now);
  const covered = new Set(entries.map((e) => `${e.advisory.toUpperCase()}|${e.package_path}`));
  const all = highAdvisories(audit);
  const unlisted = all.filter((f) => !covered.has(`${String(f.advisory).toUpperCase()}|${f.package_path}`));
  return { ok: unlisted.length === 0, unlisted, excepted: all.filter((f) => !unlisted.includes(f)), problems };
}

/** The gate step: run `npm audit --json` output through the judge. Returns { ok, lines }. */
export function auditStep(stdout, file, now = new Date()) {
  let audit;
  try { audit = JSON.parse(stdout); } catch { return { ok: false, lines: ['npm audit did not return JSON (is the registry reachable?)'] }; }
  if (audit.error) return { ok: false, lines: [`npm audit failed: ${audit.error.summary ?? audit.error.code ?? 'unknown'}`] };
  let list = [];
  try { list = JSON.parse(readFileSync(file, 'utf8')).exceptions ?? []; } catch (err) { if (err.code !== 'ENOENT') return { ok: false, lines: [`${file} could not be read: ${err.message}`] }; }
  const r = judgeAudit(audit, list, now);
  const lines = [`${r.excepted.length} high finding(s) excused by ${file}, ${r.unlisted.length} not`];
  for (const f of r.unlisted) lines.push(`NOT EXCUSED: ${f.advisory} at ${f.package_path} (${f.severity}) ${f.title}`.slice(0, 220));
  for (const p of r.problems) lines.push(`exception not counted: ${p}`);
  return { ok: r.ok, lines };
}
