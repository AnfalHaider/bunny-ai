# Design check of BANNER-NOTICE on 25e2a92 (includes 47d0951), invented profile

Matches the approved drawing (Version 3, BN-1 to BN-5): the notice floats under the top bar and pushes nothing down; the chip sits left of Export ("Open to devices", "Open to devices · 1", red "<device> has Everything", short forms "Open · N" and "Everything" on a narrow window); x dismisses and a click on the chip brings it back; a reload brings it back; the plain banner hides itself after 10 s and the Everything one does not; the device page shows "You have Chats access" (nothing left behind when dismissed) and a red "Everything" chip at Everything. Run: node ../check-notice.cjs <this folder> <main port>; results in log.txt.

Differences: none from the drawing. Seen in passing (phone layout, not this change): at 390 px the top bar's tool icons run off the right edge and the chat title is pushed out by the chip.
