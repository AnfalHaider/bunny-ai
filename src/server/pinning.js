/**
 * INSTALL-ANYWHERE IA-9: a connector saved as `npx -y <pkg>` or `uvx <pkg>` runs whatever version the registry serves that day. Customize marks it "not pinned" and offers "Pin this version", which runs the same
 * pipeline as a new install (IA-2 / IA-3: exact version, integrity, whole tree installed and shown on a card) and then points the connector at the pinned copy. These are the pure parts.
 */
const EXACT_NPM = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*@\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/**
 * { kind: 'npm' | 'pypi', name, spec, rest } when this local connector runs an unpinned package, else null. `rest` is what comes AFTER the package on the command line: it is kept when the connector is pinned.
 * Only the plain forms are read (`npx [-y|--yes] <pkg> ...`, `uvx <pkg> ...`, `uv tool run <pkg> ...`); an option that takes a value, `uv run`, or anything else is "not clear" and gives null, so the wrong package is never pinned.
 */
export function unpinnedPackage(server) {
  if (!server || server.type !== 'local') return null;
  const program = String(server.command ?? '').toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
  let args = Array.isArray(server.args) ? server.args.map(String) : [];
  const NPM = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/;
  if (program === 'npx') {
    let i = 0;
    while (i < args.length && (args[i] === '-y' || args[i] === '--yes')) i += 1; // the only options that take no value and leave the package where it is
    const first = args[i];
    if (!first || first.startsWith('-')) return null;
    if (EXACT_NPM.test(first)) return null; // already name@x.y.z
    const at = first.lastIndexOf('@');
    const name = at > 0 ? first.slice(0, at) : first;
    return NPM.test(name) ? { kind: 'npm', name, spec: `${name}@latest`, rest: args.slice(i + 1) } : null;
  }
  if (program === 'uvx' || program === 'uv') {
    if (program === 'uv') { if (args[0] !== 'tool' || args[1] !== 'run') return null; args = args.slice(2); }
    const first = args[0];
    if (!first || first.startsWith('-')) return null; // an option before the package (--from, --python, --with ...) is not read
    if (/==\d/.test(first)) return null;
    const name = first.split(/[=<>!~\[@]/)[0];
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name === first ? { kind: 'pypi', name, spec: name, rest: args.slice(1) } : null;
  }
  return null;
}
