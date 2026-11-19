// Spike S2-account (Builder C), the part that needs no real sign-in: the real pinned Codex 0.170.0 `app-server` with an isolated CODEX_HOME, cli_auth_credentials_store = "file", an INVENTED auth.json,
// account/read for the sign-in state, account/logout, and a logging proxy for every outbound host. Not shipped. No account, no token of anyone's.
// node s2acct.mjs <absRoot>
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = process.argv[2];
const EXE = 'C:/Users/anfal/AppData/Local/Temp/claude/3bc5ac4962d09573/c41dfe1d-a4ec-47e3-82da-0644903ce364/scratchpad/ce/s2/engine/codex-x86_64-pc-windows-msvc.exe';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.${b64('sig')}`;
const now = Math.floor(Date.now() / 1000);
const claims = (exp) => ({ iss: 'https://auth.openai.com', aud: ['spike'], iat: now - 100, exp, email: 'invented@example.test', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_account_id: 'acct-invented', chatgpt_user_id: 'user-invented' } });
const authJson = (exp, last) => JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: jwt(claims(exp)), access_token: jwt(claims(exp)), refresh_token: 'invented-refresh', account_id: 'acct-invented' }, last_refresh: last });

const hosts = [];
const proxy = createServer((_req, res) => { res.writeHead(502); res.end(); });
proxy.on('connect', (req, sock) => { hosts.push(`CONNECT ${req.url}`); sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
proxy.on('request', (req) => { hosts.push(`${req.method} ${req.headers.host}${req.url}`); });
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

const cmdkey = () => { try { return execFileSync('cmdkey', ['/list'], { encoding: 'utf8' }).split(/\r?\n/).filter((l) => /codex|openai/i.test(l)); } catch { return ['cmdkey failed']; } };

async function session(label, authText) {
  const run = join(root, `${label}-${Date.now()}`); const home = join(run, 'home'); const ch = join(home, 'codex'); mkdirSync(ch, { recursive: true });
  writeFileSync(join(ch, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
  if (authText !== null) writeFileSync(join(ch, 'auth.json'), authText);
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, CODEX_HOME: ch, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl };
  const child = spawn(EXE, ['app-server'], { env, cwd: run, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiters = new Map(); let id = 1; const notes = [];
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id !== undefined && !m.method && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } else if (m.method) notes.push(m.method); } });
  const send = (o) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`);
  const call = (method, params) => new Promise((resolve) => { const i = id++; waiters.set(i, resolve); send({ id: i, method, params }); setTimeout(() => resolve({ timeout: true }), 20000); });
  await call('initialize', { clientInfo: { name: 'bunny-spike', version: '0' } }); send({ method: 'initialized' });
  return { call, notes, ch, close: () => { try { child.kill(); } catch { /* gone */ } }, run };
}
const shape = (r) => { const a = r.result?.account; return { account: a ? { type: a.type, email: a.email, planType: a.planType } : a, requiresOpenaiAuth: r.result?.requiresOpenaiAuth, error: r.error?.message?.slice(0, 120), timeout: r.timeout }; };

const out = { cmdkeyBefore: cmdkey() };
const files = (dir) => readdirSync(dir).sort();
{ // 1. signed out: no auth.json
  const s = await session('signed-out', null);
  out.signedOut = shape(await s.call('account/read', { refreshToken: false })); out.signedOutFiles = files(s.ch); s.close();
}
{ // 2. an invented, fresh login
  const s = await session('signed-in', authJson(now + 3600, new Date().toISOString()));
  out.signedIn = shape(await s.call('account/read', { refreshToken: false }));
  const before = existsSync(join(s.ch, 'auth.json'));
  out.logout = await s.call('account/logout', undefined);
  out.afterLogout = shape(await s.call('account/read', { refreshToken: false }));
  out.authJsonBeforeLogout = before; out.authJsonAfterLogout = existsSync(join(s.ch, 'auth.json'));
  s.close();
}
{ // 3. an expired access token and an old last_refresh
  const s = await session('expired', authJson(now - 7200, new Date(Date.now() - 30 * 86400_000).toISOString()));
  out.expiredNoRefresh = shape(await s.call('account/read', { refreshToken: false })); s.close();
}
{ // 4. garbage
  const s = await session('garbage', '{ not json'); out.garbage = shape(await s.call('account/read', { refreshToken: false })); s.close();
}
out.cmdkeyAfter = cmdkey();
out.hostsContacted = [...new Set(hosts)];
console.log(JSON.stringify(out, null, 1));
proxy.close();
