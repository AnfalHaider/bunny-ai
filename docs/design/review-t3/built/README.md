# T-3 built states (Builder, invented profile)

Offline: offline-waiting (waiting bubble, calm line, Offline chip), offline-checking, offline-back-sending, offline-cancelled, offline-local-model. Fallback: fallback-meta (the one line under the reply). Light and dark, d = 1440, m = 390.
Not captured: the live "X is slow. Trying Y..." line. It is a status line shown for the few seconds while the next model starts; the scripted run could not hold that moment (this fake profile has too few models to switch between). It is asserted in e2e/t3-offline.spec.js ("is slow. Trying ..." then the one line under the reply).
On a phone the status line sits in the top bar, which is hidden at 390 wide, so offline-checking, offline-back-sending, offline-cancelled and offline-local-model show no text there: a design question.
