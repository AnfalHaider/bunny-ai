// TEST-DNS: a test reporter that only says which test started and which ended: one line {e, file, name, nesting, t} for test:start, test:pass and test:fail.
// scripts/unit-tests.mjs reads it when a run goes silent, to name the file and test that never finished. No test output and no values go in it.
export default async function* progress(source) {
  for await (const event of source) {
    const kind = { 'test:start': 'start', 'test:pass': 'pass', 'test:fail': 'fail' }[event.type];
    if (!kind) continue;
    const { file, name, nesting } = event.data;
    yield `${JSON.stringify({ e: kind, file: file ? String(file) : null, name: String(name ?? '').slice(0, 200), nesting: nesting ?? 0, t: Date.now() })}\n`;
  }
}

/**
 * node --test reports a file's tests to the reporter only when that file has ended, and in the order the files were given (a file that hangs holds back every file after it, which is
 * why a stuck run prints nothing). So the file a hung run waits for is the FIRST given file the reporter has not heard of. `files` are absolute paths in the order they were given.
 */
export function waitingFor(text, files) {
  const norm = (f) => String(f).replace(/\\/g, '/').toLowerCase();
  const heard = new Set();
  for (const line of String(text).split('\n')) { try { const x = JSON.parse(line); if (x.file) heard.add(norm(x.file)); } catch { /* not a line of ours */ } }
  const waiting = files.filter((f) => !heard.has(norm(f)));
  return { heard: files.length - waiting.length, waiting };
}
