# B3: the Vulkan build, run without ggml-rpc.dll (Builder E, 2026-11-26)

Asked for by Security's B3 (244b7428). The owner's yes: "Yes, test the GPU version now" (docs/plans/2026-11-26-v0.1.16-live-fixes.md, 9ea63f82).
Run in an invented data folder (never %LOCALAPPDATA%\BunnyAI), through the real service code, then deleted.

**PC (this one):** NVIDIA GeForce RTX 3050 Ti Laptop GPU (4 GB) plus the processor's own graphics, so Vulkan lists two devices; 34 GB RAM.

**What ran**
- Set-up from the pinned Vulkan zip (39,145,779 bytes, sha256 c7764958...9fb6e9, checked while streaming): 52 files written, `ggml-rpc.dll` and `ggml-rpc-server.exe` absent. The trial (`--version`, then `--list-devices`) passed through the Low helper.
- Model: granite-4.1-3b (Q4_K_M, 2,099,501,664 bytes), downloaded by Bunny's downloader and checked against its pin.
- Start through the real helper (Low integrity, kill-on-close job), the LM-2 argv exactly (`-m ... --host 127.0.0.1 --port <p> --api-key-file <f> --no-ui --no-slots -c <ctx> --jinja --log-verbosity 1 -ngl 99`), the key file deleted once `/health` answered.

**Results**
1. `-c 32768 -ngl 99`: the server loaded the model on the card and then failed to allocate the cache: "ggml_vulkan: Device memory allocation of size 1073741824 failed ... failed to allocate Vulkan1 buffer ... failed to create context". That is the Vulkan device (Vulkan1, the NVIDIA card) doing real work through the Low helper without `ggml-rpc.dll`. Bunny reported "There was not enough memory to load that model", in plain words.
2. `-c 4096 -ngl 99`: started, `/v1/chat/completions` answered 200 with "ready" (2 completion tokens), then stopped.
3. Through the app's own choice (`fit slow`, so no `-ngl`, `-c 8192`): started and answered 200 "ready".

**Found and fixed on the way:** `--list-devices` lists the processor's graphics (about 17 GB of shared memory) before the card. Taking the first device made Bunny think 17 GB of graphics memory was free. Bunny now uses the smallest card (the one that runs out first), and passes `-ngl 99` only when the whole model and its cache fit on it.

**Not shown:** the server's own startup lines about the device are not kept at `--log-verbosity 1`; the device is shown by `--list-devices` (Vulkan0 the processor's graphics, Vulkan1 the NVIDIA card) and by the allocation error above.

**Decision:** the test passed, so `VULKAN_RECORDED` is true: PCs with an NVIDIA or Intel card get the Vulkan build (AMD stays on the CPU build until someone runs it). Everything was deleted afterwards.
