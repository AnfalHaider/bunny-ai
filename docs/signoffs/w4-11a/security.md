---
piece: w4-11a
role: security
sha: 71f2f96
verdict: PASS
date: 2026-11-17
---

Names: fuzzed 3,000 random connector sets (22,646 tools, long names, dots, slashes, accents, clashing prefixes): every offered name is unique, matches [a-zA-Z0-9_-]{1,64}, and maps through the index to exactly its own (server, tool); no pair lost or doubled; a clash only ever renames the LATER tool (_2), the earlier connector keeps its bare name; Plan mode offers read-only tools only. A hash collision cannot map wrong because uniqueness is enforced on the final name, not on the hash. toolPrefix collapses underscore runs, so connector names (prefix__tool) cannot equal a built-in name (none contain a double underscore) or a model-built my_<name> tool. Reuse, don't own: a plugin connector whose address matches an existing one (other case, trailing slash) is not added and not recorded; real uninstall removed only the plugin's own connector and skill, the person's connector stayed and was not signed out. 41 tests pass. Observations, not blockers: the duplicate check misses other spellings of an address (default port, query order, localhost vs 127.0.0.1), harmless because names stay unique. Pre-existing, separate row (MEDIUM): a connector decides its own tools' readOnly flag (annotations.readOnlyHint, mcp.js:108 and mcpLocal.js:187), so a hostile connector can mark a write tool read-only and skip the question in Ask mode and be offered in Plan mode.
