# Security - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - G-1 guard rework review (560e636)

**Asked:** look for any way a role escapes its write scope, pushes main, skips hooks or forges a record, and for false blocks.

**Verdict: PASS with conditions** (log only; the sign-off waits for the final release sha). Report `docs/security/2026-11-16-g1-guard-review.md`; probes in `docs/security/g1-probe/`.

**Evidence:** their 70 guard tests pass; my probe 1: 124 cases, 104 as expected; no false blocks on 26 normal commands; the four false blocks the live guard gave me this session are allowed by the staged one. Gaps: G1-1 HIGH `gh release/pr merge/api` unguarded; G1-2 MEDIUM records not authenticated at commit (forged QA sign-off passes pre-commit); G1-3 MEDIUM hooks folder removable, alias/--git-dir skips; G1-4 dynamic push refspec; G1-5 role by variable. Board rows G1-1..G1-5 filed.

**Lesson:** a guard that lists protected files must also protect the folder that holds them, and the record that says "reviewed" must be checked where git checks it, not only where the tool can see it.

## 2026-11-16 - Baseline review of 0.1.4

**Asked:** baseline review of the update channel, secret storage, the 0.1.4 surfaces and the npm audit findings; findings with file:line, severity and a recommendation; fix nothing.

**Did:** read-only review of `electron/updater.js`, `src/providers/secretStore.js`, the profile photo / memory import / import / search / move_to_new_chat code and `npm audit`. Report: `docs/security/2026-11-16-baseline-0.1.4.md` (S-1..S-10). Board rows S-1..S-8 filed. Not covered: agent command/file tools, MCP and browser control, sign-in flows, artifact serving, UI output rendering.

**Evidence:** `npm audit`: 6 moderate, 0 high (dev-only, electron-builder to minimatch). Other findings are code reading, not run exploits.

**Lesson:** the local API has no caller check; a random port is not an access control.
