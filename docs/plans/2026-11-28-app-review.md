# App review: function test, simplification, parity with the Claude app, autonomy

## The owner's request (2026-11-28, typed in the Chief of Staff's chat)

"now before we do anything new, i want a test of the application, weather all features work the way they are supposed to, what can be simplified and what can be improved, basically what i am striving for is parity with Claude app. also i want bunny to be powerful enough to work on its own and smart."

## Who does what (read-only reviews of main @ bb229a0f)

| Part | Who | Output |
|---|---|---|
| Function test: every feature (works / broken / unclear) | QA | docs/reviews/2026-11-28-qa-function-test.md |
| Parity matrix against the Claude app, plus autonomy against Claude | Researcher | docs/reviews/2026-11-28-parity-matrix.md |
| Architecture: autonomy, simplification, recurring bug classes | Tech Lead | docs/reviews/2026-11-28-tech-lead-architecture.md |
| UX simplification against the Claude app | Design | docs/reviews/2026-11-28-design-ux.md |
| Guardrails for more autonomy | Security | docs/reviews/2026-11-28-security-autonomy.md |

## Real-model tests: the owner's word

- Question asked: "To test whether Bunny can really work on its own (multi-step tasks, choosing tools, recovering from errors), QA needs a real model. Test mode only gives canned replies. Tests use a made-up profile, never your real Bunny data, and your keys never leave your real profile. Which model should QA use?"
- Answer: "use my installed app, it has all the keys."
- This is a one-off exception, for this test only, to the "invented profile" rule (AGENTS.md, REAL row). The conditions:
  - one new project, "QA test 2026-11-28", working only in C:\Work\bunny-qa-test;
  - QA reads only what it creates, and never the owner's other chats, memory, projects, attachments or settings;
  - no screenshots or pictures of the installed app go anywhere, including computer use;
  - no setting, provider, key, rule or connector changes;
  - the project is archived after, not deleted;
  - QA proposes its method to the Chief of Staff before running anything.

## Real-model test method: the owner's choice

- QA proposed two methods, and the owner was asked: "...Which way?" Method A: the owner creates one Code chat, and a script drives only that chat with the app's launch token. Method B: the owner types the tasks.
- Answer: "A: script, about 6 tasks (Recommended)".
- The script calls only these routes, for the given chat id: send, stream, answer that chat's cards, and read that chat's messages and Changes. A hard allowlist in the script enforces this. It changes no settings, keys or other chats, and it stops after about 6 tasks. The owner does the 30-second setup in the window and gives the chat id.

## Real-model test: transcripts from the owner

- The auto-mode classifier denied QA's first step outright (finding the installed app's port), with no prompt the owner could approve. QA stopped and did not route around it.
- The owner was asked "What now?" and answered "I'll paste the prompts (Recommended)".
- The owner pastes the 6 prompts (docs/reviews/2026-11-28-real-model-prompts.md) into the installed app and exports each chat to C:\Work\bunny-qa-test\transcripts. QA analyses only those files. Nothing automated touches the real profile.
