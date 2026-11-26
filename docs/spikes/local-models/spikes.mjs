// Usage: node spikes.mjs <s1|s2|s4|s5> <model-file> <label> [build]
// Writes results/<spike>-<label>-<build>.json (text only). Everything runs on 127.0.0.1 with a per-run key file.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { ROOT, chat, isLoopbackOrWildcard, outbound, sleep, startServer, workingSetMB } from './lm.mjs';

const [, , spike, model, label, build = 'cpu'] = process.argv;
mkdirSync(join(ROOT, 'results'), { recursive: true });
const save = (name, data) => { writeFileSync(join(ROOT, 'results', `${name}.json`), JSON.stringify(data, null, 2)); console.log(JSON.stringify(data, null, 2).slice(0, 6000)); };
const logOf = (s) => readFileSync(s.logFile, 'utf8');
const grep = (text, re, n = 12) => text.split(/\r?\n/).filter((l) => re.test(l)).slice(0, n).map((l) => l.slice(0, 220));
const fwRules = () => { try { return execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split(/\r?\n\r?\n/).filter((b) => /llama/i.test(b)).map((b) => b.split(/\r?\n/).filter((l) => /Rule Name|Enabled|Action|Program|Profiles/i.test(l)).join(' | ')); } catch (e) { return [`netsh failed: ${String(e.message).slice(0, 80)}`]; } };

