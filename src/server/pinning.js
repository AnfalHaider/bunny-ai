/**
 * INSTALL-ANYWHERE IA-9: a connector saved as `npx -y <pkg>` or `uvx <pkg>` runs whatever version the registry serves that day. Customize marks it "not pinned" and offers "Pin this version", which runs the same
 * pipeline as a new install (IA-2 / IA-3: exact version, integrity, whole tree installed and shown on a card) and then points the connector at the pinned copy. These are the pure parts.
 */
const EXACT_NPM = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*@\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/** { kind: 'npm' | 'pypi', name, spec } when this local connector runs an unpinned package, else null. */
export function unpinnedPackage(server) {
  if (!server || server.type !== 'local') return null;
  const program = String(server.command ?? '').toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const first = args.find((a) => !a.startsWith('-'));
  if (!first) return null;
  if (program === 'npx') {
    if (EXACT_NPM.test(first)) return null; // already name@x.y.z
    const at = first.lastIndexOf('@');
    const name = at > 0 ? first.slice(0, at) : first;
    return /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/.test(name) ? { kind: 'npm', name, spec: `${name}@latest` } : null;
  }
  if (program === 'uvx' || program === 'uv') {
    if (/==\d/.test(first)) return null;
    const name = first.split(/[=<>!~\[]/)[0];
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? { kind: 'pypi', name, spec: name } : null;
  }
  return null;
}
