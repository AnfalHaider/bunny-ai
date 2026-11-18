// BROWSER, step 1 (this PC only): use Bunny in the person's own browser, at its own address on 127.0.0.1.
// Pure helpers for the shell: which port to ask for, the listen-with-fallback, and the one address the "Open in your browser" button may open.
// No token is ever put in an address: the pages hand their own token to the page they serve (token.js), and window-only controls stay locked in a browser.

export const FIXED_PORT_MIN = 49152;
export const FIXED_PORT_MAX = 65000;

export const validPort = (p) => Number.isInteger(p) && p >= FIXED_PORT_MIN && p <= FIXED_PORT_MAX;
export const randomPort = (rand = Math.random) => FIXED_PORT_MIN + Math.floor(rand() * (FIXED_PORT_MAX - FIXED_PORT_MIN + 1));

/** The port to ask for: 0 (any free one) normally; the stored fixed port when "Keep the same address after restart" is on (one is chosen when there is none). */
export function wantedPort(prefs, rand = Math.random) {
  if (!prefs?.keepAddress) return 0;
  return validPort(prefs.fixedPort) ? prefs.fixedPort : randomPort(rand);
}

/**
 * The port to keep the moment "Keep the same address after restart" is turned on: the one Bunny is listening on right now, so the very next start is on the same address
 * (not only the start after that). Null when none is wanted: the switch is not on, a port is already kept, or this one is outside the range kept.
 */
export function portToKeepNow(prefs, currentPort) {
  return prefs?.keepAddress && !validPort(prefs.fixedPort) && validPort(currentPort) ? currentPort : null;
}

/**
 * Listen on `host` (always 127.0.0.1 here) at the wanted port. If a fixed port is taken by another program, listen on any free one and say so.
 * @returns {Promise<{ port: number, note: string, fixed: boolean }>}
 */
export async function listenWithFallback(server, host, wanted) {
  const listenAt = (port) => new Promise((resolve, reject) => { const onError = (err) => reject(err); server.once('error', onError); server.listen(port, host, () => { server.off('error', onError); resolve(); }); });
  try {
    await listenAt(wanted);
    return { port: server.address().port, note: '', fixed: wanted !== 0 };
  } catch (err) {
    if (wanted !== 0 && (err?.code === 'EADDRINUSE' || err?.code === 'EACCES')) {
      await listenAt(0);
      return { port: server.address().port, note: `The address you kept (port ${wanted}) is used by another program, so Bunny is using a different one this time. A bookmark to the old address will not work until that program is closed.`, fixed: false };
    }
    throw err;
  }
}

/** The one address "Open in your browser" opens: this server's own origin on 127.0.0.1, with no path, no query and no token. Anything else is refused. */
export function browserAddress(origin) {
  let u;
  try { u = new URL(String(origin ?? '')); } catch { return null; }
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port) return null;
  return `http://127.0.0.1:${u.port}/`;
}
