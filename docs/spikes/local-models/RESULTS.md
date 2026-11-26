# LOCAL-MODELS spikes S-LM1 to S-LM5: results

Run 2026-11-26 by Builder D on one PC (Intel i7-12650H, 16 threads, 31.7 GB RAM; Intel UHD Graphics and an NVIDIA GeForce RTX 3050 Ti Laptop GPU with 4 GB). Windows 11.
The owner's yes: "Yes, download for the tests (Recommended)" (docs/plans/2026-11-26-v0.1.16-live-fixes.md). Tests only: nothing here is the build.

Everything ran from one scratch folder, bound to 127.0.0.1, with a per-run key file (`--api-key-file`), `safeEnv`-style environment (no `BUNNY_*`, no tokens), and **no Hugging Face token or sign-in**. All downloaded files (two zips, two models) and the scratch folder were deleted afterwards; only these text files are kept. The harness is in `lm.mjs` and `spikes.mjs`; the raw results are the `*.json` files here (paths made generic).

## What was downloaded (and checked)

| What | Source | Check |
|---|---|---|
| `llama-b12760-bin-win-cpu-x64.zip` (25,273,382 bytes) | `github.com/ggml-org/llama.cpp` release **b12760** | sha256 `c82a8319…cb97` equals the GitHub API `digest` |
| `llama-b12760-bin-win-vulkan-x64.zip` (39,145,779 bytes) | same release | sha256 `c7764958…b6e9` equals the GitHub API `digest` |
| `Qwen3-4B-Q4_K_M.gguf` (2,497,280,256 bytes) | `Qwen/Qwen3-4B-GGUF` at commit `bc640142c66e1fdd12af0bd68f40445458f3869b` (Apache-2.0, not gated) | sha256 `7485fe6f…fdf5` equals `X-Linked-ETag` and Researcher's list |
| `granite-4.1-3b-Q4_K_M.gguf` (2,099,501,664 bytes) | `ibm-granite/granite-4.1-3b-GGUF` at commit `ab4701481089b58a082ef63cc1cee738887293ff` (Apache-2.0, not gated) | sha256 `662b0626…eb29` equals `X-Linked-ETag` and Researcher's list |

The zips were unpacked with a path check (no entry leaves the folder). **`ggml-rpc-server.exe` was in both zips** (the file is named `ggml-rpc-server.exe`, not `rpc-server.exe`): it was deleted unrun. The CPU build also ships `ggml-rpc.dll`.

## Verdicts

| Spike | Verdict |
|---|---|
| **S-LM1** Vulkan and CPU | **Pass on this PC.** Both builds start with the LM-2 argv and answer. Vulkan found both GPUs and used the NVIDIA one: 28.8 tokens/s against 14.1 on the CPU build (Qwen3-4B, warm). No firewall rule was added by the 127.0.0.1 bind; no file was removed by Defender. Vulkan is proven for **NVIDIA (RTX 3050 Ti) here only**. |
| **S-LM2** tool calls | **5 of 5 for both families tried**: Qwen3-4B and Granite 4.1 3B each did the two-tool round trip with valid JSON arguments in 5 of 5 runs. **Not tried** (two models only, as agreed): Ministral 3, Gemma 4, GPT-OSS: those stay unproven (`tools: false`). |
| **S-LM3** hosts, ETag, resume | **Pass.** `X-Linked-ETag` equals the file's sha256 for both models. A killed download resumed with `Range` (HTTP 206) and its final hash matched. Redirect hosts: `huggingface.co` → `us.aws.cdn.hf.co` (path `/xet-bridge-us/…`); GitHub release asset → `release-assets.githubusercontent.com`. |
| **S-LM4 / LM-9** surface and traffic | **Pass, with notes below.** No outbound connection in 28 samples per verbosity during chats. No prompt text in the log at verbosity 1, 3 or 4. Without the key every endpoint answers 401 except `/health` (200) and `/` (404, no UI). The LAN address refused the connection. |
| **S-LM5** memory | **Pass.** LM-7's estimate was within 5 percent of the measured peak for both models at 8k, 16k and 32k, once the KV size per token is taken from the model (see the table). |

## S-LM1 detail

- Argv used (LM-2 flags only): `-m <model> --host 127.0.0.1 --port <random> --api-key-file <keyfile> --no-ui --no-slots -c 4096 --jinja --log-verbosity <n>`, plus `-ngl 99` for Vulkan. The bind check shows the port listening on `127.0.0.1` only.
- `--list-devices` (Vulkan build): `Vulkan0: Intel(R) UHD Graphics (16217 MiB, 15449 MiB free)` and `Vulkan1: NVIDIA GeForce RTX 3050 Ti Laptop GPU (3962 MiB, 3367 MiB free)`. Format: `<name>: <device> (<total> MiB, <free> MiB free)`. **The index order differed between `--list-devices` and the server's own log** (the NVIDIA card was `Vulkan0` in the log), so Bunny must not rely on an index.
- Start time: CPU 4.7 s; Vulkan 6.4 s (warm; one earlier cold run took 13.4 s). With a first request the Vulkan prompt speed was low (5 tokens/s) until shaders were compiled; the warm run did 41 prompt tokens/s.
- The CPU build's log line "offloaded 37/37 layers to GPU" is printed without a GPU backend: do not use it as proof of GPU use. The Vulkan log lists `Vulkan0 model buffer size = 2375 MiB`, which is.
- `netsh` showed no inbound firewall rule for llama after the runs. A graphical prompt was not observed on screen: this was a headless run, so "no prompt seen" is not proof.
- Defender: the unpacked files were all still present after the runs (no quarantine). Defender's own detection history was **not** queried; SmartScreen was not exercised.
- Not recorded: which DLLs the process loads (LM-1 "spike first" item).

