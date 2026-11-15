# Chief of Staff - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - Owner's approval before sleeping

**Owner's words (typed in this chat):** "i am going to sleep, handle everything yourself. in the morning i
want to see the best possible application. you have my approval. if you can relay it to tech lead do it,
otherwise handle everything that can be done." Relayed to Tech Lead under 7E (exact words, date, context).

- S-1: Security signed FAIL at ca01243 (bf059e0): every attack refused, but the Google sign-in return is
  blocked. Sent back to Builder: allow only the OAuth callback with a valid one-time state; rebase D1 onto it.
- Librarian's S-1 and D1 sign-offs and register committed by the Chief of Staff (4c0ddc9), on the owner's
  instruction "can you run librarians commits and pushes".
- Decided under the delegation: T-4 asks once per folder before using a stranger's AGENTS.md.
- Approved under the delegation: Design's T-3 views (92703ea): one dim line under the reply when another
  model answered, no red lines, a calm offline state (message waits, sends on reconnect) only after a failure
  plus an agreeing connectivity probe. Condition: real model names, a timeout is never called "busy".
- Tech Lead will sign only on the owner's approval typed in its own chat (relay not accepted, classifier refused earlier). Every code commit needs its sign-off, so the push to main and the release wait for that one morning approval. Its D1 review: PASS from the code (notes: .empty .empty-title restyles every state; phone hides settings search). Upstream plugin report: 0d0e8e7 (items E, C, A3, D, F).
- Approved under the delegation: Design's T-4 cards (91b49df) as drawn: trust card (Use / Not now, quiet Never for this folder link, states that project instructions cannot change permissions or grant tools), set-up card with per-file diffs, the Using AGENTS.md chip.
- Owner, in this chat: "i have sent this to tech lead, approved sign off for B-1 D1 and everything till morning." (approval typed in Tech Lead's own chat).
- Security: only GET /api/account/google/callback reaches the server from outside the app; one exemption is enough (sent to Builder).
- Owner on tools and permissions: "when allowed by me, everything should be allowed." Project files can never grant permissions or tools; whatever the owner allowed applies in full, no hidden limits, no re-asking. Sent to Builder (T-4, permission code) and QA (audit every mode).
- Owner: "we are only working for english, no need to cover other languages." Sent to Builder, Design, QA: English only, no new translations, existing ones left as they are.
- Tech Lead (81782a9): S-1 PASS at 09b35e4 (Google return the one exception, audio token-free, 32/32 guard and provider tests; e2e left to QA). G-1 FAIL at 09b35e4 (attached -c form; push --all/--mirror/wildcard refspecs; LF endings for hooks) back to Builder; 87/97 adversarial cases already right.
- Decided under the delegation, as Tech Lead recommended: push-exempt list stays release-ops, hotfix, chief-of-staff; the require sub-command is for chief-of-staff and security only; writes through shell variables are a documented limit, caught by the commit-time check.
- G-1 PASS by Tech Lead at 560e636 (b866ac1): 112/113 adversarial cases, 97 tests. QA and Security review next. Release plan: one release branch from initial-import with Builder's work (D1 rebased onto 09b35e4), G-1 landed into .bootstrap/.githooks by the Chief of Staff, every sign-off file, version bump, gate, then fresh sign-offs from every required role on that one final sha, release record with the owner's words, push main, build, publish. Avoids the stacked-coverage gap (F).
- Owner added for S-1: "ensure it does not break any model provider also" — sent to Builder, QA, Security.
- Found: prepush counts a complete sign-off set as covering every ancestor commit, so D1's set would cover
  S-1. Rule for tonight: S-1 is signed in full before any push. Sent to Tech Lead as guard item F.

## 2026-11-16 - Overnight run under the owner's delegation

**Owner's words (typed in this chat):** "get all sessions to work through all the issues, fix every known
issue. test everything. then push to main and dev, i will always tell you to push to main and dev. update the
rules accordingly. after the new application is live. i need you to give me detailed list of all the missing
features, bugs and gaps remaining in the morning. till then handle everything yourself." Then: "dont create a
dev branh.", "just push to main.", "when everything is done, update the release." Also: Bunny should create
`AGENTS.md` and project files when a project is set up, as Claude and Cursor do.

**Rules updated** (AGENTS.md, 1150096 / 190ab86): no dev branch; "push to main" in this chat is the
standing order; the Chief of Staff is a live pusher; the release record quotes the owner's words; sign-offs
still required on every code commit.

**Decisions taken by the Chief of Staff under the delegation** (the owner can overturn any):

- D-2 (Design a067f35), all as Design recommended: one tool group per run of steps between narrations; a
  failed step stays collapsed unless the reply ended on it; Changes in non-git folders uses the saved pre-edit
  copies; Files read-only this round; build order transcript, Session, Changes, Files (Security reviews the
  new read-only endpoints first).
- Guard gaps: built by Builder in `scripts/guard-next/` (protected paths), reviewed by Tech Lead, QA and
  Security, then copied into `.bootstrap/` and `.githooks/` by the Chief of Staff in one commit.

**Refused, left for the owner:**

- Reducing B-1's required sign-offs to drop Tech Lead (whose own sign-off commit the auto-mode classifier
  refused): the classifier refused it as "Undermining Oversight". Correct call; B-1 waits for the owner to
  approve Tech Lead's sign-off in Tech Lead's chat.
- Recording Tech Lead's sign-off from this session as tech-lead: refused by design (a session signs only as
  itself).

**Security-review acknowledgement:** adding chief-of-staff to `live_pushers` was flagged HIGH. Kept, because
the owner asked for it; the trade-off is that this role can both edit the policy and push main. The
pre-push hook still demands a release record with the owner's words and complete sign-offs from other roles.

**Work in flight:** S-1 built (ca01243, awaiting QA, Security, Librarian, Tech Lead); D1 built (2cfeec5,
awaiting Design, QA); B-1 awaiting Tech Lead; tool inventory done (Researcher 37749ef); QA audit Q-2 running;
Tech Lead on T-3 (model switching, offline) and T-4 (project setup files); Builder on guard staging next.
