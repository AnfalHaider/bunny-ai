---
piece: w6-14
role: security
sha: e7b664a
verdict: PASS
date: 2026-11-17
---

Supersedes my FAIL at e037514. W614-1 closed: a card for a local connector, run_command, start_process, create_tool, computer_type or a custom tool over 2,000 characters is refused with a plain message and never shown or run; the length is checked before the rule suffix is added, so the program text is always whole on the card; content-only cards are cut with a visible note. 35 related tests pass. Auto shows no card for run_command by the person's own mode choice, so nothing is hidden there; a rule set to ask still shows a card and is covered.
