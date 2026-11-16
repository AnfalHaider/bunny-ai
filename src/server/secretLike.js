/**
 * Does this text look like it holds a secret (a key, a token, a password, an .env file, the environment)?
 * Used before a tool result is kept for replay or saved to a file: such results stay short and stay here.
 * It errs on the side of "yes": a missed note is cheap, a leaked key is not.
 */
const PATTERNS = [
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, // a JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /(?:api[_-]?key|secret|token|passwd|password|pwd|credential)[\w.-]{0,40}\s{0,4}[=:]\s{0,4}["']?[^\s"']{8,}/i,
  /:\/\/[^/\s:@]+:[^@\s/]{3,}@/,                                   // user:password@host
  /[?&](access_)?(token|key|api_key|apikey|sig|signature|secret)=[A-Za-z0-9._~%-]{8,}/i,
];

/** A tool step that reads such things by its nature: an .env file, the environment, a key store. */
const RISKY_STEP = /(^|[\/\s])\.env(\.|\b)|\bprintenv\b|\bGet-ChildItem\s+Env:|\$env:|(^|\s)set\s*$|\bid_rsa\b|\.pem\b|\.pfx\b|credentials|\.npmrc|\.netrc|secrets?\b/i;

export function looksSecret(text, step = '') {
  if (RISKY_STEP.test(String(step))) return true;
  // Bounded: only the start and the end are read, so a huge result cannot hold the server up.
  const all = String(text ?? '');
  const s = all.length > 131_072 ? `${all.slice(0, 65_536)}
${all.slice(-65_536)}` : all;
  return PATTERNS.some((p) => p.test(s));
}
