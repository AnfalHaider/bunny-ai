---
id: L008
date: 2026-11-16
session: librarian
title: A shared test fixture can hide the default path
triggers: [playwright, e2e, fixture, default, settings, models, first-run]
files: [e2e/helpers.js, e2e/models-default-filter.spec.js, src/ui/chat.js, src/server/app.js]
cost: unknown
evidence: 'e2e/helpers.js sets modelFilter all for every test, so the default first run (modelFilter unset, the Free and Nvidia filter) was never exercised. W0-4 (1456b5a) added e2e/models-default-filter.spec.js, whose comment says every other e2e test sets modelFilter all. Found by the Librarian review of the W0-4 commit, not by the gate.'
status: live
---

**What happened.** The browser suite used one shared fixture that set the model filter to
"all" for every test. That was convenient, and every picker test passed. But the filter
"all" is not what a new person sees on first run: the default shows only free and Nvidia
models. A fresh profile that connects one provider had an empty picker, and no test
reached that path.

**The rule.** A fixture that changes a default changes what the suite can see. When a
shared setup overrides a default, list the default path separately and give it at least one
test that leaves the default alone. Do not assume the all-tests run covers the first run.

**Why:** the bug lived in the state the fixture removed. A green suite with the default
overridden everywhere is a suite that never looked at the default.

**How to apply:** when you add a fixture or a helper that sets a setting for every test,
ask which default it hides. Add one spec that runs the untouched default and checks the
first thing a new person sees.
