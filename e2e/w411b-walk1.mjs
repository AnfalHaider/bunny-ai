/**
 * QA, W4-11 first batch at 4b2a311, walk 1: PV-1, PV-2, PV-3, D-1, S-1, S-3, S-6 and the skill read in parts.
 * Invented profile only: in-process server with an invented data folder. Two apps:
 *   FAKE  (fake provider) driven with the PV-3 lines  [[call name {json}]]  in the person's message, through the real tool loop;
 *   REAL  (a scripted OpenAI-style upstream that records every request it gets) for the things that need the request itself.
 *   node e2e/w411b-walk1.mjs      (from a checkout that has test/helpers.js, e2e/w411b-http.mjs)
 */
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp, post } = await imp('test/helpers.js');
const { startHttpMcp } = await imp('e2e/w411b-http.mjs');
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 250) : ''}`); };

// ---- run one reply and collect everything
async function run(base, { content, mode = 'auto', model = 'gpt-4o', providerId = 'openai', answer = null, sessionId = null, abortAfterMs = 0 }) {
  let id = sessionId;
  if (!id) { const { body: s } = await post(base, '/api/sessions', { title: 'w411b', providerId, model }); id = s.id; await fetch(`${base}/api/sessions/${id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) }); }
  const ctl = new AbortController(); if (abortAfterMs) setTimeout(() => ctl.abort(), abortAfterMs);
  const events = []; const began = Date.now();
  try {
    const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId, model }), signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(60000)]) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let cut; while ((cut = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
        const ev = /^event: (.*)$/m.exec(frame)?.[1]; const d = /^data: (.*)$/m.exec(frame)?.[1]; if (!ev || !d) continue;
        let parsed; try { parsed = JSON.parse(d); } catch { continue; }
        events.push({ ev, data: parsed });
        if (ev === 'permission') { const ok = answer ? await answer(parsed) : true; await fetch(`${base}/api/sessions/${id}/permission/${parsed.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: ok }) }); }
      }
    }
  } catch { /* aborted by the walk (Stop) or timed out */ }
  const saved = await (await fetch(`${base}/api/sessions/${id}`)).json();
  return { events, id, saved, ms: Date.now() - began };
}
const steps = (r) => r.saved.messages.filter((m) => m.kind === 'tool_call');
const lastReply = (r) => [...r.saved.messages].reverse().find((m) => m.role === 'assistant' && m.kind !== 'tool_call')?.content ?? '';
const addSkill = (base, name, description, instructions, enabled = true) => post(base, '/api/skills', { name, description, instructions, enabled });

// =============== FAKE app: PV-3 and D-1 ===============
const fake = await startApp(t, { fake: true });
const mcp = await startHttpMcp({ requireSession: true, tools: ['echo', 'two_parts', 'structured', 'is_error', 'resource', 'image', 'empty'] });
cleanups.push(async () => mcp.close());
await fetch(`${fake.base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ modelFilter: 'all' }) });
const conn = await (await fetch(`${fake.base}/api/mcp`, { method: 'POST', headers: j, body: JSON.stringify({ name: 'Fake', url: mcp.url, enabled: true }) })).json();
check('P0', 'a remote connector (needs a session id) is added to the fake-provider app', Boolean(conn.id), JSON.stringify(conn).slice(0, 100));
await fetch(`${fake.base}/api/mcp/${conn.id}/tools`); // the "Check" route lists its tools
const ask = (content, o = {}) => run(fake.base, { content, providerId: 'openai', ...o });
await fetch(`${fake.base}/api/providers/openai/connect`, { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000' }) }).catch(() => {});
{
  const r = await ask('say hello');
  check('P1', 'no marker in the message: the fake provider answers its usual plain text', steps(r).length === 0 && lastReply(r).length > 0, lastReply(r).slice(0, 80));
  const a = await ask('please run [[call fake__echo {"q":"one"}]] now');
  const reply = lastReply(a);
  check('P2', 'a [[call fake__echo {"q":"one"}]] line in the message makes the fake provider call that connector tool through the real loop, and it answers "Scripted: <the result>"', steps(a).length === 1 && /ran echo with \{"q":"one"\}/.test(reply) && /^Scripted: /.test(reply), `${steps(a).length} steps; ${reply.slice(0, 100)}`);
  const b = await ask('[[call fake__echo {"q":"first"}]] and then [[call fake__echo {"q":"second"}]]');
  check('P3', 'two lines are called one after another in order, and the answer holds the LAST result', steps(b).length === 2 && /first/.test(String(steps(b)[0].result)) && /second/.test(String(steps(b)[1].result)) && /second/.test(lastReply(b)), `${steps(b).length} steps; ${lastReply(b).slice(0, 80)}`);
  const c = await ask('[[call no_such_tool {"x":1}]]');
  console.log('INFO  P4 events: ' + JSON.stringify(c.events.filter((x) => x.ev === 'tool').map((x) => x.data)).slice(0, 300) + ' | reply: ' + lastReply(c).slice(0, 120));
  check('P4', 'a call of a tool that does not exist ends with a plain "not available" answer to the model and the reply still finishes', /not available|no such|unknown/i.test(lastReply(c)) && /^Scripted: /.test(lastReply(c)), `${lastReply(c).slice(0, 120)}`);
  const d = await ask('[[call fake__echo {not json}]]');
  check('P5', 'a marker whose JSON is broken does not crash the chat (the reply finishes)', lastReply(d).length > 0 && d.events.some((e) => e.ev === 'done' || e.ev === 'message' || true), `${lastReply(d).slice(0, 100)}`);
  const e = await ask('[[call fake__echo {"q":"ask"}]]', { mode: 'ask', answer: async () => false });
  check('P6', 'in Ask mode the scripted call shows a permission card (a connector tool is not read-only until trusted) and a No stops it: nothing runs', e.events.some((x) => x.ev === 'permission') && !/ran echo/.test(JSON.stringify(steps(e).map((s) => s.result))), `${e.events.filter((x) => x.ev === 'permission').length} cards`);
  const f = await ask('[[call fake__echo {"q":"ask"}]]', { mode: 'ask', answer: async () => true });
  check('P7', 'and answering Yes to the card runs it', /ran echo/.test(JSON.stringify(steps(f).map((s) => s.result))), `${steps(f).map((s) => String(s.result).slice(0, 50))}`);
  const g = await ask('[[call fake__echo {"q":"plan"}]]', { mode: 'plan' });
  check('P8', 'in Plan mode the connector tool is not offered at all (not trusted as read-only), so the scripted call is refused with no card', !g.events.some((x) => x.ev === 'permission') && !/ran echo/.test(JSON.stringify(steps(g).map((s) => s.result))), `${String(steps(g)[0]?.result).slice(0, 100)}`);
  const sid = a.id;
  const h = await ask('and now just talk to me', { sessionId: sid });
  check('P9', 'a later message in the same chat without a marker is plain text again (an earlier marker does not run twice)', steps(h).length === 1 && lastReply(h).length > 0 && !/^Scripted: ran echo with/.test(lastReply(h)), `${steps(h).length} steps in the whole chat; ${lastReply(h).slice(0, 60)}`);
}
// D-1: the text the connector sent, not its raw JSON
{
  const stepOf = async (tool) => { const r = await ask(`[[call fake__${tool} {}]]`); return { step: steps(r)[0], reply: lastReply(r), r }; };
  const two = await stepOf('two_parts');
  check('D1a', 'two text parts reach the model as plain text joined by a new line (no JSON escapes, no braces)', /^Scripted: line one\nline two\nwith a new line/.test(two.reply) && !/\{"content"|\\n/.test(two.reply), JSON.stringify(two.reply).slice(0, 120));
  const st = await stepOf('structured');
  check('D1b', 'a structured result (no text) is shown as indented JSON', /"count": 2/.test(st.reply) && /\n  "items"/.test(st.reply), JSON.stringify(st.reply).slice(0, 120));
  const er = await stepOf('is_error');
  check('D1c', 'an answer with isError: the step is FAILED (not done) and the model is told "The tool reported an error: ..."', er.step?.status === 'failed' && /The tool reported an error: the file was not found/.test(er.reply), `status ${er.step?.status}; ${er.reply.slice(0, 80)}`);
  const rs = await stepOf('resource');
  check('D1d', 'a resource part shows its text and a link part shows as a short [link: name address] line', /resource text here/.test(rs.reply) && /\[link: Spec https:\/\/example\.invalid\/spec\]/.test(rs.reply), JSON.stringify(rs.reply).slice(0, 140));
  const im = await stepOf('image');
  check('D1e', 'an image part is a short note (type and size, not shown here), never 4,000 characters of base64; the caption stays', /\[image: image\/png, 3 KB, not shown here\]/.test(im.reply) && !/AAAA/.test(im.reply) && /caption/.test(im.reply), JSON.stringify(im.reply).slice(0, 140));
  const em = await stepOf('empty');
  check('D1f', 'an answer with no content says so: "(the tool returned no text)"', /\(the tool returned no text\)/.test(em.reply), JSON.stringify(em.reply).slice(0, 100));
  check('D1g', 'the connector saw ONE handshake for all these calls (initialize once, a session id on every later request)', mcp.log.filter((x) => x.method === 'initialize').length === 1 && mcp.log.filter((x) => x.method === 'tools/call').every((x) => x.sid && x.ver), `${mcp.log.filter((x) => x.method === 'initialize').length} initialize; calls with a session: ${mcp.log.filter((x) => x.method === 'tools/call' && x.sid).length}/${mcp.log.filter((x) => x.method === 'tools/call').length}`);
}

// =============== REAL app (scripted upstream that records requests) ===============
const real = await startApp(t, { fake: false });
let seen = []; let behave = () => ({ kind: 'text', text: 'hello' }); let script = [];
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })); return; }
    const body = JSON.parse(raw); seen.push(body);
    const b = behave(body, seen.length);
    if (b.kind === 'http') { res.writeHead(b.status, j); res.end(JSON.stringify({ error: { message: b.message } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = b.kind === 'tool' ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${seen.length}`, function: { name: b.name, arguments: JSON.stringify(b.args ?? {}) } }] } }] } : { choices: [{ delta: { content: b.text ?? 'hello' } }] };
    res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); cleanups.push(async () => upstream.close());
await post(real.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
await fetch(`${real.base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ modelFilter: 'all' }) });
const go = (content, o = {}) => { seen = []; return run(real.base, { content, ...o }); };
const toolMsgs = () => seen.flatMap((b) => (b.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content)));
const sysText = (b) => (b.messages ?? []).filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

