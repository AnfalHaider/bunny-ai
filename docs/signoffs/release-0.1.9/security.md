---
piece: release-0.1.9
role: security
sha: b9bdd7a
verdict: PASS
date: 2026-11-17
---

# release-0.1.9 at b9bdd7a: Security PASS

The candidate is b9bdd7a on `claude/release-0.1.9`. The Chief of Staff reports its gate passed 9 of 9, including both audit steps.

## Every Security-signed piece is in the candidate

`git merge-base --is-ancestor <signed sha> b9bdd7a` succeeds for each of them:

| Piece | Signed sha | In b9bdd7a |
|---|---|---|
| w4-11c | c5082f5 | IN |
| s-upd | ab1d2fc | IN |
| run | 29aba58 | IN |
| w4-8b | 3cb6368 | IN |
| s-oauth | f929949 | IN |
| w6-12 | 424bb72 | IN |
| w6-16 | 54dee4b | IN |
| w6-24 | db88c21 | IN |
| priv | 226114b | IN |
| w6-10 | 504c388 | IN |
| w6-6 | 0a6ec13 | IN |
| p4-1 | 9f329f5 | IN |
| qa-batch | 883dafd | IN |
| audit-exceptions | 735e286 | IN |
| memory-guard | 591bf83 | IN |

The sign-off files for these pieces are on `claude/security-v019-6ac7c5`, not in b9bdd7a. They must be merged before the push check reads them.

## Policy change 1dad4ac: accepted

- `docs/security/audit-exceptions.json` is in `records.globs`, whose writers are chief-of-staff only. It is also in `protected_globs`.
- `scripts/audit-exceptions.mjs` is in `protected_globs`.

**Deviation, accepted.** I had asked for refusal at commit and push through `records`. `recordChecks` only knows the sign-off, release, flow and kit folders. Instead, commit and push protection comes from `protected_globs`, which `scopeViolations` checks in both `precommit.mjs:54` and `prepush.mjs:249`, and only the Chief of Staff passes it. `records.globs` adds the Write and shell block.

LOW: roles in `scope_check.push_exempt_roles` (release-ops) skip the push scope check. This is the same as for `.bootstrap/**` today, so it is not new to this file.

## Exception 9d5167a: accepted

GHSA-fc5q-39xc-vjpf on `node_modules/picomatch` is signed:
- owner_words: "Sign the exception"
- said_at: 2026-11-18
- review_by: 2026-12-17, which is within the 30-day limit.

picomatch is build-time only: the Chief of Staff reports `npm ls picomatch --omit=dev` as empty. What ships is still audited at moderate with no exceptions.