## S-LM2 detail

Two tools (`get_weather`, `add_numbers`), prompt "What is the weather in Paris? Also, what is 17 plus 25? Use the tools for both.", `--jinja`, five runs each. A run passes when the model calls both tools with arguments that parse as JSON, gets the answers, and replies using both. The tool loop here was the harness's own, not Bunny's.
- Qwen3-4B: 5 of 5. Granite 4.1 3B: 5 of 5.
- Qwen3 thinks by default: with `max_tokens` small the reply was empty (all tokens went to `reasoning_content`). The chat tests used `chat_template_kwargs: {enable_thinking: false}`, which the server accepted. Bunny should do the same or budget for it.
- The native vs Generic handler was not recorded (the log at verbosity 1 does not say).

## S-LM4 / LM-9 detail (Qwen3-4B, CPU build, two verbosity values)

Endpoint sweep (no key / wrong key / right key):
- **Open without the key:** `GET /health` 200 only. `GET /` 404 (no UI).
- **Refused without the key (401), then with the right key:** `/v1/models` 200, `/models` 200, `GET /props` 200, `/v1/chat/completions` 200, `/completion` 200, `/tokenize` 200, `/detokenize` 200, `/apply-template` 200, `/v1/messages` 200, `GET` and `POST /lora-adapters` 200, `/infill` 400 (bad body), `/embedding` 501, `POST /props` 501, `/slots` 501, `/metrics` 501, `/cors-proxy` 403, `/tools` 403, `/mcp` 404, `/api/tags` 404.
- Note for Security: **`POST /lora-adapters` answers 200 with the right key** (an empty list was sent). It needs the key, so it is the same trust as chat, but it is a setting-changing endpoint that the argv does not turn off.
- **The key file is read once, at start.** After the file was rewritten the old key still worked and the new one gave 401; after the file was deleted the old key still worked. So the key file can be deleted as soon as `/health` succeeds.
- **Outbound traffic:** `netstat` was sampled every 250 ms for the server's pid through two chats per verbosity (28 samples each). Only loopback sockets appeared (the listener and the test's own connection). No other address. (This is sampling, not a packet capture, and nothing on the system was changed.)
- **Prompt text in logs:** a canary string was put in the prompts. It was absent from the log at `--log-verbosity` 1 (1 line in all) and 3 (100 lines); also absent in the verbosity-4 logs of S-LM1. No URL other than loopback appeared in any log.
- **LAN address:** the server did not answer on the PC's LAN IPv4 address (connection refused).
- **`ggml-rpc.dll` is not needed:** with it deleted the CPU build still started and answered. The server loads it as the "RPC backend" when it is present, so the allow list should leave out both `ggml-rpc.dll` and `ggml-rpc-server.exe`.

## S-LM5 detail (CPU build, working set of `llama-server.exe` during a short chat)

KV bytes per token, read from the Vulkan log of Qwen3-4B (576 MiB at 4096 tokens = 0.1406 MiB/token) and from the growth between contexts for Granite (0.0781 MiB/token). Estimate = file size + KV per token × ctx + 1.5 GB (LM-7).

| Model | ctx | Measured peak | Estimate | Difference |
|---|---|---|---|---|
| Qwen3-4B Q4_K_M (file 2,382 MiB) | 8k | 5,305 MiB | 5,070 MiB | −4.4 % |
| | 16k | 6,458 MiB | 6,222 MiB | −3.7 % |
| | 32k | 8,763 MiB | 8,526 MiB | −2.7 % |
| Granite 4.1 3B Q4_K_M (file 2,002 MiB) | 8k | 4,156 MiB | 4,178 MiB | +0.5 % |
| | 16k | 4,796 MiB | 4,818 MiB | +0.5 % |
| | 32k | 6,077 MiB | 6,098 MiB | +0.3 % |

- Both are within 15 percent. The formula only holds when the KV size per token comes from the model's own geometry (layers, KV heads, head size from the GGUF header): an estimate that guessed the KV size would be far off (a flat guess of zero gave −26 % to −55 %).
- Measured on the CPU build only (system RAM). The Vulkan run showed `Vulkan0` at 2,375 MiB model + 576 MiB KV + 81 MiB compute for ctx 4096 on the 4 GB card; no other VRAM measurements were taken.
- 32k context for Qwen3-4B needed 8.8 GB of RAM: on an 8 GB PC that model must be offered with a smaller context.

## Not covered

Ministral 3, Gemma 4 and GPT-OSS tool calls; the 16 GB-class models; which DLLs the process loads; Defender detection history and SmartScreen; a packet capture; a graphical firewall prompt; Bunny's own tool loop (the harness's was used); the native vs Generic tool handler; the restricted-token or job-object question (Researcher 5.6c); AMD and Intel GPUs under Vulkan as the compute device (Intel was listed, the NVIDIA card was used).
