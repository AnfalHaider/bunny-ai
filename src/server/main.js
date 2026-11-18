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

// A fixed token only for the invented-profile test run, so the e2e `request` fixture can send it.
const fixedToken = process.env.BUNNY_FAKE_UPSTREAM === '1' && process.env.BUNNY_API_TOKEN ? process.env.BUNNY_API_TOKEN : undefined;
const app = await createApp({ dataDir, apiToken: fixedToken });

app.server.listen(port, '127.0.0.1', () => {
  // REMOTE-STAY: if the person left device access on, open it again (on the same network only)
  app.resumeRemote().then((r) => { if (r.resumed) console.log(`Open to other devices -> ${r.url}`); else if (r.reason) console.log(r.reason); }).catch(() => {});
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
  Promise.all([app.processes.stopAll(), app.localMcp.stopAll()]).catch(() => {}).finally(() => app.server.close(() => process.exit(0)));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
