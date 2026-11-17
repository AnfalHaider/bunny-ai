---
piece: w4-12
role: security
sha: bcca328
verdict: PASS
date: 2026-11-17
---

Supersedes c2da6a8. The added answer is a plain string pushed as one user-role message ({ role: 'user', content }), never tool_calls or another role: the person's typed words (trimmed, cut at 200 characters, from the window-only question route) inside a fixed sentence that quotes the question (server-built, cut at 200; the repeated step name in it is the model's own call text, cut at 60). Only on a carry-on, not for 'Stop here', skipped or background answers. Everything from c2da6a8 stands (typed text reaches only question cards; permission and capability cards unreachable). Tests pass.
