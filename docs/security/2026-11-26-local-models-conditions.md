# LOCAL-MODELS (HIGH): Security's required conditions (LM-0 to LM-14)

Security, 2026-11-26. This is a pre-review of Researcher's report `docs/research/2026-11-26-local-models.md` at aace115b, section 5 in particular. It is reading only: nothing was downloaded or run. The plan reviewed:

- a pinned llama.cpp `llama-server`, run as a child process on 127.0.0.1 with a key file, `--no-ui` and no RPC;
- Bunny's own Hugging Face GGUF downloader, with sha256 checks, starting from a curated, non-gated list.

Tech Lead's spec and Design's drawing should follow these conditions. Each one is required unless it is marked "spike first" (prove it in the spike, then it is required) or "later". The build still needs the owner's go, and I sign the build sha.

## LM-0: who can start what

- Only the person, in Bunny's window, can download a runtime or a model, start or stop the runtime, delete either, or add a model that is not on the list.
- These routes go on `WINDOW_ONLY_ROUTES`, and on `deviceRefusal` for both device levels. An Everything device does **not** count as the window here, the same as engines.
- The AI gets **no tool** in v1 to download, choose, start or install a model or runtime. Suggesting one in words is fine.
- A device can chat with a local model that is already running, like any other provider: the request goes through Bunny, never straight to the runtime (see LM-4).

## LM-1: the runtime binary is pinned and checked every time

1. **Pin.** Pin one `bNNNN` tag and the zip asset's sha256 in Bunny's own source (a `pins.json` like the CLI engines). Never follow "latest" or a moving tag.
2. **File manifest.** At pin time, write a per-file manifest of the unpacked zip: every exe and DLL, with its sha256 and size. Unpack only the files on the manifest. A zip holding anything else is refused whole.
3. **Download and unpack.** CE-5 applies:
   - https only;
   - redirect hosts on a fixed list (github.com and its release asset host, taken from a live redirect, not guessed);
   - the address checked again on every redirect;
   - a size cap;
   - no path escapes, links or alternate data streams in the archive;
   - no elevation.
4. **Before every start**, Bunny re-hashes `llama-server.exe` and every DLL against the manifest, because the data folder can be written by anything that runs as the person. Any mismatch: no start, one sentence, and "Download again".
5. **Start command.**
   - Start by absolute path from Bunny's data folder, never through PATH or a shell.
   - The working folder is the models folder.
   - `SetDefaultDllDirectories` (or a check that the process loads DLLs only from its own folder) is **spike first**: record which DLLs the process loads.
6. **Signing.** Authenticode signing of the binaries is UNKNOWN. If they are unsigned:
   - say so on the download card;
   - record whether SmartScreen or Defender stops them (spike first).
   - A signature does not replace the sha256 pin.
7. **Backends.** v1 ships the CPU and Vulkan builds only. CUDA is "later", as its own pin. Its runtime zip (cudart) must be pinned from the same release, never fetched from NVIDIA or elsewhere.
8. **A new pin is a Security sign-off.** Before signing, I read the llama.cpp advisory list for every build since the previous pin. The pin moves only with a Bunny release.

## LM-2: what the server is started with (and never with)

**Required flags:**
- `--host 127.0.0.1` (explicit, never a default and never `0.0.0.0`);
- `--port <random free port Bunny picked>`;
- `--api-key-file <file>`;
- `--no-ui`;
- `--no-slots`;
- the model and context arguments.

**Never passed:**
- `--tools`, `--agent`, `--ui-agent`, any MCP option, `--allow-unauthenticated-tools`;
- `--rpc`, and the `rpc-server` program is never shipped or unpacked (GHSA-j8rj-fmpv-wcxw);
- `-hf`/`--hf-repo` or any download option;
- `--metrics`, `--props` (POST `/props` changes settings);
- `--lora` from anywhere other than the list.

