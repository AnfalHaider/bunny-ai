import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExceptions, highAdvisories, judgeAudit, auditStep } from '../scripts/audit-exceptions.mjs';

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
const entry = (over = {}) => ({ advisory: 'GHSA-fc5q-39xc-vjpf', package_path: 'node_modules/picomatch', why: 'build time only', accepted_by: 'The Owner', review_by: '2026-12-10', ...over });

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

test('the gate step: JSON that cannot be read or an npm error fails; a missing exceptions file means no exceptions', () => {
  assert.equal(auditStep('not json', 'no-such-file.json', NOW).ok, false);
  assert.equal(auditStep(JSON.stringify({ error: { summary: 'offline' } }), 'no-such-file.json', NOW).ok, false);
  assert.equal(auditStep(JSON.stringify({ vulnerabilities: {} }), 'no-such-file.json', NOW).ok, true, 'nothing found, nothing needed');
  assert.equal(auditStep(JSON.stringify(audit), 'no-such-file.json', NOW).ok, false);
});

test('the proposed entry in docs/security/audit-exceptions.json is waiting for the owner, so it cannot pass anything yet', () => {
  const file = new URL('../docs/security/audit-exceptions.json', import.meta.url);
  const { exceptions } = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].advisory, 'GHSA-fc5q-39xc-vjpf');
  assert.equal(exceptions[0].accepted_by, 'PENDING OWNER');
  assert.equal(judgeAudit(audit, exceptions, new Date('2026-11-20T00:00:00Z')).ok, false);
});