if (spike === 's1') {
  const out = { build, label, modelBytes: statSync(model).size, fwBefore: fwRules() };
  const s = await startServer({ build, model, ctx: 4096, verbosity: 4, tag: `s1-${label}-${build}`, ngl: build === 'vulkan' ? 99 : null }); // verbosity 4 only here, to read the device lines; S-LM4 chooses the one that keeps prompts out of the log
  out.argv = s.args.map((a, i) => (s.args[i - 1] === '--api-key-file' ? '<keyfile>' : a)).map((a) => a.replace(/\\/g, '/').replace(/.*scratchpad\/lm\//, '<scratch>/'));
  out.startMs = s.startMs;
  const ask = () => chat(s, { messages: [{ role: 'user', content: 'Write one sentence about rabbits.' }], max_tokens: 80, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
  await ask(); // warm-up (Vulkan compiles its shaders on the first request)
  const r = await ask();
  const m = r.json?.choices?.[0]?.message;
  out.chat = { status: r.status, text: String(m?.content ?? '').slice(0, 200), reasoningChars: String(m?.reasoning_content ?? '').length, ms: r.ms, predictedPerSecond: r.json?.timings?.predicted_per_second, promptPerSecond: r.json?.timings?.prompt_per_second };
  const log = logOf(s);
  out.logDevices = grep(log, /vulkan|offloaded|ggml_vulkan|using device|load_backend|CPU_Mapped|Vulkan\d/i);
  out.fwAfter = fwRules();
  out.bound = grep(execFileSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 1 << 26 }), new RegExp(`:${s.port}\\s.*LISTENING`), 4);
  await s.stop();
  save(`s1-${label}-${build}`, out);
} else if (spike === 's2') {
  // two tools; five runs; a run passes when the model asks for both tools with valid JSON arguments, gets the answers and replies using them
  const tools = [
    { type: 'function', function: { name: 'get_weather', description: 'Weather in a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
    { type: 'function', function: { name: 'add_numbers', description: 'Add two numbers', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } } },
  ];
  const s = await startServer({ build, model, ctx: 8192, tag: `s2-${label}-${build}`, ngl: build === 'vulkan' ? 99 : null });
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const messages = [{ role: 'user', content: 'What is the weather in Paris? Also, what is 17 plus 25? Use the tools for both.' }];
    const run = { i, calls: [], validJson: true, finalText: '', ok: false };
    for (let round = 0; round < 4; round += 1) {
      const r = await chat(s, { messages, tools, tool_choice: 'auto', max_tokens: 400, temperature: 0.2 });
      const m = r.json?.choices?.[0]?.message;
      if (!m) { run.error = `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`; break; }
      const tc = m.tool_calls ?? [];
      if (!tc.length) { run.finalText = String(m.content ?? '').slice(0, 300); break; }
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: tc });
      for (const c of tc) {
        let args = null;
        try { args = JSON.parse(c.function.arguments); } catch { run.validJson = false; }
        run.calls.push({ name: c.function.name, args });
        const result = c.function.name === 'get_weather' ? `Sunny, 21 C in ${args?.city ?? '?'}` : String(Number(args?.a) + Number(args?.b));
        messages.push({ role: 'tool', tool_call_id: c.id, content: result });
      }
    }
    const names = run.calls.map((c) => c.name);
    run.ok = run.validJson && names.includes('get_weather') && names.includes('add_numbers') && /42/.test(run.finalText) && /(sunny|21)/i.test(run.finalText);
    runs.push(run);
  }
  const log = logOf(s);
  save(`s2-${label}-${build}`, { build, label, passes: runs.filter((r) => r.ok).length, of: 5, chatFormat: grep(log, /chat format|chat_format|Chat format|handler|autoparser|peg/i, 6), runs });
  await s.stop();
} else if (spike === 's4') {
  const out = { build, label };
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const marker = 'ZEBRA-CANARY-PROMPT-7731';
  const results = [];
  for (const verbosity of [1, 3]) {
    const s = await startServer({ build, model, ctx: 4096, verbosity, tag: `s4-${label}-${build}-v${verbosity}`, ngl: build === 'vulkan' ? 99 : null });
    const res = { verbosity };
    // endpoints: no key, wrong key, right key, and the LAN address
    const paths = [['GET', '/health'], ['GET', '/'], ['GET', '/v1/models'], ['GET', '/models'], ['GET', '/props'], ['POST', '/props'], ['GET', '/slots'], ['GET', '/metrics'], ['POST', '/v1/chat/completions'], ['POST', '/completion'], ['POST', '/tokenize'], ['POST', '/detokenize'], ['POST', '/apply-template'], ['POST', '/embedding'], ['GET', '/lora-adapters'], ['POST', '/lora-adapters'], ['POST', '/infill'], ['POST', '/v1/messages'], ['GET', '/api/tags'], ['GET', '/cors-proxy'], ['GET', '/mcp'], ['GET', '/tools'], ['POST', '/tools'], ['GET', '/v1/models/x'], ['POST', '/slots/0?action=erase']];
    const body = (p) => (p === '/tokenize' ? { content: 'hello' } : p === '/detokenize' ? { tokens: [1, 2] } : p === '/apply-template' || p === '/v1/chat/completions' || p === '/v1/messages' ? { messages: [{ role: 'user', content: 'hi' }], max_tokens: 4 } : p === '/props' ? { n_ctx: 1 } : p === '/lora-adapters' ? [] : { prompt: 'hi', n_predict: 2, input: 'hi', content: 'hi' });
    res.endpoints = [];
    for (const [method, p] of paths) {
      const row = { method, path: p };
      for (const [name, auth] of [['noKey', null], ['wrongKey', 'wrong'], ['rightKey', s.key]]) {
        try { const r = await s.call(p, { method, body: method === 'POST' ? body(p.split('?')[0]) : undefined, auth }); row[name] = r.status; } catch (e) { row[name] = `err:${String(e.cause?.code ?? e.message).slice(0, 20)}`; }
      }
      res.endpoints.push(row);
    }
    // the LAN address must not answer
    if (lan) { try { const r = await fetch(`http://${lan}:${s.port}/health`, { headers: { authorization: `Bearer ${s.key}` }, signal: AbortSignal.timeout(4000) }); res.lanAnswer = r.status; } catch (e) { res.lanAnswer = `unreachable (${String(e.cause?.code ?? e.message).slice(0, 30)})`; } }
    res.lanAddressTested = Boolean(lan);
    // a whole chat with outbound sampling
    const seen = new Set(); let samples = 0; let stop = false;
    const sampler = (async () => { while (!stop) { try { for (const row of outbound(s.child.pid)) { samples += 1; if (!isLoopbackOrWildcard(row.remote) || !isLoopbackOrWildcard(row.local)) seen.add(`${row.proto} ${row.local} -> ${row.remote} ${row.state}`); else seen.add(`(loopback) ${row.proto} ${row.state}`); } } catch { /* sampling failed once */ } await sleep(250); } })();
    const r = await chat(s, { messages: [{ role: 'user', content: `Reply with the word ok. ${marker}` }], max_tokens: 8, temperature: 0 });
    await chat(s, { messages: [{ role: 'user', content: `Tell me a short fact. ${marker}` }], max_tokens: 24, temperature: 0 });
    stop = true; await sampler;
    res.chatStatus = r.status; res.netSamples = samples; res.connections = [...seen];
    const log = logOf(s);
    res.promptTextInLog = log.includes(marker); res.replyTextInLog = r.json?.choices?.[0]?.message?.content ? log.includes(String(r.json.choices[0].message.content).trim().slice(0, 12)) && String(r.json.choices[0].message.content).trim().length > 8 : null;
    res.logLines = log.split(/\r?\n/).length;
    res.logHasUrls = grep(log, /https?:\/\/(?!127\.0\.0\.1|localhost)/i, 5);
    // is the key file read again after the start?
    const { writeFileSync: w, rmSync: rm } = await import('node:fs');
    const before = (await s.call('/v1/models')).status;
    w(s.keyFile, 'newkey-newkey-newkey\n');
    await sleep(1500);
    res.keyFile = { rightKeyBefore: before, oldKeyAfterRewrite: (await s.call('/v1/models')).status, newKeyAfterRewrite: (await s.call('/v1/models', { auth: 'newkey-newkey-newkey' })).status };
    rm(s.keyFile, { force: true }); await sleep(800);
    res.keyFile.oldKeyAfterDelete = (await s.call('/v1/models')).status;
    await s.stop();
    results.push(res);
  }
  out.results = results;
  save(`s4-${label}-${build}`, out);
} else if (spike === 's5') {
  const sizeMiB = statSync(model).size / 1048576;
  const rows = [];
  for (const ctx of [8192, 16384, 32768]) {
    const s = await startServer({ build, model, ctx, tag: `s5-${label}-${build}-${ctx}`, ngl: build === 'vulkan' ? 99 : null });
    let peak = 0; let stop = false;
    const sampler = (async () => { while (!stop) { peak = Math.max(peak, workingSetMB(s.child.pid) ?? 0); await sleep(300); } })();
    const idle = workingSetMB(s.child.pid);
    await chat(s, { messages: [{ role: 'user', content: 'Write three sentences about carrots.' }], max_tokens: 96, temperature: 0 });
    stop = true; await sampler;
    const log = logOf(s);
    const kv = grep(log, /KV buffer size|kv_cache.*size/i, 6);
    const kvMiB = kv.map((l) => Number(/size\s*=\s*([\d.]+)\s*MiB/i.exec(l)?.[1] ?? 0)).reduce((a, b) => a + b, 0);
    rows.push({ ctx, idleMB: idle, peakMB: peak, kvMiBFromLog: kvMiB, kvLines: kv, estimateMiB: Math.round(sizeMiB + kvMiB + 1536), startMs: s.startMs });
    await s.stop();
  }
  for (const r of rows) r.estimateVsPeakPercent = Math.round(((r.estimateMiB - r.peakMB) / r.peakMB) * 100);
  save(`s5-${label}-${build}`, { build, label, fileMiB: Math.round(sizeMiB), rows, note: 'estimate = file + KV (from the server log) + 1.5 GB, as LM-7; peak = working set of llama-server during a short chat' });
}
process.exit(0);
