# Why permission-rules.png and settings-wait.png were drawn again (01dce6d)

Both pictures are an element crop of one section of the Settings page (the page is opened whole, the section is scrolled into view and its box is captured).
Nothing inside the two crops changed. What changed is the page above them.

- SEARCH-PC (cb389e3, c051ca5) added its "Search this PC" rows to the **Capabilities** section of `src/ui/settings.html`, which grew from 924.84 px to 1540.95 px high.
- The Models section (settings-wait) therefore sits 616.11 px lower on the page: top 4445.203 px before, 5061.313 px after. The Code section (permission-rules) sits below it and moved the same way.
- The element crop starts at a different fractional pixel, so the same text is rasterised at a different sub-pixel offset. That is the whole difference: anti-aliasing along the edges of the letters, the 1 px height rounding of the Models crop (981 to 982) and the 1 px of the permission-rules crop (1739 to 1738). The words, controls and colours are the same.
- Measured by loading the page at builder-b-picture-check (before) and at claude/v0114-integration (after), same invented profile, same viewport (860x900), after `document.fonts.ready`.

`permission-rules-diff.png` and `settings-wait-diff.png` mark in red every pixel that differs between the old and the new picture (a difference above 24 over the three colour channels). The red sits only on single text lines, none on a control, an edge or a colour: the sign of a sub-pixel shift, not a changed screen.

This is deterministic, not a flake: the picture check failed identically on every run from the merge 2bad182 on, and the pictures project on builder-b-picture-check alone passes 14 of 14.
