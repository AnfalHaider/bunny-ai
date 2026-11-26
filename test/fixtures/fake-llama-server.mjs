// A stand-in for llama-server.exe (BUNNY_FAKE_LOCAL tests). It checks the argv the way the real one would refuse it, reads the key file ONCE at start, answers /health with no key,
// everything else only with the key, and streams a short chat answer. The model "file" says how to misbehave: a first line of OOM (fail to allocate), EXIT (end at once), SLOW:<ms>.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
if (argv[0] === '--version') { console.log('version: b12760 (stand-in)'); process.exit(0); }
if (argv[0] === '--list-devices') { console.log(['Available devices:', '  Vulkan0: Stand-in GPU (8192 MiB, 6000 MiB free)'].join('\n')); process.exit(0); }
const modelFile = flag('-m');
const keyFile = flag('--api-key-file');
const port = Number(flag('--port'));
if (flag('--host') !== '127.0.0.1') { console.error('refusing a host other than 127.0.0.1'); process.exit(2); }
for (const bad of ['--lora', '--lora-scaled', '--metrics', '--props', '-hf', '--models-dir', '--api-key']) if (argv.includes(bad)) { console.error(`refusing ${bad}`); process.exit(2); }
const mode = String(readFileSync(modelFile, 'utf8').split('\n')[0] ?? '').trim();
if (mode === 'OOM') { console.error('ggml_backend_cpu_buffer_type_alloc_buffer: failed to allocate buffer of size 9999999999'); process.exit(1); }
if (mode === 'EXIT') process.exit(3);
const key = readFileSync(keyFile, 'utf8').trim(); // read once; the file may be deleted afterwards
const delay = /^SLOW:(\d+)$/.exec(mode)?.[1] ? Number(/^SLOW:(\d+)$/.exec(mode)[1]) : 0;

const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return; }
  if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"Invalid API Key"}'); return; }
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"fake"}]}'); return; }
  if (req.url.startsWith('/v1/chat/completions')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello from the stand-in' } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
    return;
  }
  res.writeHead(404); res.end();
});
setTimeout(() => server.listen(port, '127.0.0.1'), delay);
process.on('SIGTERM', () => process.exit(0));
