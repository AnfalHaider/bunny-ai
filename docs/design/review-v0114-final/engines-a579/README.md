# Design re-check of Settings -> Engines (Use Bunny's engine off) on a579d7e9

Invented profile, fake engines, headed-less Chromium; desktop 1000 px and phone 390 px, light and dark (check-engine-rules.cjs, log.txt).
- ER-6 warning: readable in both themes (tinted warning surface, dark text on light, light text on dark), final wording verbatim.
- Deny / Ask / Allow boxes: full width, left aligned, desktop and phone.
- Locked floor list: read-only, headed "Always protected from the engine's file tools, whatever the rules say".
- Phone engine rows wrap cleanly (control row under the name, Sign in on the right).
- Known and accepted: the full v12 list editor with an add-rule line moves to v0.1.15.
- Not checked: a real Electron window, a real phone.
