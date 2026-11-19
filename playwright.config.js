import { defineConfig } from '@playwright/test';
import { PORT, dataDir, E2E_TOKEN } from './e2e/setup.js';

// The e2e run is self-contained: Playwright starts its own Bunny AI instance in
// fake-upstream mode on a its own port (BUNNY_E2E_PORT, else a free one) with a throwaway profile, so a run never
// touches the real ~/AppData/Local/BunnyAI profile.
//
// The profile is emptied by the server itself (BUNNY_RESET_PROFILE=1) rather
// than by a globalSetup: a runner-side wipe races the server's first read.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    extraHTTPHeaders: { 'x-bunny-token': E2E_TOKEN },
    trace: 'off',
    video: 'off',
  },
  // PICTURE-CHECK: the help pictures are drawn again by their own project, on this same server (an invented profile): e2e/pictures.spec.js compares each with docs/images/<name>,
  // which IS the reference (`npm run pictures` draws them again). Everything else is the e2e project.
  projects: [
    { name: 'e2e', testIgnore: /pictures.spec.js/ },
    { name: 'pictures', testMatch: /pictures.spec.js/, snapshotPathTemplate: '{testDir}/../docs/images/{arg}{ext}', expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.0001 } } },
  ],
  webServer: {
    command: 'node src/server/main.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(PORT),
      BUNNY_FAKE_UPSTREAM: '1',
      BUNNY_PCSEARCH_FAKE: '1', // SEARCH-PC: a stand-in index over invented files
      BUNNY_RESET_PROFILE: '1',
      BUNNY_DATA_DIR: dataDir,
      BUNNY_API_TOKEN: E2E_TOKEN,
    },
  },
});
