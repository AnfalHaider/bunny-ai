# GHSA-fc5q-39xc-vjpf (picomatch ReDoS): what it means for Bunny

Researcher, 2026-11-17. Reading and web only; nothing was run against the picomatch code and package.json is unchanged.
Sources: the GitHub advisory API, the picomatch repo (issues, PRs, tags), the npm registry (`npm view`, `npm pack` of the tarballs, read not installed), and Bunny's `package-lock.json`.

## Short answer for the owner

1. **No fixed picomatch exists and none is scheduled.** The newest release is 4.0.7 (2026-08-24); the advisory says no patched version. Four fix PRs are open and unmerged; the maintainer has not answered in public.
2. **No newer parent drops picomatch, and an `overrides` entry cannot help**, because there is no fixed version to point it at.
3. **For Bunny the risk is very low.** The only caller in our chain passes two fixed patterns written by node-gyp (`build/*.sln`, `build/*.mk`). It is a build-time dev dependency and never ships in the installed app.

Recommendation: do not change dependencies. If the audit step must go green, add a dated, documented exception for this one advisory in the gate, and re-check on each new picomatch release. Owner's call: that touches a security gate (HIGH).

## The advisory

- GHSA-fc5q-39xc-vjpf / CVE-2026-112366, severity high (CVSS 3.1 7.5; CVSS 4.0 8.7), CWE-1333. Published 2026-10-19; GitHub-reviewed 2026-11-17. Source: https://github.com/advisories/GHSA-fc5q-39xc-vjpf
- Affected range `<= 4.0.7`; `first_patched_version: null`.
- Mechanism (advisory text): single-branch repeated extglob patterns such as `+(*)` or `+(*a)` are skipped by `analyzeRepeatedExtglob` in `lib/parse.js`, so the compiled regex backtracks exponentially against short crafted strings. The effect is availability only (C:N/I:N/A:H); no data is read or changed.
- In 4.0.7 `analyzeRepeatedExtglob` only flags a pattern as risky when it has more than one branch (`branches.length > 1`) or a nested `*(...)`; a single branch like `*` or `*a` falls through. Source: https://github.com/micromatch/picomatch/blob/4.0.7/lib/parse.js (about lines 287-307).

## (1) Is a fix in progress?

- Releases: tags end at 4.0.7. `npm view picomatch dist-tags` shows `latest: 4.0.7`. Last commit on `master` is 2026-08-27. The last release was before the CVE was published, so none has followed it.
- Open fix PRs (all unmerged on 2026-11-17):
  - #237 "prevent ReDoS in single-branch repeated extglobs", base `master`, opened 2026-10-22, updated 2026-11-10: https://github.com/micromatch/picomatch/pull/237
  - #238 "literalize single-branch extglobs with a leading bare quantifier", base `master`, opened 2026-10-22, updated 2026-11-04: https://github.com/micromatch/picomatch/pull/238
  - #246 "[v2] Guard single-branch repeated-star extglobs against ReDoS", base `v2`, opened 2026-10-31: https://github.com/micromatch/picomatch/pull/246
  - #240 and #235 were closed without merging.
  - The advisory also links PR #194. That PR is about a leading `?` in an extglob body being treated as a wildcard (opened 2026-08-13), not the ReDoS itself; it touches the same code. Still open.
- Maintainer response: users ask for a release in issues #234, #239, #247 (open since 2026-10-20). A commenter on #247 says the maintainer has not responded; another asks the maintainer directly on 2026-11-12. The only maintainer replies I found in these threads are in #252 (2026-11-13: releases are published with `npm publish` and 2FA, no CI). So **no date and no committed plan**.
- A commenter on #247 (2026-11-04) says Snyk revoked its advisory. I did not verify that and the GitHub advisory is still live and unwithdrawn (`withdrawn_at: null`), so do not rely on it.
- Older lines: the `<= 4.0.7` range is stated for the package as a whole, and PR #246 targets the `v2` branch, so the 2.x line is treated as affected too. Latest 2.3.2, 3.0.2.

## (2) Does any newer parent avoid it? Would `overrides` help?

Versions checked on the npm registry on 2026-11-17 (dependency lists read from the published metadata):

| Package | In our chain | Newest | What it depends on |
|---|---|---|---|
| tinyglobby | 0.2.17 | 0.2.17 (latest) | `picomatch ^4.0.4`, `fdir ^6.5.0` |
| node-gyp | 12.4.0 | 13.1.0 (2026-10-02) | `tinyglobby ^0.2.12` (13.1.0 too) |
| @electron/rebuild | 4.2.1 | 4.2.1 (latest) | `node-gyp ^12.2.0` |
| electron-builder / app-builder-lib | 26.18.0 | 26.18.1; 27.0.0-alpha.14 | `@electron/rebuild ^4.2.1`; app-builder-lib 26.18.1 has no direct picomatch or tinyglobby |

- No newer version of any of these drops picomatch or pins an unaffected one. node-gyp 13 still uses tinyglobby, so moving up only changes how many majors we carry.
- The newest picomatch is the vulnerable 4.0.7, so any resolution lands on an affected version. An `overrides` entry to 3.x or 2.x would break tinyglobby's `^4.0.4` requirement and those lines are listed affected as well; an override to a git branch or PR is an unpublished, unreviewed build. **Overrides do not solve this safely.** Once a patched picomatch is published, `npm update picomatch` is enough (tinyglobby accepts `^4.0.4`), no override needed.
- In `package-lock.json`, picomatch 4.0.7 (dev) is required by tinyglobby (`"picomatch": "^4.0.4"`, line 3381) and appears as an optional peer of fdir (`^3 || ^4`, line 1763). tinyglobby is required only by node-gyp (line 2571). `package.json` has no `overrides` today.
- Not verified: whether electron-builder 27 alphas drop `@electron/rebuild`; I only read their dependency lists and found no picomatch, which says nothing about the nested ones. Do not move to an alpha for this.

## (3) What input reaches the vulnerable code?

- The vulnerable path is **pattern compilation**: only a glob *pattern* with a single-branch repeated extglob can trigger the backtracking (it is the regex built from the pattern that is slow; the string it is tested against has to be crafted too). File names alone cannot create the bad pattern.
- tinyglobby calls `picomatch(...)` and `picomatch.scan(...)` on the patterns it is given (`dist/index.mjs` lines 22, 82, 123, 217-218 of 0.2.17).
- In our chain the only caller is node-gyp 12.4.0, `lib/build.js` lines 87 and 90: `glob('build/*.sln', ...)` and `glob('build/*.mk', ...)`. Both are fixed literals, with no extglob (`+(`, `*(`, `@(`, `?(`, `!(`) in them. Nobody can supply a pattern through Bunny's UI, chat, files or the network.
- The code runs only when `electron-builder` rebuilds native modules during `npm run dist` on a developer or release machine. It is a `dev` dependency (lockfile `"dev": true`) and is not in the packaged installer.
- Practical risk to Bunny: none identified from either the pattern or the input side. A scanner will still flag the version, which is why it appears in the gate.
- Not verified: I did not run the exploit or time any pattern (the brief said run nothing heavy). The claim rests on the advisory text, the 4.0.7 source and the two literal patterns above.

## Options for the owner (recommendation first)

1. **Accept and record (recommended).** Add a dated exception for GHSA-fc5q-39xc-vjpf in the gate's audit step with this note as the reason; re-check when picomatch publishes > 4.0.7. HIGH: changes a security control, needs the owner's go.
2. Wait and `npm update picomatch` the day a patched release lands. Needs nothing else.
3. Not recommended: overrides to an older major, a git SHA, or an electron-builder 27 alpha.
