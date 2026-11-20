# INSTALL-ANYWHERE: plugins, tools, skills and connectors from any website

Tech Lead, 2026-11-20. v0.1.15.

- **Risk: HIGH.** It widens what code and instructions can come from the internet. The owner's words are the go for the direction. Security reviews this spec, and the built code, before it is integrated.
- **It builds on:**
  - F10's one card (owner's yes, "Yes, one card", 84b1fef1; Security F10-1 to 3);
  - F4's better search (Builder C);
  - PG-1's website rules, if the owner adds them;
  - P-6: nothing the model adds is on without the window's yes.

## The owner's words (typed in the Chief of Staff's chat, 2026-11-20)

> "plugins, tools, skill, MCP servers can be from any website if required,"

## 1. Today (code at e2ec6ec6, read only)

| Kind | Where it can come from today | Pinned? | Code |
|---|---|---|---|
| **Plugin** (skills, commands, agents, remote connectors) | **GitHub only.** `parseGithubUrl` is required, and the tree is read through the GitHub API at a ref. | at a **ref** (a branch or tag), **not a commit** | `pluginImport.js:61-75` |
| **Skill alone** | `add_skill`: text the model writes, about 1,500 characters at most. | n/a | `appTools.js:33` |
| **Remote connector** | `add_connector` with **any http or https address**, any host (`mcpStore.js:138`, `/^https?:\/\//`). | n/a | |
| **Local connector** | `add_connector` with one of `npx`, `node`, `uvx`, `python`, `python3`, `docker` (`mcpLocal.js:26`) and free arguments. `npx -y <pkg>` runs **whatever version the registry serves that day**. | **no** | |
| **Tool from source** | `install_from_github`: a public GitHub Node MCP server, at an **exact commit**, `npm install --ignore-scripts`, in Bunny's tools folder. | yes, by commit | `toolInstall.js`, W6-6 |
| **Search** | GitHub (anonymous) and the MCP registry, remote servers only. | | `pluginImport.js:172-204` |

### Findings for Security, today

1. **Remote connector addresses aren't checked against private addresses.**
   - `fetchLimited`'s refusal (`download.js:46`, `:78-87`) is not used by `mcp.js`.
   - So a model-proposed connector at `http://127.0.0.1:…`, a LAN address, or a host that resolves to one is accepted (off until switched on, P-6), and is then called.
   - `http:` (no TLS) is accepted too.
2. **`npx -y <pkg>` / `uvx <pkg>` local connectors run an unpinned package at every start.** What runs can change after the card was shown.

This spec closes both.

## 2. One pipeline for every source

Every install, from any source, goes the same way:

```
find  ──>  fetch (bounded)  ──>  pin  ──>  unpack (safe)  ──>  inspect  ──>  ONE CARD (F10)  ──>  install exactly what was shown  ──>  off/on per the card
```

### 2.1 Find (a)

`search_plugins` returns candidates in this order, each marked with its source:

