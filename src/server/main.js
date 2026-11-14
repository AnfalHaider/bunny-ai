/** Start Bunny AI. */
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createApp } from './app.js';

const dataDir = process.env.BUNNY_DATA_DIR
  ?? join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '.', 'BunnyAI');
const port = Number(process.env.PORT ?? 5173);

// The e2e run needs an empty profile. Doing it here, in the process that is
// about to read the profile, is the only place that cannot race: a wipe from
// the test runner can happen before or after the server has already read
// connections.json. Never set this against a profile you care about.
if (process.env.BUNNY_RESET_PROFILE === '1') {
  await rm(dataDir, { recursive: true, force: true });
}

const app = await createApp({ dataDir });

app.server.listen(port, '127.0.0.1', () => {
  const mode = process.env.BUNNY_FAKE_UPSTREAM === '1' ? ' (test mode)' : '';
  console.log(`Bunny AI${mode} -> http://127.0.0.1:${port}/`);
  console.log(`data: ${dataDir}`);
});

// Scheduled tasks are run by the server itself. The check is every minute;
// a schedule decides for itself whether it is due.
const timer = setInterval(() => {
  app.runDueSchedules().catch((err) => {
    console.error('a scheduled task failed:', err.message);
  });
}, 60_000);
timer.unref?.();

const stop = () => {
  clearInterval(timer);
  app.server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
