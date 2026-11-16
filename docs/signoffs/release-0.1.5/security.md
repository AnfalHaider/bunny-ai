---
piece: release-0.1.5
role: security
sha: e94f224
verdict: PASS
date: 2026-11-16
---

Re-tested at e94f224 on an invented profile: request guard (no or wrong token, bad Host by raw socket, foreign or null Origin, cross-site, preflight, Google callback only with a live state) all refused; folder gate (desktop passes folderPickerOnly true and records the picker answer; typed folders 403 on chats, projects, schedules and folder check; drive root and data folder refused; picked folder works); Plan refuses move_to_new_chat; network probe and token re-read unchanged. Code since the D-2 PASS at 98ee19a is only the version and one css rule. Known and not blocking: G1-1 gh release and pr merge unguarded, G1-2 records unchecked at commit, Auto mode asks nothing for new tools schedules and local connectors (owner decision), Plan mode also refuses ask_user, the landed guard now blocks commit messages that mention the skip flag. Not tested: a real packaged run, real Google sign-in, a real provider key.
