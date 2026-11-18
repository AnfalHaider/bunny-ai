---
piece: release-0.1.10
role: qa
sha: 9d4e942
verdict: FAIL
date: 2026-11-18
---

Walk on 9d4e942, invented profiles. PASS: settings-bridge 25/25 (real Electron); artifact Open shows content, no bridge, secure:write fails, Print uses a sandbox allow-scripts allow-modals frame (real Electron, 24/24 in e2e/w0110-electron.mjs); Quick Ask bar 20/20 and artifact-window 12/12 and remote-access 16/16 (builder probes run by me in real Electron); model chip opens upward, bottom sheet on a phone, light+dark (Chromium and real window); browser-tab lock wording and 403 sentence; device sign-in, wrong passcode, 30 s wait, device cannot change settings, device list, Sign out, status line; W2-9 own copy + Finish keep in the real window; About shows all 20,916 chars of notes; updater 0.1.9 sees 0.1.10, checksum ok, tampered body refused. FAIL 1 (F-1): a signed-in device cannot answer its chat's permission card in the real page: src/ui/api.js sendJSON refuses at once with Change this in Bunny's window for any window-only route when there is no bridge (no isDevicePage exemption), so Allow sends nothing and the tool never runs; the server accepts it (unknown card id -> 404, unit test passes), so only the page is wrong. Checks 6.4c 6.5 6.6 in e2e/w0110-walk.mjs. Same cause for question and code_mode cards. FAIL 2 (F-2, LOW): in a browser tab the Permission rules Pattern box and Add rule button are only aria-disabled (renderRules in settings.html resets disabled after the lock), so a person can type; the write is refused with the sentence and no rule is saved; the builder e2e passes because toBeDisabled counts aria-disabled.
