---
piece: release-0.1.14
role: qa
sha: a579d7e9
verdict: PASS
date: 2026-11-20
---

Real Electron walk of 5fbb7975 plus re-measure on a579d7e9, invented profile only. Re-measured: Code-mode row under the composer at 360x640, 360x740, 390x740, 412x740, 412x915 (light+dark): every control whole on screen, no sideways scroll, nothing cut; the row now wraps to two lines on phones (one line at 720 and in Chat mode at 360/390/412) - the earlier right-edge cut (F3) is gone. Settings > Engines with Bunny's engine off at 1100 and 390, light+dark: warning and rules box shown, every field inside the screen, no sideways scroll; dark warning text read by eye on the picture (my script's 1.68 contrast number is a measurement artifact of a translucent background, not a measured pass). Earlier on 5fbb7975: desktop 1024/1280/1920 clean, devices chip, tight rows, Engines items, Search this PC 6/6 at 000bfd8. NOT covered (UNKNOWN): real engine download and sign-in, real phone address bar/keyboard/safe areas, real notification toast and open-at-login, Search this PC through a chat on the real index, pane states Changes/Browser/Files/Tasks at phone width, About licence link cut near 720 px (noted for v0.1.15).
