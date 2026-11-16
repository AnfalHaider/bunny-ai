# T-3 built states (Builder, invented profile)

Offline: offline-waiting (waiting bubble, calm line, Offline chip), offline-checking, offline-back-sending, offline-cancelled, offline-local-model. Fallback: fallback-meta (the one line under the reply) and fallback-live (the calm "X is slow. Trying Y..." line during the switch, with the purple bunny). Light and dark, d = 1440, m = 390.
At 390 the status text shows as one dim line above the composer (the top bar hides it at that width); at 1440 it stays in the top bar.
fallback-live is written by e2e/t3-offline.spec.js with T3_SHOT, T3_SCHEME and T3_WIDTH set (not part of the gate).
