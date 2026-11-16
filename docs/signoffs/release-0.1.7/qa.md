---
piece: release-0.1.7
role: qa
sha: 91b659f
verdict: PASS
date: 2026-11-16
---

Supersedes my PASS at bf83b01. 91b659f is bf83b01 plus docs and the build fix (git diff bf83b01 91b659f for code: package.json 7 lines, scripts/build-css.mjs 3 lines). The two checks asked for: (1) the app's look is unchanged: src/ui/app.css is not in the diff; a rebuild with the new build:css produces a file BYTE-IDENTICAL to the committed one (cmp says identical, 134,628 bytes, LF, zero carriage returns), and the committed file is the same as at bf83b01 ignoring line endings (same hash). (2) unit tests at 91b659f: 742 tests, 734 pass, 0 fail, 8 todo, 107 s. package.json parses, version 0.1.7, and the new publish block (github, AnfalHaider, bunny-ai) plus electron-builder --publish never were read; I did not run npm run dist or electron-builder. CAVEAT THE FIX DOES NOT FULLY MEET ITS OWN AIM: on a fresh Windows checkout with core.autocrlf=true (this machine), the working app.css is CRLF; after npm run build:css it is rewritten as LF with identical content, but git status --porcelain reports M src/ui/app.css (git diff --quiet exits 0 and the bytes equal the committed blob; git add clears it with nothing staged). scripts/release.mjs reads git status --porcelain, and in a fresh worktree its gatherGitState returns dirty = true right after build:css, so a release run after npm run dist would still be refused as uncommitted changes. A fix that works: in scripts/build-css.mjs skip the write when the existing file equals the new output ignoring line endings (tested: status stays clean); workaround today: run git add on src/ui/app.css (nothing gets staged) before releasing. Not done: a full gate, e2e, dist, Electron, a real release.