1. the **curated list** (F4);
2. **GitHub** (F4, with the person's token when signed in);
3. the **MCP registry**: remote servers, **and** npm and PyPI packages, which F4 skipped (§2.6);
4. the **open web**: `web_search` for `<query> MCP server`, `<query> SKILL.md` and `<query> claude plugin`. These results are cleaned like web results and shown as links with the page title. They are **candidates only**: nothing from a web result is installed without the pipeline below.

### 2.2 Fetch: bounded, public, https

- **Every network read** goes through `fetchLimited`:
  - **https only**. `http:` is refused for anything installed;
  - public addresses only, checked after DNS and at every redirect;
  - a 15 s timeout per request;
  - the person's PG-1 website rules, if the owner adds them, judged at every hop (PG1-a to PG1-d).
- **Size limits:**

  | What | Limit |
  |---|---|
  | one `SKILL.md` or single text file | 256 KB |
  | one archive (zip, tar, tar.gz, tgz) | 50 MB downloaded, 200 MB unpacked, 5,000 entries, ratio at most 100:1 per entry |
  | a git clone (any host) | `--depth 1` at the pinned commit, 200 MB checked out, 5,000 files |
  | a package tarball (npm, PyPI) | 50 MB, and the same unpack limits |

  Any limit hit stops the install, names the limit, and leaves nothing behind.

### 2.3 Pin: the exact source, shown and kept

| Source | The pin | How |
|---|---|---|
| A git host (GitHub, GitLab, Bitbucket, Codeberg, any `https://…/*.git`) | **a 40-character commit** | `git ls-remote <url> <ref>` resolves the commit; then `git clone --depth 1` and `git checkout <sha>` run with `GIT_TERMINAL_PROMPT=0`, `-c protocol.file.allow=never`, `-c core.hooksPath=<empty dir>` and no submodules. **GitHub plugins move from a ref to a commit too.** |
| An archive at an https address | **its sha256** | It is hashed as it downloads, and the hash is shown on the card. Installing re-checks the same bytes, kept in a temp folder between card and install (never fetched twice). |
| A single `SKILL.md` | its sha256 | The same as an archive. |
| An npm package | **name, exact version, and the registry's `dist.integrity` (sha512)** | `https://registry.npmjs.org/<name>/<version>`. A version range or `latest` is resolved to the exact version first. |
| A PyPI package | **name, exact version, and the wheel's or sdist's sha256** from `https://pypi.org/pypi/<name>/<version>/json` | |
| A remote MCP server | its **exact https address** (after redirects), and the host's TLS name | An address can't be pinned to content, so the card says: "This service can change what it does at any time." |

**The pin is kept in the install record** (`source: { kind, url, commit | sha256 | version + integrity, fetchedAt }`) and shown in Customize.

### 2.4 Unpack, safely

- **Unpack into a new temp folder** under Bunny's data folder. Each entry is checked before it is written:
  - **No path escape:**
    - no absolute paths, no drive letters, no `..` after normalising;
    - no names that `badName` (`staging.js`) refuses (reserved Windows names, alternate data streams, names ending in a dot or a space).
  - **No links of any kind:** symlinks, hard links and junctions in tar or zip are skipped and named. Nothing is ever followed.
  - **No special files:** devices, FIFOs and sockets are skipped.
  - **Case clashes on Windows** (`A.md` and `a.md`) stop the install.
- **Nothing runs at install time:**
  - no `npm install` scripts (`--ignore-scripts`, as W6-6 does);
  - no `setup.py`, no `postinstall`, no `.bat`, `.cmd` or `.ps1`;
  - no git hooks (the empty `core.hooksPath` above), no LFS smudge filters (`GIT_LFS_SKIP_SMUDGE=1`) and no attribute filters (`-c filter.*` off).
  - The parts are only **read**.

### 2.5 Inspect: what the source holds

- **Read with the existing importer** (`pluginImport.js`'s layout: `SKILL.md`, `commands/*.md`, `agents/*.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`, `.mcp.json`), now working on the unpacked folder instead of the GitHub API.
- **The same caps as today:** 40 skills, 120,000 characters per skill, and the `extraLeft` notes.
- **What may be added:**
  - **Remote connectors** from `.mcp.json` are listed with their exact addresses, and each address goes through §2.2's rules (https, public, PG-1).
  - **Local connectors** from `.mcp.json` are listed with their exact command and arguments. They are allowed **only** in the pinned forms of §2.6; anything else is listed as "not imported: runs a program Bunny can't pin".
- **Hooks, scripts and binaries** (`hooks/`, `*.exe`, `*.dll`, `*.ps1`, `*.sh`, `bin/`) are listed as **"not imported"** and are never kept.

### 2.6 Local connectors from npm and PyPI (e)

- **npm.** A pinned `name@version` is installed into Bunny's tools folder:
  - Bunny fetches the tarball, checks `integrity`, and unpacks it under §2.4.
  - It runs `npm install --ignore-scripts --omit=dev` **only** with a lockfile written from the pinned top version. Dependencies are resolved by npm and recorded in the install record, and `npm audit` runs.
  - The connector runs as `node <bin>` from that folder, never `npx -y <name>`.
  - A package that needs its install script to work is reported: "needs an install script, which Bunny doesn't run".
- **PyPI.** A pinned wheel (preferred) or sdist:
  - It goes into a dedicated venv under Bunny's tools folder: `python -m venv`, then `pip install --no-deps <the pinned file>`. Its dependencies come from the wheel's metadata, each pinned with `--require-hashes`.
  - **An sdist (which runs `setup.py`) is refused.** The card names this. Wheels only.
  - It runs with the venv's `python -m <module>` or its console script.
- **Docker images** stay as today, a person-only path in Settings. They are not part of this spec.
- **Existing `npx -y` and `uvx` connectors** keep working. New model-proposed ones are converted to the pinned form, and the card says so.

### 2.7 The one card (F10, Security F10-1 to 3)

The card shows:

- **the source and the pin:** host, commit, sha256, or version and integrity;
- **its size**, and "fetched just now";
- **every part that will be added, by name:**
  - for each skill, its first 600 characters and a "read all" link;
  - each remote connector's exact address;
  - each local connector's exact command line, and the folder it runs in;
- **the "not imported" list:** hooks, scripts, binaries, and unpinnable local commands;
- **for remote MCP servers:** "This service can change what it does at any time";
- **for any local connector:** "This runs code from the internet on this computer";
- the open-web case (a source found by `web_search`, not on the curated list, GitHub or the registry), marked **"Found on the open web: not from a known catalogue"**.

The buttons:

- **Install and switch on**: switches on exactly the parts listed (F10-2);
- **Install, keep off**;
- **Don't install**.

When the list is too long to show whole, there is no switch-on button (F10-1). The card is answered only in Bunny's window. Devices can't install (F10-3).

### 2.8 Install exactly what was shown

- **What is installed** is the temp folder that was inspected, moved into place, and only the listed parts.
- **For a git source,** the commit checked out is the pinned one (checked again with `git rev-parse HEAD`).
- **If anything differs** (a hash, a commit, or the part list), the install stops with "The source changed after you looked; nothing was installed".
- **Updates are never automatic.** "Check for updates" in Customize runs the whole pipeline again, with a new card.

## 3. The model's tools

These replace today's GitHub-only tools.

| Tool | Takes |
|---|---|
| `install_plugin({ url })` | a git URL (any host), a GitHub, GitLab or Bitbucket page link, or an archive URL |
| `install_skill({ url })` | a `SKILL.md` address, or an archive or repository holding skills. `add_skill` stays for text the model writes. |
| `add_connector({ name, url })` | remote: **https and public only** now |
| `add_connector({ name, npm: 'name@version' })` or `({ name, pypi: 'name==version' })` | local, pinned (§2.6) |
| `install_from_github` | stays; it becomes the git-host case of `install_plugin` for a Node MCP server, and keeps its name for compatibility |

- **Risk:** every install tool is `'build'` from here on. That means a card in every mode, Auto included. It is never skipped by a rule, an F9 kind or F11's judge, and Plan mode refuses it.
- **Devices** are refused, as today (`REMOTE_TOOLS_DENIED`).

## 4. Website rules (PG-1), if the owner adds them

- A **deny** host can't be a source, at any hop, for search candidates, fetches, clones, packages or a remote connector's address. Search lists it as "blocked by your rule".
- An **ask** host shows its own line on the card ("Asked because of your rule <host>"). There's no extra card: the one card is the question.
- An **allow** host never skips the card, the pin, the unpack checks or the private-address refusal (PG1-b).
- **Without PG-1,** §2.2's rules alone apply.

## 5. What stays the same

- **P-6:** nothing the model adds is on without the window's yes.
- **The floor, Plan mode, devices and the SEARCH-PC taint:** an install is a `'build'` action, so it needs a click while tainted.
- **The person's own Settings → Customize add-by-hand** stays as it is, including Docker and private addresses, which the person may want for their own servers. This spec covers what the **model** proposes. The same pipeline is offered as "Add from address" in Customize.

## 6. Tests

### Unit

`test/install-anywhere.test.js`: every fetch is stubbed, `no-network.mjs` stays on, and all folders are invented temp folders.

1. **Search order:** curated, then GitHub, then registry remotes and packages, then web candidates, each marked. A web result alone installs nothing.
2. **Fetch:**
   - `http:` is refused;
   - `127.0.0.1`, `10.x`, `169.254.x`, `::1` and a host resolving to one are refused, including at a redirect hop;
   - each size limit is hit and names itself, and nothing remains in the temp folder.
3. **Pins:**
   - a git ref resolves to a commit, and the clone is checked at that sha;
   - an archive's sha256 is shown and re-checked, and changed bytes between card and install stop it;
   - an npm range resolves to an exact version with its integrity, and an integrity mismatch stops it;
   - a PyPI sdist is refused, and a wheel is checked by its sha256.
4. **Unpack**, each with its own tar and zip fixtures:
   - `../x`, `C:\x`, `\\?\…`, `CON`, `a:stream` and `name.` are refused;
   - a symlink, a hardlink and a junction entry are skipped, and nothing outside the temp folder is written;
   - a case clash stops the install;
   - a zip bomb (ratio over 100:1) stops it;
   - more than 5,000 entries stops it.
5. **Nothing runs:**
   - a package with `postinstall`, a repository with a `post-checkout` hook, an LFS pointer and a `.gitattributes` filter each run nothing;
   - a marker file the script would write is absent.
6. **Inspect:**
   - hooks, `*.exe` and `bin/` are listed "not imported" and are absent after install;
   - an `.mcp.json` remote at `http://` or a private address is listed as refused;
   - an `npx -y` local entry is listed "not imported" unless pinnable.
7. **The card:**
   - it shows the pin, every part and the not-imported list;
   - a part added to the source after the card stays off and isn't installed;
   - "Install, keep off" leaves everything off;
   - "Don't install" leaves nothing behind.
8. **Remote connectors:** `add_connector` with `http://`, a private address, or a host that resolves to one is refused, closing today's finding 1.
9. **Every mode:** in Auto with an allow rule on `*`, an F9 kind and an F11 allow verdict stubbed, the install card still shows. A device is refused, and Plan refuses.
10. **PG-1 (if built):**
    - a deny host is refused at a redirect hop;
    - an ask host shows its line on the card;
    - an allow host still gets the card.

### End-to-end

Invented profile, with a stand-in https server on the test's own trusted loopback:

- **Install a skill from a `SKILL.md` address:** the card shows the sha256, Install and switch on, then the skill is listed and on.
- **Install a plugin archive** with a skill, a remote connector and a `hooks/` folder: the card lists 2 parts and "hooks: not imported", and after install the hooks folder doesn't exist.
- **Install a pinned stand-in npm package** as a local connector: its tool is usable in the same reply (F1).
- **Pictures:** each card variant, desktop and phone, both themes.

The loopback stand-in uses the tests' existing `BUNNY_ALLOW_LOOPBACK_DOWNLOAD` switch, which is test-only.

### QA functional check

On an invented profile:

1. Ask Bunny for "a skill that writes release notes". It finds candidates and shows one card with the source and pin. Install and switch on, and it works in the same reply.
2. Ask it to add an MCP server by an https address, and check the "can change at any time" line.
3. Ask for an npm-based connector. The card shows the version and integrity, and it runs.
4. Try an `http://` address and a `localhost` address. Both are refused with a plain reason.
5. In Customize, check that each item shows its pin, and that "Check for updates" shows a new card.

## 7. Help (O7)

A help section "Add skills, plugins and connectors from anywhere". It covers:

- the one card;
- what pinned means;
- what is never run at install;
- that a remote service can change;
- that model-proposed sources must be public https;
- how to add a private server yourself in Customize.
