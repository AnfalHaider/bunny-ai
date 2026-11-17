---
piece: w6-15
role: qa
sha: 304e71a
verdict: PASS
date: 2026-11-17
---

W6-15 at 304e71a, rows W615. check_environment lists node, npm, git, python (pnpm) with versions; reads package.json engines, .nvmrc, .python-version and pyproject requires-python and says what to do when node 999, python 9.9 or nvm 99 is asked; an easy requirement is met; a folder named package.json and a file over 64 KB are not read; a path outside the workspace is refused; a sub-folder path works; it is a read tool and runs in Manual with no card.
