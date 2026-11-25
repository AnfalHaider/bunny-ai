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
  const clean = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const walk = (suite, titles = []) => {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]s$/.test(suite.title) ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const status = t.status ?? 'unknown';
        if (!results.length) { totals.didNotRun += 1; continue; }
        if (status === 'expected') totals.passed += 1;
        else if (status === 'flaky') totals.flaky += 1;
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
  return { ...totals, failures, lines };
}
