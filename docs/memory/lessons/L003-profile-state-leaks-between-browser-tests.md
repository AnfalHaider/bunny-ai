---
id: L003
date: 2026-11-12
session: builder
title: Profile state leaks between browser tests
triggers: [playwright, e2e, isolation, settings, profile]
files: [e2e/helpers.js, e2e/app.spec.js, e2e/automation.spec.js, e2e/shell.spec.js]
cost: 40m
evidence: 'e2e/features.spec.js failed on three tests in a row until each test disconnected the providers and deleted the sessions it had made; the language test then failed because a previous test had left the interface in French.'
status: live
---

Every test in a run shares one server, and so one profile. A test that
connected a provider, changed the language, or wrote a memory changed every
test after it. The failures looked like bugs in the feature ("the toggle is
always on", "the chat list is empty") and were really leaks.

**Why:** `BUNNY_RESET_PROFILE=1` empties the profile when the server starts,
not between tests. A browser suite that starts one server inherits everything
the earlier tests did.

**How to apply:** give the suite a `beforeEach` that puts the profile back
exactly as it was — providers disconnected, sessions, artifacts, projects,
memories, schedules, hooks and skills deleted, settings reset to their
defaults. Do it through the same public API a person uses, so the cleanup
itself is evidence that the API works.