**Endpoints (spike first, then a test).** Start the real pinned server and call every endpoint it serves without the key, then with a wrong key.
- Each must refuse, except `/health`, if that is the only one left open.
- `/props`, `/slots` and `/metrics` must refuse or not exist.
- Write the list down. If an endpoint answers without the key, it needs a flag that turns it off, or the pin is refused.

**Bound address (test).** After start, check the port is reachable on 127.0.0.1 and not on the PC's LAN address.

**The key.**
- 32 random bytes per start, in a file in the data folder that only the person's account can read (owner-only ACL).
- Deleted when the process stops.
- Never in the command line, a log, the chat, an error message or a setting.

## LM-3: the child process holds nothing of Bunny's

- **Environment:** `safeEnv` only:
  - no provider keys, sign-in tokens, `HF_TOKEN`, `BUNNY_*`, proxy credentials or `NODE_OPTIONS`;
  - `LLAMA_CACHE` points to a folder inside the models folder;
  - `HF_HUB_OFFLINE=1`.
- **Lifetime:** a Windows job object with kill-on-close, so the server dies with Bunny, crash included. Stop, quit and idle-unload end it. At most one runtime process, and Bunny never adopts one it did not start (a process already on the port is not "ours").
- **Low integrity (spike first; then required, or written into NOT_COVERED):**
  - Run the server at low integrity through the F13 helper. It only needs to read the model file and bind loopback, so it should work.
  - If it does not work, the release notes and Settings say plainly: "the model runner runs with your rights; a crafted model file could act as you".
- **The model file:** read-only to the process where possible.

## LM-4: nothing reaches the runtime except Bunny

- The device server never proxies or forwards to the runtime port. A device's chat goes through Bunny's provider code like any provider, with the same window-only and device rules.
- `read_url`, `download_file`, `browser_open` and the browser panel must not open the runtime's port.
  - `read_url` and `download_file` already refuse loopback through `fetchLimited`; add a test with the runtime's port.
  - For the browser panel, add an explicit refusal of `127.0.0.1:<runtime port>` and `localhost:<runtime port>`, with a test.
- The runtime's address and key are never sent to a model, a connector, a helper or an engine.

## LM-5: the model downloader

- **Address checks.**
  - https only, to `huggingface.co` plus the CDN host names seen in the live redirect (spike first: write them as constants, no wildcards beyond what the redirect proves).
  - Re-checked on every redirect, with public addresses only (the `fetchLimited` rules).
