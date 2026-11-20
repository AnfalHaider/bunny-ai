# INSTALL-ANYWHERE (HIGH): Security's required changes

Security, 2026-11-20. Spec: `docs/plans/INSTALL-ANYWHERE-spec.md` at 85ffd247 (`claude/tech-lead-v0115-specs`). Spec review only; Tech Lead's two code findings checked against the code at 85ffd247.

**Verdict:** the pipeline is the right shape. Find, bounded fetch, pin, safe unpack, inspect, one card, then install exactly what was shown: that is what I'd ask for. It may go ahead with the changes below. Finding (1) should be fixed **before v0.1.15 ships**, separately from this spec (IA-0).

## IA-0: fix finding (1) now

The finding is confirmed in two places:

- `mcpStore.js:138` accepts any `^https?://` address;
- `mcp.js` `send()` calls plain `fetch`, so there is no private-address check and the default redirect policy follows a redirect anywhere.

A model-proposed connector arrives off (P-6), but once it is switched on it can reach:

- `127.0.0.1` (Bunny's own server, the engine bridges and endpoints, other local services);
- the LAN (routers, NAS);
- the cloud metadata address `169.254.169.254`;
- through a DNS name that resolves to any of these.

**The fix for v0.1.15:**

1. **When it is added.** For a **model-proposed** connector (the `add_connector` tool, and every `.mcp.json` remote in an imported plugin), refuse:
   - anything but `https:`;
   - any host that is, or resolves to, loopback, private, link-local, ULA, CGNAT or unspecified. Use the same test as `fetchLimited` (`download.js`), applied to every resolved address.
   - The refusal says: "Bunny adds a connector the model found only at a public https address. To add your own server, use Settings › Customize."
2. **When it is called.** For **every** request to a model-proposed connector:
   - resolve the host with the pinned lookup `fetchLimited` uses, and refuse a private result. This covers DNS rebinding after the add.
   - use `redirect: 'error'`, or follow by hand with a re-check at each hop.
   - The OAuth discovery and token requests for that connector follow the same rule.
3. **Added by the person.** A connector the person adds in Customize keeps today's rule: private addresses and `http:` are allowed, because it's their own server. The row is marked "private address" or "not encrypted (http)". The record keeps `addedBy: 'person' | 'model'`. Only the window can set `'person'`, and a model-proposed entry can never become one.
4. **Tests:**
   - `http://`, `127.0.0.1`, `[::1]`, `10.x`, `169.254.169.254`, and a name that resolves to `127.0.0.1`, are each refused for the model;
   - a redirect from a public host to `127.0.0.1` is refused at call time;
   - a person-added `http://localhost` still works, with its mark.

## The pipeline

### IA-1: git fetches don't use the person's git setup or credentials

git does its own networking, so `fetchLimited` doesn't cover it.

- **Before cloning,** Bunny resolves the host and refuses a private result.
- **Every git call runs with:**
  - `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<an empty file>` and `HOME` set to an isolated folder. Then the person's `url.*.insteadOf`, hooks, credential helpers and proxies are never used.
  - `-c credential.helper=`, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never` and `GIT_ASKPASS=` (empty). The person's stored GitHub or Azure credentials must never be offered to an arbitrary host.
  - `-c protocol.allow=never -c protocol.https.allow=always`, `-c http.followRedirects=false`.
  - `-c core.fsmonitor=`, `-c core.hooksPath=<empty dir>`, `--no-recurse-submodules`, `-c submodule.recurse=false`.
  - `GIT_LFS_SKIP_SMUDGE=1`, and no `filter.*` driver.
- **Test:** a clone from a stand-in host that asks for credentials gets none, and fails.

### IA-2: npm locks every dependency at card time

- **The card time step:**
  - `npm install --package-lock-only --ignore-scripts` runs in the temp folder;
  - with `--registry=https://registry.npmjs.org/`, `--userconfig=<empty file>` and `--globalconfig=<empty file>`. The person's `.npmrc` tokens and private registries are never used.
- **The card shows the dependency tree** as a count ("this adds 143 packages"), with the `npm audit` result and any package that ships compiled code (`*.node`, or `binding.gyp` with prebuilt files). A line reads "includes compiled code".
- **Install** is `npm ci --ignore-scripts --omit=dev` with **that** lockfile, re-checked by its sha256. The resolution never changes between card and install.
- **The `bin` path** is resolved inside the package folder (realpath, no escape) before `node <bin>` is recorded.

### IA-3: PyPI takes binaries only, all the way down

- **pip runs with:**
  - `--only-binary=:all:` for **every** package, dependencies included (an sdist dependency would run `setup.py`);
  - `--require-hashes`;
  - `--index-url https://pypi.org/simple`;
  - `--isolated`, so `pip.conf`, `PIP_*` and the person's index settings are ignored;
  - `--no-input`.
- **The card shows** the dependency count and whether any wheel holds compiled code (`.pyd`).

### IA-4: unpacking, stricter

The spec's list is adopted. Also:

- **Real sizes.** Count the **actual bytes written**, not the sizes the headers declare.
- **Zip links.** A symlink in a zip is detected by its Unix mode in the external attributes.
- **Tar names.** PAX and GNU long-name headers are honoured before the path check.
- **Hidden folders.** `.git/`, `.hg/` and `.svn/` folders inside an archive are skipped.
- **Windows short names.** Names that collide under Windows 8.3 short names (`GIT~1`) or after Unicode normalisation (NFC) stop the install, as case clashes do.

### IA-5: what was inspected is what is installed

- Between the card and the install, the temp folder sits in Bunny's data folder. Model file tools can't write there, but a command can.
- At card time, record a **tree hash**: sha256 over every kept file's path and bytes, in sorted order.
- Re-check it immediately before moving the folder into place. If it differs, the install stops with "The source changed after you looked; nothing was installed".
- This extends §2.8 to every source, not only git and archives.

### IA-6: remote connectors after install

- IA-0's checks at each call apply to every remote connector a plugin brings.
- The pinned "TLS name" is the hostname. Bunny doesn't pin a certificate, since that breaks on rotation, and the card shouldn't claim more than that.

### IA-7: open-web sources default to off

- For a source marked "Found on the open web: not from a known catalogue", the primary button is **"Install, keep off"**. "Install and switch on" is still offered, as the second button.
- A skill from a stranger's page rides in front of every later reply once it is on, so the person should choose that on purpose.

### IA-8: never unattended

- Install tools are `'build'`, as specified.
- A **scheduled run** never installs, with the fixed line "Installing needs you; nobody is here to ask".
- **Helpers** can't install (add the install tools to `HELPER_NEVER` if they aren't already).

### IA-9: existing unpinned connectors

Existing `npx -y` and `uvx` connectors keep working, as specified. Customize marks them "not pinned: runs whatever version the registry has today" and offers "Pin this version", which runs the pipeline and shows a card. LOW: this isn't blocking.

## Notes, no change

- PG-1's rules apply at every hop, as §4 says, and an allow never skips IA-0 or IA-1 (PG1-b).
- The person's own "Add from address" in Customize uses the same pipeline, but may target private hosts (IA-0 point 3).
