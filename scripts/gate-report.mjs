// GATE-WHY: why a gate step failed. Its own file so a test can import it (gate.mjs runs every check when imported).
/** The lines that say why a step failed: how it ended, any spawn error, and the HUNG:/EXIT: lines a step printed (with the 20 lines after each). */
export function failureDetail(r, out = []) {
  const cut = (s) => String(s).slice(0, 300);
  const lines = [`exit status: ${r.status ?? 'none'}`, `signal: ${r.signal ?? 'none'}`];
  if (r.error) {
    lines.push(`spawn error: ${r.error.code ?? 'none'}: ${String(r.error.message ?? '').slice(0, 300)}`);
    if (r.error.code === 'ENOBUFS') lines.push('the output passed maxBuffer, so the step was killed and its output is cut short');
  }
  const keep = new Set();
  out.forEach((l, i) => { if (/^\s*(HUNG|EXIT):/.test(l)) for (let k = i; k <= i + 20 && k < out.length; k++) keep.add(k); });
  for (const i of [...keep].sort((a, b) => a - b)) lines.push(cut(out[i]));
  return lines;
}

/** The first non-empty line of a message, without colour codes. */
const firstLine = (m) => String(m ?? '').replace(new RegExp(`${String.fromCharCode(27)}\[[0-9;]*m`, 'g'), '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '(no message)';

/**
 * GATE-E2E-LIST: what a Playwright JSON report says, as lines for the gate. The gate used to show only the last 8 lines of the e2e output, which cut the list of failed tests and their count (a gate once
 * printed five failing pictures while other specs failed above them). Every failed test is named with its project, spec:line and title, with the first line of its error, and the totals are
 * passed, failed, flaky, skipped and did-not-run (a test that has no result at all: it was never started, for example after a failing test stopped its project).
 * @param {any} report the parsed JSON report (npx playwright test --reporter=json)
 * @returns {{ passed: number, failed: number, flaky: number, skipped: number, didNotRun: number, failures: { where: string, title: string, error: string }[], lines: string[] }}
 */
export function playwrightSummary(report) {
  const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0, didNotRun: 0 };
  const failures = [];
  const flaky = [];
  const clean = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const walk = (suite, titles = []) => {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]s$/.test(suite.title) ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const status = t.status ?? 'unknown';
        if (!results.length) { totals.didNotRun += 1; continue; }
        if (status === 'expected') totals.passed += 1;
        else if (status === 'flaky') { totals.flaky += 1; flaky.push(`${t.projectName ? `[${t.projectName}] ` : ''}${spec.file ?? suite.file ?? '?'}:${spec.line ?? '?'} › ${[...here, spec.title].filter(Boolean).join(' › ')}`); }
        else if (status === 'skipped') totals.skipped += 1;
        else {
          totals.failed += 1;
          const last = results[results.length - 1] ?? {};
          failures.push({ where: `${t.projectName ? `[${t.projectName}] ` : ''}${spec.file ?? suite.file ?? '?'}:${spec.line ?? '?'}`, title: [...here, spec.title].filter(Boolean).join(' › '), error: clean(last.error?.message ?? last.errors?.[0]?.message ?? '') });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const s of report?.suites ?? []) walk(s);
  const lines = [`totals: ${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped, ${totals.didNotRun} did not run`];
  if (failures.length) {
    lines.push(`-- every failed test (${failures.length}) --`);
    for (const f of failures) lines.push(`  ${f.where} › ${f.title}${f.error ? `  [${f.error.slice(0, 160)}]` : ''}`);
  }
  if (flaky.length) { lines.push(`-- flaky (${flaky.length}): failed first and passed on a retry --`); for (const f of flaky) lines.push(`  ${f}`); }
  return { ...totals, failures, flakyTests: flaky, lines };
}

/**
 * GATE-E2E-LIST (Tech Lead's G1 to G3): whether a Playwright JSON report means the step passed, and every line that says why not. A step passes only when the report was read, has no failed test, no test that
 * did not run, no load or setup error, and its own totals (report.stats) equal the totals counted by walking the tests (a report that does not add up is not trusted).
 * @param {any} report the parsed report, or null when it was missing or unreadable
 * @returns {{ pass: boolean, lines: string[], reasons: string[] }}
 */
export function judgeReport(report) {
  if (!report || typeof report !== 'object') return { pass: false, lines: ['no usable JSON report was written, so there is no list of failed tests and the step cannot pass'], reasons: ['no report'] };
  const sum = playwrightSummary(report);
  const lines = [...sum.lines];
  const reasons = [];
  if (sum.failed > 0) reasons.push(`${sum.failed} failed`);
  if (sum.didNotRun > 0) reasons.push(`${sum.didNotRun} did not run`);
  const errors = Array.isArray(report.errors) ? report.errors : [];
  if (errors.length) {
    reasons.push(`${errors.length} report error(s)`);
    lines.push(`-- errors in the report (${errors.length}): spec load errors, global setup --`);
    for (const e of errors) lines.push(`  ${firstLine(e?.message ?? e)}`);
  }
  const st = report.stats;
  const walked = { expected: sum.passed, unexpected: sum.failed, flaky: sum.flaky, skipped: sum.skipped + sum.didNotRun };
  if (!st || ['expected', 'unexpected', 'flaky', 'skipped'].some((k) => st[k] !== walked[k])) {
    reasons.push('the report totals do not match its tests');
    lines.push(`report.stats: ${st ? `expected ${st.expected}, unexpected ${st.unexpected}, flaky ${st.flaky}, skipped ${st.skipped}` : 'missing'}; counted from the tests: expected ${walked.expected}, unexpected ${walked.unexpected}, flaky ${walked.flaky}, skipped (with did not run) ${walked.skipped}`);
  }
  return { pass: reasons.length === 0, lines, reasons };
}
