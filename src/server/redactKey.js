/**
 * K-5: a connector key never reaches the model or the window in a tool result, an error or a connector's own answer. Every occurrence of the value is replaced, in text, in the JSON-escaped form
 * a text may carry it in, and in its URL-encoded and base64 forms (a server that echoes a header may re-encode it). Applied to whatever a keyed connector returns or throws.
 */
const MASK = '***';

const forms = (secret) => {
  const s = String(secret ?? '');
  if (s.length < 4) return s ? [s] : []; // a very short value would blank ordinary words; it is still blanked as itself
  const out = new Set([s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s), Buffer.from(s).toString('base64'), Buffer.from(s).toString('base64url')]);
  out.delete(''); return [...out].sort((a, b) => b.length - a.length);
};

/** The text with every form of the secret blanked. */
export function redactText(text, secret) {
  let out = String(text ?? '');
  for (const f of forms(secret)) out = out.replaceAll(f, MASK);
  return out;
}

/** The same for any JSON-like value (strings anywhere inside, object keys too). Returns a copy. */
export function redactDeep(value, secret) {
  if (!secret) return value;
  const walk = (v) => {
    if (typeof v === 'string') return redactText(v, secret);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = Array.isArray(v) ? [] : {}; for (const [k, x] of Object.entries(v)) o[redactText(k, secret)] = walk(x); return Object.assign(Object.create(Object.getPrototypeOf(v)), o); }
    return v;
  };
  return walk(value);
}

/** An error with the secret blanked out of its message (and its cause's); the code and the sign-in fields stay. */
export function redactError(err, secret) {
  if (!secret || !err) return err;
  try { err.message = redactText(err.message, secret); if (err.cause?.message) err.cause.message = redactText(err.cause.message, secret); } catch { /* a frozen error: the caller wraps it */ }
  return err;
}