// ---- S-1: a long skill is read in parts
const original = Array.from({ length: 900 }, (_, i) => `Step ${String(i + 1).padStart(4, '0')}: do the careful thing number ${i + 1}.`).join('\n'); // about 38,000 characters
await addSkill(real.base, 'Big', 'a long skill', original);
const partText = async (part) => { script = [{ kind: 'tool', name: 'read_skill', args: part === undefined ? { name: 'Big' } : { name: 'Big', part } }]; behave = (b, n) => script[n - 1] ?? { kind: 'text', text: 'done' }; await go('read the skill'); return toolMsgs()[0] ?? ''; };
const p1 = await partText(1);
const total = Number(/part 1 of (\d+)/.exec(p1)?.[1]);
check('SK1', 'read_skill on a 38,000-character skill answers "[Skill Big, part 1 of N]" with the first 8,000 characters and says to call again with part 2', total === Math.ceil(original.length / 8000) && /Call read_skill again with part 2/.test(p1), `${original.length} chars; ${p1.slice(0, 60)} ... ${p1.slice(-70)}`);
let joined = ''; let allOk = true;
for (let i = 1; i <= total; i += 1) { const p = await partText(i); const m = /^\[Skill Big, part (\d+) of (\d+)\]\n([\s\S]*)\n\[(.*)\]$/.exec(p); if (!m || Number(m[1]) !== i) { allOk = false; break; } joined += m[3]; if (i === total && !/That was the last part/.test(m[4])) allOk = false; }
check('SK2', 'reading every part in turn gives back the WHOLE skill, byte for byte (nothing cut out of the middle), and the last part says so', allOk && joined === original, `${joined.length} of ${original.length} characters, equal: ${joined === original}`);
check('SK3', 'a part number past the end gives the last part; 0, a negative, text and 2.5 are read as 1, 1, 1 and 2; no part number is part 1', /part \d+ of \d+/.test(await partText(99)) && /part (\d+) of \1/.test(await partText(99)) && /part 1 of/.test(await partText(0)) && /part 1 of/.test(await partText(-4)) && /part 1 of/.test(await partText('abc')) && /part 2 of/.test(await partText(2.5)) && /part 1 of/.test(await partText(undefined)), 'checked');
await addSkill(real.base, 'Exact', 'x', 'e'.repeat(8000)); await addSkill(real.base, 'Over', 'x', 'o'.repeat(8001)); await addSkill(real.base, 'Short', 'x', 'short text');
const readSkill = async (name) => { script = [{ kind: 'tool', name: 'read_skill', args: { name } }]; behave = (b, n) => script[n - 1] ?? { kind: 'text', text: 'done' }; await go('read it'); return toolMsgs()[0] ?? ''; };
const ex = await readSkill('Exact'); const ov = await readSkill('Over'); const sh = await readSkill('Short');
check('SK4', 'a skill of exactly 8,000 characters and a short one come back whole with no header; 8,001 is two parts', ex === 'e'.repeat(8000) && sh === 'short text' && /part 1 of 2/.test(ov), `${ex.length} | ${sh} | ${ov.slice(0, 40)}`);
// S-6
await addSkill(real.base, 'Off skill', 'x', 'secret off text', false);
const offRes = await readSkill('Off skill'); const noRes = await readSkill('Nothing here');
check('S6a', 'a skill that is switched off cannot be read: "There is no skill called Off skill"', /There is no skill called Off skill/.test(offRes) && !/secret off text/.test(offRes), offRes.slice(0, 100));
check('S6b', 'a skill that does not exist gives the same plain answer', /There is no skill called Nothing here/.test(noRes), noRes.slice(0, 80));
await fetch(`${real.base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ skillsEnabled: false }) });
const allOff = await readSkill('Short');
check('S6c', 'with all skills switched off in the settings, even a switched-on skill cannot be read', /There is no skill called Short/.test(allOff), allOff.slice(0, 80));
await fetch(`${real.base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ skillsEnabled: true }) });
check('S6d', 'switching skills back on makes it readable again', (await readSkill('Short')) === 'short text');

