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
export const dataDir = join(tmpdir(), 'bunny-e2e');
