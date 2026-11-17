---
piece: w6-16
role: tech-lead
sha: 81fddb6
verdict: FAIL
date: 2026-11-17
---

Server side matches the spec: scope.js inScope compares as paths (A and A\sub yes; B, A2 and no folder no; empty list = everywhere, so old data is unchanged); a new folder must be one the person picked (checkedScope, 403 otherwise), and removal is unchecked; skills.context, the /skill call, read_skill and the connector list (so call_connector_tool's deferred set too) are all filtered by the chat's real folder; plugin scope is applied to its skills and connectors, including on update (W616-1). Run alone at 81fddb6: node --test test/w6-16-scope.test.js: 11 tests, 11 pass, 0 fail. REQUIRED: src/ui/app.css gains .cz-scope, .cz-scope-label and .cz-extra, which are in neither docs/design source, so app.css at 81fddb6 no longer equals its build (the plan's rule; the v0.1.8 loss). Fix: move the three rules into docs/design/bunny-app-bindings.css and run npm run build:css. Not blocking: a plugin PATCH with folders returns before it reads enabled, so a body with both changes only the folders. e2e/w6-16-scope.spec.js not run by me.
