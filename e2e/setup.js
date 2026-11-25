import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Shared by playwright.config.js and the specs.
 *
 * The port must be the same in the runner and in every worker. The runner decides it first: BUNNY_E2E_PORT if set,
 * otherwise one free port asked of the operating system, once. It is written back to process.env, which every worker
 * inherits, so the workers read the same value instead of picking their own. Two worktrees running at once therefore get
 * different ports (and different data folders) and no longer collide.
 */
function freePort() {
  const script = "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});";
  return Number(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim());
}

const asked = Number(process.env.BUNNY_E2E_PORT);
export const PORT = Number.isInteger(asked) && asked > 0 && asked < 65536 ? asked : freePort();
process.env.BUNNY_E2E_PORT = String(PORT);
/** The e2e server's launch token (honoured only in fake-upstream mode). */
export const E2E_TOKEN = 'e2e-launch-token-0123456789abcdef0123456789abcdef0123456789abcdef';
export const dataDir = join(tmpdir(), `bunny-e2e-${PORT}`);

// IA-0: a connector the model adds must be a public https address, so the e2e's stand-in connector is a public-looking host that the SERVER's test transport sends to a fixed local port (never in a packaged build)
export const STANDIN_MCP_PORT = Number(process.env.BUNNY_E2E_MCP_PORT ?? 47931);
export const STANDIN_MCP_HOST = 'mcp.stand-in.test';