// ---- S-3: the compact index holds each skill's whole description
for (const s of await (await fetch(`${real.base}/api/skills`)).json()) await fetch(`${real.base}/api/skills/${s.id}`, { method: 'DELETE' });
const descs = Array.from({ length: 13 }, (_, i) => `Skill ${i + 1} is for ${'case-'.repeat(30)}${i + 1} and it ends with the marker END${i + 1}.`.slice(0, 200));
for (let i = 0; i < 13; i += 1) await addSkill(real.base, `skill-${i + 1}`, descs[i], `instructions ${i + 1}`);
behave = () => ({ kind: 'text', text: 'ok' }); await go('hello');
const sys = sysText(seen[0]);
check('S3a', 'with 13 skills on, the system text lists every skill with its WHOLE description (up to 200 characters), not cut at 140', descs.every((d, i) => sys.includes(d)) && descs[0].length >= 190, `${descs.filter((d) => sys.includes(d)).length} of 13 full descriptions present (length ${descs[0].length})`);
check('S3b', 'and it names read_skill so the model can load one', /read_skill/.test(sys));
for (const s of await (await fetch(`${real.base}/api/skills`)).json()) await fetch(`${real.base}/api/skills/${s.id}`, { method: 'DELETE' });

// ---- PV-1: a provider that refuses tools
await addSkill(real.base, 'Any', 'x', 'any');
const refuse = (message, status = 400) => (b) => (b.tools?.length ? { kind: 'http', status, message } : { kind: 'text', text: 'plain answer' });
behave = refuse('This model does not support tools.');
const r1 = await go('hello');
check('V1', 'a provider that answers 400 "does not support tools": the reply is asked again WITHOUT tools, completes as plain chat, and the person is told once ("Tools are off for this model")', seen.length === 2 && seen[0].tools?.length > 0 && !seen[1].tools && lastReply(r1) === 'plain answer' && r1.events.filter((e) => e.ev === 'tool' && /Tools are off/.test(e.data.tool ?? '')).length === 1, `${seen.length} requests; reply "${lastReply(r1)}"; notices ${r1.events.filter((e) => e.ev === 'tool' && /Tools are off/.test(e.data.tool ?? '')).length}`);
const r2 = await go('and a second message');
console.log(`INFO  second message to the same model: ${seen.length} request(s) (${seen.length === 1 ? 'remembered: no wasted retry' : 'it tries the tools again and is refused again, then goes without'})`);
check('V2', 'a second reply also completes (it may repeat the refusal once, then go without tools)', lastReply(r2) === 'plain answer' && seen.length <= 2, `${seen.length} requests`);
behave = refuse('Invalid API key for this plan.');
const r3 = await go('hello');
check('V3', 'a 400 that is NOT about tools (an invalid key) is not retried: one request, and the error is shown', seen.length === 1 && lastReply(r3) !== 'plain answer', `${seen.length} request(s)`);
behave = refuse('internal server error', 500);
const r4 = await go('hello');
check('V4', 'a 500 is not read as a tools refusal (not retried without tools)', seen.length >= 1 && !seen.slice(0, 1).some((b) => !b.tools) && lastReply(r4) !== 'plain answer', `${seen.length} request(s)`);
behave = () => ({ kind: 'http', status: 400, message: 'this model does not support tools' });
const r5 = await go('hello');
check('V5', 'if the retry without tools fails too, at most two requests are made and the error is shown (no loop)', seen.length === 2 && lastReply(r5) !== 'plain answer', `${seen.length} requests`);
behave = refuse('Unsupported parameter: tools');
const r6 = await go('hello');
check('V6', 'another wording ("Unsupported parameter: tools") is understood too', seen.length === 2 && lastReply(r6) === 'plain answer');
behave = refuse('The max_tokens value is too large for this tool-capable model.');
const r7 = await go('hello');
console.log(`INFO  a 400 about max_tokens that happens to contain the word tool-capable: ${seen.length === 2 ? 'treated as a tools refusal (retried without tools)' : 'not retried'}`);
void r7;
behave = () => ({ kind: 'text', text: 'ok' });

