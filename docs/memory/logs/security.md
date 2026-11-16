# Security - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - T-3 offline network probe (092cc6d)

**Verdict (log only): PASS.** Three fixed https hosts (Google, Cloudflare, Apple), bare GET, no cookies or custom headers, redirects not followed, nothing of the person sent; asked only when the browser already says offline. Behind the S-1 guard (403 without token, cross-site or foreign origin, checked live on an invented profile). No request input reaches the host list, so no arbitrary fetch. Notes: cancel the unread response body; name the hosts in the help text. Report `docs/security/2026-11-16-t3-network-probe-review.md`. The probe was not called live.

**Lesson:** for a "check connectivity" feature, the review is what leaves the machine and who can trigger it; both are answered by reading one constant and one route.

## 2026-11-16 - Q2-1 Plan mode and Q2-23 token re-read (4405dc0)

**Verdict (log only):** Q2-23 PASS. Q2-1 FAIL as a read-only guarantee, two bypasses: browser_click and browser_type run in Plan mode (the browser branch of runTool, app.js:2208, has no planRefuses), and move_to_new_chat opens and sends a new chat outside Plan mode. Helpers, scheduled tasks, custom tools and connector tools are covered. Report `docs/security/2026-11-16-q2-1-and-q2-23-review.md`; board row Q2-S1..S3. Read from the code, not exploited.

**Lesson:** a refusal added at two dispatch points misses the third; list every way a tool call can enter the runner before saying "on the server".

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
