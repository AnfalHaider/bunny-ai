---
id: L009
date: 2026-11-16
session: chief-of-staff
title: Assemble a release by replaying docs-only sign-off commits, not by merging the sign-off branches
triggers: [release, merge, signoff, pre-push, hotfix]
files: [.bootstrap/bin/prepush.mjs]
cost: one refused push to main and a rebuilt release branch (about 10 minutes)
evidence: 'Pushing release/0.1.6 to main, the pre-push hook refused 9363c59, an octopus merge of the QA, Tech Lead and Librarian sign-off branches onto dfebea3: "no release record lists 9363c590a4c3, the newest code commit" and "1 code commit(s) have no complete sign-off". Rebuilt as release/0.1.6-main by cherry-picking the 12 docs-only commits onto dfebea3; pushed e3c3157..dfac0db.'
status: live
---

**What happened.** The reviewers cut their sign-off branches from the old main. Merging them onto the candidate made a merge
commit whose diff against those parents contains the candidate's code, so the hook counted it as a new code commit with no
sign-off and no record. The hook was right: the signed sha was no longer the newest code commit.

**Rule.** Build the release line from the signed candidate sha and cherry-pick the docs-only sign-off, record and notes commits
on top. Check with `git diff --name-only <candidate> HEAD | grep -v '^docs/'` (it must print nothing), then
`bootstrap status`, then push. Never merge sign-off branches into a release line.

**Why it matters.** The signed sha must stay the newest code commit on main, or the sign-offs no longer describe what ships.
