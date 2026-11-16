---
piece: d-2
role: security
sha: 98ee19a
verdict: PASS
date: 2026-11-16
---

Re-tested on an invented profile: desktop app now creates the app with the folder picker gate on and records the picker answer (read at the sha); typed folders refused on check, chats, projects and schedules (403), picked folder works, drive root and data folder refused, files and dot git handling as before, junction leak gone, 1 MB read cap. Not a blocker: Plan mode now also refuses ask_user and create_artifact (risk own), which probably is not intended.
