# Memory

- `lessons/L###-slug.md` — one immutable file per lesson. Find with `mem find <topic>`; never read them all.
- `logs/<role-id>.md` — one log per session, newest entry on top; only that session writes it. The top entry is its hand-over.
- `INDEX.md`, `LAST_REPORT.md` — GENERATED (`mem index`, `mem report`). Never hand-edit; re-run on conflict.
- `mem check` — fails on stale paths, malformed frontmatter and conflict markers. Stale memory is worse than none, because it is trusted.

## Open threads
