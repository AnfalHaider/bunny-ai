import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Shared by playwright.config.js and e2e/setup.js.
 *
 * The port must be a constant, not something computed: Playwright loads this
 * config in the runner *and* in every worker, so a computed value would give
 * the server one port and the tests another.
 */
export const PORT = 5199;
/** The e2e server's launch token (honoured only in fake-upstream mode). */
export const E2E_TOKEN = 'e2e-launch-token-0123456789abcdef0123456789abcdef0123456789abcdef';
export const dataDir = join(tmpdir(), 'bunny-e2e');
