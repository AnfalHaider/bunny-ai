import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExceptions, highAdvisories, judgeAudit, auditStep, exceptionsSource } from '../scripts/audit-exceptions.mjs';

// The gate's audit exceptions: a high finding passes only when it is listed, signed by the owner, and not expired. Invented audit data.
const NOW = new Date('2026-11-17T12:00:00Z');
const advisory = { source: 1, name: 'picomatch', title: 'ReDoS', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', severity: 'high', range: '<4.0.4' };
const audit = {
  vulnerabilities: {
    picomatch: { name: 'picomatch', severity: 'high', via: [advisory], nodes: ['node_modules/picomatch'] },
    tinyglobby: { name: 'tinyglobby', severity: 'high', via: ['picomatch'], nodes: ['node_modules/tinyglobby'] }, // only passes it on: not an advisory of its own
    minimatch: { name: 'minimatch', severity: 'moderate', via: [{ ...advisory, severity: 'moderate', url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249' }], nodes: ['node_modules/minimatch'] },
  },
};
const entry = (over = {}) => ({ advisory: 'GHSA-fc5q-39xc-vjpf', package_path: 'node_modules/picomatch', why: 'build time only', accepted_by: 'The Owner', owner_words: 'accept it for now', said_at: '2026-11-17 09:00', review_by: '2026-12-10', ...over });

test('only high and critical advisories are counted, once each, not the packages that pass them on', () => {
  assert.deepEqual(highAdvisories(audit).map((f) => [f.advisory, f.package_path]), [['GHSA-fc5q-39xc-vjpf', 'node_modules/picomatch']]);
});

test('a high finding with no entry fails the audit and is named', () => {
  const r = judgeAudit(audit, [], NOW);
  assert.equal(r.ok, false);
  assert.equal(r.unlisted[0].advisory, 'GHSA-fc5q-39xc-vjpf');
});

test('a signed, unexpired entry for that advisory AND that package path lets it pass', () => {
  assert.equal(judgeAudit(audit, [entry()], NOW).ok, true);
  assert.equal(judgeAudit(audit, [entry({ package_path: 'node_modules/other' })], NOW).ok, false, 'another path is another finding');
  assert.equal(judgeAudit(audit, [entry({ advisory: 'GHSA-aaaa-bbbb-cccc' })], NOW).ok, false, 'another advisory');
});

test('an entry that is not signed ("PENDING OWNER" or empty) never passes anything', () => {
  for (const accepted_by of ['PENDING OWNER', 'pending owner', '', '  ']) {
    const r = judgeAudit(audit, [entry({ accepted_by })], NOW);
    assert.equal(r.ok, false, accepted_by);
    assert.match(r.problems[0], /not signed by the owner/);
  }
});

test('an expired entry, one more than 30 days ahead, a bad date and missing fields do not count', () => {
  assert.match(judgeAudit(audit, [entry({ review_by: '2026-11-16' })], NOW).problems[0], /expired/);
  assert.equal(judgeAudit(audit, [entry({ review_by: '2026-11-17' })], NOW).ok, true, 'today is still fine');
  assert.equal(judgeAudit(audit, [entry({ review_by: '2026-12-17' })], NOW).ok, true, 'exactly 30 days ahead');
  assert.match(judgeAudit(audit, [entry({ review_by: '2026-12-18' })], NOW).problems[0], /more than 30 days/);
  assert.match(judgeAudit(audit, [entry({ review_by: 'soon' })], NOW).problems[0], /review_by must be a date/);
  assert.match(judgeAudit(audit, [entry({ why: '' })], NOW).problems[0], /why/);
  assert.match(judgeAudit(audit, [entry({ package_path: '/etc/passwd' })], NOW).problems[0], /package_path/);
  assert.match(judgeAudit(audit, [entry({ advisory: 'CVE-2026-1' })], NOW).problems[0], /GHSA/);
  assert.equal(checkExceptions('not a list', NOW).entries.length, 0);
});

const source = (text) => ({ ok: true, text, lines: [] });

test('the gate step: JSON that cannot be read or an npm error fails; no exceptions file means no exceptions', () => {
  assert.equal(auditStep('not json', source(null), NOW).ok, false);
  assert.equal(auditStep(JSON.stringify({ error: { summary: 'offline' } }), source(null), NOW).ok, false);
  assert.equal(auditStep(JSON.stringify({ vulnerabilities: {} }), source(null), NOW).ok, true, 'nothing found, nothing needed');
  assert.equal(auditStep(JSON.stringify(audit), source(null), NOW).ok, false);
  assert.equal(auditStep(JSON.stringify(audit), source('{ not json'), NOW).ok, false);
  assert.equal(auditStep(JSON.stringify(audit), source(JSON.stringify({ exceptions: [entry()] })), NOW).ok, true);
});

test('an entry without the words of the owner and when they were said does not count (missing or pending)', () => {
  for (const over of [{ owner_words: '' }, { owner_words: 'PENDING: the owner' }, { said_at: '' }, { said_at: 'PENDING' }]) {
    const r = judgeAudit(audit, [entry(over)], NOW);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.problems[0], /owner_words|said_at/);
  }
});

test('the path is compared exactly: a nested copy, another case and a trailing slash are not covered by the top-level entry', () => {
  const at = (path) => ({ vulnerabilities: { picomatch: { name: 'picomatch', severity: 'high', via: [advisory], nodes: [path] } } });
  assert.equal(judgeAudit(at('node_modules/picomatch'), [entry()], NOW).ok, true);
  assert.equal(judgeAudit(at('node_modules/foo/node_modules/picomatch'), [entry()], NOW).ok, false, 'a nested copy is its own finding');
  assert.equal(judgeAudit(at('node_modules/Picomatch'), [entry()], NOW).ok, false, 'case-sensitive');
  assert.equal(judgeAudit(at('node_modules/picomatch'), [entry({ package_path: 'node_modules/picomatch/' })], NOW).ok, false, 'no trailing slash');
});

test('the gate reads the COMMITTED file: a working copy that differs, or a file that is not committed, fails', async () => {
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'bunny-ae-'));
  try {
    mkdirSync(join(root, 'docs', 'security'), { recursive: true });
    const file = join(root, 'docs', 'security', 'audit-exceptions.json');
    const text = JSON.stringify({ exceptions: [entry()] });
    const run = (committed) => () => (committed === null ? { status: 128, stdout: '' } : { status: 0, stdout: committed });
    assert.deepEqual(exceptionsSource(root, undefined, run(null)), { ok: true, text: null, lines: [] }, 'nowhere: no exceptions');
    writeFileSync(file, text);
    assert.match(exceptionsSource(root, undefined, run(null)).lines[0], /not committed/);
    assert.equal(exceptionsSource(root, undefined, run(text)).ok, true);
    assert.equal(exceptionsSource(root, undefined, run(text)).text, text);
    writeFileSync(file, text.replace('The Owner', 'Somebody'));
    const edited = exceptionsSource(root, undefined, run(text));
    assert.equal(edited.ok, false);
    assert.match(edited.lines[0], /differs from the commit/);
    assert.equal(auditStep(JSON.stringify(audit), edited, NOW).ok, false, 'an uncommitted edit can never pass the audit');
    rmSync(file);
    assert.equal(exceptionsSource(root, undefined, run(text)).ok, false, 'deleted in the working folder but still committed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the signed entry in docs/security/audit-exceptions.json excuses exactly the picomatch finding, until its review date, and never the same advisory somewhere else', () => {
  const file = new URL('../docs/security/audit-exceptions.json', import.meta.url);
  const { exceptions } = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(exceptions.length, 1);
  const e = exceptions[0];
  assert.equal(e.advisory, 'GHSA-fc5q-39xc-vjpf');
  assert.equal(e.package_path, 'node_modules/picomatch');
  for (const k of ['accepted_by', 'owner_words', 'said_at']) assert.doesNotMatch(String(e[k]), /^PENDING/i, k);
  const day = new Date('2026-11-20T00:00:00Z');
  assert.equal(judgeAudit(audit, exceptions, day).ok, true, 'it excuses the finding while it is current');
  assert.equal(checkExceptions(exceptions, day).problems.length, 0);
  assert.equal(judgeAudit(audit, exceptions, new Date(`${e.review_by}T23:00:00Z`)).ok, true, 'still on its review day');
  assert.equal(judgeAudit(audit, exceptions, new Date('2027-01-01T00:00:00Z')).ok, false, 'and it stops excusing anything after the review date');
  const nested = { vulnerabilities: { picomatch: { name: 'picomatch', severity: 'high', via: [advisory], nodes: ['node_modules/other/node_modules/picomatch'] } } };
  assert.equal(judgeAudit(nested, exceptions, day).ok, false, 'a copy at another path is not excused');
});