// ---- PV-2: too many tools
for (const s of await (await fetch(`${real.base}/api/skills`)).json()) await fetch(`${real.base}/api/skills/${s.id}`, { method: 'DELETE' });
const big = await startHttpMcp({ tools: Array.from({ length: 150 }, (_, i) => `t${i + 1}`) });
cleanups.push(async () => big.close());
const bigConn = await (await fetch(`${real.base}/api/mcp`, { method: 'POST', headers: j, body: JSON.stringify({ name: 'Big', url: big.url, enabled: true }) })).json();
await fetch(`${real.base}/api/mcp/${bigConn.id}/tools`);
await fetch(`${real.base}/api/mcp/${bigConn.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ trustReadOnly: true }) });
behave = () => ({ kind: 'text', text: 'ok' }); await go('what can you do');
const names = (seen[0].tools ?? []).map((d) => d.function.name);
check('T1', 'a connector with 150 tools: the request carries at most 100 tools (not 150 + the built-in ones), and none of the 150 is listed directly', names.length <= 100 && !names.some((n) => /^big__t\d+/.test(n)), `${names.length} tools in the request`);
check('T2', 'the two small tools list_connector_tools and call_connector_tool are offered, with the built-in tools', names.includes('list_connector_tools') && names.includes('call_connector_tool') && names.includes('read_skill'));
check('T3', 'the request stays under 20,000 characters of tool definitions', JSON.stringify(seen[0].tools).length <= 20000, `${JSON.stringify(seen[0].tools).length} characters`);
const viaTools = async (calls, o = {}) => { script = calls; behave = (b, n) => script[n - 1] ?? { kind: 'text', text: 'done' }; const r = await go('use the connector', o); return { r, msgs: toolMsgs(), last: lastReply(r) }; };
const lst = await viaTools([{ kind: 'tool', name: 'list_connector_tools', args: { match: 't120' } }]);
check('T4', 'list_connector_tools with match "t120" lists that tool with its description', /big__t120: tool t120/.test(lst.msgs[0] ?? ''), (lst.msgs[0] ?? '').slice(0, 100));
const all = await viaTools([{ kind: 'tool', name: 'list_connector_tools', args: {} }]);
check('T5', 'with no match it lists the first 60 and says how many more and to narrow it with match', /\n… 90 more: narrow it with match\./.test(all.msgs[0] ?? '') && (all.msgs[0].match(/^big__t/gm) ?? []).length === 60, `${(all.msgs[0].match(/^big__t/gm) ?? []).length} lines; ${(all.msgs[0] ?? '').slice(-60)}`);
const reach = [1, 60, 61, 120, 150];
for (const n of reach) { const x = await viaTools([{ kind: 'tool', name: 'call_connector_tool', args: { name: `big__t${n}`, arguments: { q: n } } }]); check(`T6 t${n}`, `call_connector_tool reaches tool ${n} of 150 (even beyond the first 60 listed) and returns its text`, new RegExp(`ran t${n} with \\{"q":${n}\\}`).test(x.msgs[0] ?? ''), (x.msgs[0] ?? '').slice(0, 80)); }
const nope = await viaTools([{ kind: 'tool', name: 'call_connector_tool', args: { name: 'big__t999' } }]);
check('T7', 'a name that is not one of the 150 answers "There is no connector tool called big__t999. Call list_connector_tools to see the names."', /There is no connector tool called big__t999\. Call list_connector_tools/.test(nope.msgs[0] ?? ''), (nope.msgs[0] ?? '').slice(0, 120));
const noArgs = await viaTools([{ kind: 'tool', name: 'call_connector_tool', args: { name: 'big__t5' } }]);
check('T8', 'call_connector_tool with no arguments object still runs the tool', /ran t5 with \{\}/.test(noArgs.msgs[0] ?? ''), (noArgs.msgs[0] ?? '').slice(0, 80));
await fetch(`${real.base}/api/mcp/${bigConn.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ trustReadOnly: false }) });
const asked = await viaTools([{ kind: 'tool', name: 'call_connector_tool', args: { name: 'big__t7', arguments: {} } }], { mode: 'ask', answer: async () => false });
check('T9', 'in Ask mode a connector tool reached through call_connector_tool shows the same permission card as a direct call, and a No stops it (nothing runs)', asked.r.events.some((e) => e.ev === 'permission') && !/ran t7/.test(asked.msgs.join(' ')), `${asked.r.events.filter((e) => e.ev === 'permission').length} card(s); ${asked.msgs[0]?.slice(0, 60)}`);
const askedYes = await viaTools([{ kind: 'tool', name: 'call_connector_tool', args: { name: 'big__t7', arguments: {} } }], { mode: 'ask', answer: async () => true });
check('T10', 'and a Yes runs it', /ran t7/.test(askedYes.msgs.join(' ')));
const planned = await viaTools([{ kind: 'tool', name: 'call_connector_tool', args: { name: 'big__t7', arguments: {} } }], { mode: 'plan' });
check('T11', 'in Plan mode the connector tool (not trusted read-only) is refused with no card', !planned.r.events.some((e) => e.ev === 'permission') && !/ran t7/.test(planned.msgs.join(' ')), (planned.msgs[0] ?? '').slice(0, 100));
await fetch(`${real.base}/api/mcp/${bigConn.id}`, { method: 'DELETE' });
const few = await startHttpMcp({ tools: ['a', 'b', 'c'] }); cleanups.push(async () => few.close());
const fewConn = await (await fetch(`${real.base}/api/mcp`, { method: 'POST', headers: j, body: JSON.stringify({ name: 'Few', url: few.url, enabled: true }) })).json();
await fetch(`${real.base}/api/mcp/${fewConn.id}/tools`);
behave = () => ({ kind: 'text', text: 'ok' }); await go('hello');
const fewNames = (seen[0].tools ?? []).map((d) => d.function.name);
check('T12', 'with few connector tools they are offered directly (few__a, few__b, few__c) and the two small tools are NOT added', fewNames.includes('few__a') && fewNames.includes('few__c') && !fewNames.includes('call_connector_tool'), fewNames.filter((n) => /few|connector/.test(n)).join());
await fetch(`${real.base}/api/mcp/${fewConn.id}`, { method: 'DELETE' });

mcp.close(); upstream.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);
