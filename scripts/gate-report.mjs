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
