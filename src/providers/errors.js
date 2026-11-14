/**
 * One error type for everything provider-related, so callers branch on `code`
 * instead of parsing messages.
 */
export class ConnectError extends Error {
  /**
   * @param {string} code machine-readable, safe to branch on
   * @param {string} message human text, safe to show
   * @param {string} [field] form field to highlight
   */
  constructor(code, message, field) {
    super(message);
    this.name = 'ConnectError';
    this.code = code;
    this.field = field;
  }
}
