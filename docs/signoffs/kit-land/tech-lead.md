---
piece: kit-land
role: tech-lead
sha: ba091a6
verdict: PASS
date: 2026-11-17
---

Supersedes 88bbd53. K-3 delta (1d3a77c..d6e620a) read: legacy_deny_all raw check now also runs for interpreter, shell-pipe and xargs commands; any bootstrap flow command and flow-ui.mjs are the Chief's; docs/flow-changes and docs/kit-changes are Chief-only in the record check; an unassigned session may not take chief-of-staff, release-ops or hotfix. Checked in a checkout of ba091a6: bin, .githooks, policy, flow and ui byte-identical to scripts/kit-next (diff -rq clean); staged guard equals d6e620a. My probes: the hook-skip flag or the git hooks-path setting through sh, bash, xargs, node -e, a pipe into git commit are refused; the same text in a quoted commit message or echo prose is allowed; unassigned role chief-of-staff refused, role builder allowed. Tests k2+k1 46/46 on the staged kit. Installed-kit run: 2 failures the CoS README explains (landing policy check; K2-1 timing under load, passes alone) and 8 old-baseline expectations. Not run by me: e2e, the landing itself. Still open: git -C main commit follow-up.
