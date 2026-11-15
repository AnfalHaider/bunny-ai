/**
 * Long output cut to size, keeping its start AND its end: the error, the exit code and the
 * summary of a build or test run come last, so cutting only the end would lose them.
 */
export function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.25);
  const tail = max - head - 40;
  return `${s.slice(0, head)}\n… (${s.length - head - tail} characters left out) …\n${s.slice(-tail)}`;
}
