# Security - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - Baseline review of 0.1.4

**Asked:** baseline review of the update channel, secret storage, the 0.1.4 surfaces and the npm audit findings; findings with file:line, severity and a recommendation; fix nothing.

**Did:** read-only review of `electron/updater.js`, `src/providers/secretStore.js`, the profile photo / memory import / import / search / move_to_new_chat code and `npm audit`. Report: `docs/security/2026-11-16-baseline-0.1.4.md` (S-1..S-10). Board rows S-1..S-8 filed. Not covered: agent command/file tools, MCP and browser control, sign-in flows, artifact serving, UI output rendering.

**Evidence:** `npm audit`: 6 moderate, 0 high (dev-only, electron-builder to minimatch). Other findings are code reading, not run exploits.

**Lesson:** the local API has no caller check; a random port is not an access control.
