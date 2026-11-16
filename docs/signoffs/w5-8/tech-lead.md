---
piece: w5-8
role: tech-lead
sha: 349061d
verdict: PASS
date: 2026-11-16
---

Delta 70bd964..349061d. The release now needs: origin/main fetched and equal to the target, HEAD equal to the target (the installer is built from the checked-out files), a clean tree counting untracked files, dist/build-sha.txt equal to the target (npm run dist clears it first and stamps the sha afterwards; a tree with changes is stamped -dirty and never matches), and only --notes-file passed on to gh (no --repo, --draft, --prerelease). A dry run reports every failing check at once and treats the role as a note. Probed: a dry run from a scratch checkout lists the not-origin/main, missing build-sha and missing installer files together; unit tests 18 pass, 0 fail. This closes the dist-not-tied-to-the-sha gap I noted. Note: npm run build:css rewrites src/ui/app.css, so a stale committed app.css makes the build dirty and the release refuses until it is committed, which is the intended effect. e2e not run by me.