- **Pinned files.** The list entry pins:
  - the repo;
  - the **commit revision** (not `main`);
  - the file name;
  - the size;
  - the sha256 (the tree API's `lfs.oid`).
- **Verifying the download.**
  - Bunny hashes while streaming.
  - The download is accepted only if the hash equals the pinned sha256. For a model not on the list, the hash must equal both the tree API's `lfs.oid` and `X-Linked-ETag` at the same revision.
  - Any mismatch deletes the file.
  - A resumed `.part` file is hashed again in full at the end.
- **Files allowed.**
  - Only `.gguf` files are ever downloaded, plus a multimodal projector `.gguf` named in the list entry.
  - Nothing else from a repo: no `.py`, no tokenizer scripts, no `.bin` or `.safetensors`, no config that something would run.
- **Where it lands.**
  - The path is built by Bunny: `<data>/models/<owner>__<repo>/<file>`.
  - Each part is checked against `^[A-Za-z0-9._-]{1,128}$`, with no `..` and no path separators.
  - The final path is checked inside the models folder by real path, and links are refused (S-LINK-1 rules).
- **Space and size.**
  - A free-space check before the download.
  - A size cap per file (the list entry's size, or a cap for a model not on the list, stated on the card).
  - A failed or cancelled download leaves no half file in use.
- **No token in v1.** No Hugging Face token is read, asked for or stored. A gated repo is refused with one sentence.

## LM-6: the curated list is a trust decision

- The list lives in source and is frozen. It changes only with a release, after Security checks each entry, like F4: the repo owner is the model's publisher or a known quantiser, the files are non-gated, and the licence tag is Apache-2.0 or MIT.
- Its sources file records, per entry, what was checked and when.
- The chat template inside a GGUF is untrusted text that llama.cpp runs (Jinja). Entries on the list were checked with their templates. A model not on the list gets the warning in LM-7.

## LM-7: a model not on the list

- Only the person, in the window (LM-0), by typing a repo.
- A card shows:
  - the repo;
  - the revision;
  - the file;
  - the size;
  - the sha256;
  - the licence tag ("none" if missing);
  - the plain sentence "Not on Bunny's list. A model file can carry an attack on the program that loads it, and its chat template is run as given. Add it only from a publisher you trust."
- The main button is **"Don't add"**. Adding is the second button.
- No licence tag means one extra confirmation line.

## LM-8: a local model is a provider like any other

- Same permission modes, rules, window-only lists, device levels and tool lists as any provider. Its output is untrusted, the same as a cloud model's.
- **The Auto check (F11/F12) with a local model.**
  - The judge defaults to "this chat's own model". When that model is local, Smart mode gives **Ask**, unless the person has picked a judge model in Settings ("Model that checks Auto actions").
  - Settings says why: "a small local model is a weaker check".
  - A judge that is down follows the existing F11 rule (Ask).

## LM-9: network after the download

- The runtime must not reach the network.
- **Spike first:** capture the pinned server's traffic through a whole chat with the fake upstream (the CLI-engines capture method). Record that it opens no outbound connection: no telemetry and no model fetch.
- If it does reach out, the pin is refused, or the traffic is blocked and the block is tested.

## LM-10: deleting

- Deleting a model or the runtime uses `removeTree` with real-path checks inside its own folder, and refuses links. The process is stopped first.
- "Remove local models" also deletes the key file and the cache folder.

## LM-11: privacy wording

- Settings and the download card say:
  - chats with a local model stay on this PC;
  - downloads talk only to Hugging Face (and GitHub for the runtime);
  - what the runtime can read (LM-3 wording).
- Screenshots use an invented profile.

## LM-12: resource use is the person's choice

- Fit estimates (RAM/VRAM) are shown before a download.
- A device cannot start a download or the runtime (LM-0), so a phone cannot fill the disk or pin the CPU.

## LM-13: updates and advisories

- **Each release:** read llama.cpp's advisory list for the pinned build and newer builds. If an advisory affects the pinned build:
  - a high or critical one is a hotfix candidate, with a new pin;
  - a medium one goes to the next release.
- The pin's tag and date are recorded in the release record.

## LM-14: tests the build must carry

1. A zip with an extra file, a wrong sha256 or a path escape is refused.
2. A DLL changed after the download stops the start.
3. Started-with flags (exact argv): the required flags are present and none of the forbidden flags are.
4. **Spike first, then a test:**
   - every endpoint without the key is refused;
   - the port is not reachable on the LAN address.
5. Key file:
   - owner-only ACL;
   - deleted on stop;
   - not in argv, logs or any response.
6. The child environment has none of the listed variables.
7. Kill-on-close: killing Bunny ends the server.
8. A device (both levels) gets 403 on every download, start, stop and delete route; the window gets 200.
9. The browser panel, `read_url` and `download_file` refuse the runtime port.
10. Downloader:
    - a hash mismatch deletes the file;
    - a resumed file is hashed whole;
    - a non-`.gguf` file is refused;
    - a bad file-name part is refused;
    - a link at the target is refused;
    - a gated repo is refused;
    - a redirect to an unlisted host is refused.
11. The card for a model not on the list has "Don't add" first.
12. With a local model as the chat model and no judge picked, Smart gives Ask.

All tests use an invented profile (`BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`) and stand-in servers. The one real run of the pinned binary (LM-2 endpoints, LM-9 traffic) needs the owner's go, like the CLI-engines probe.
