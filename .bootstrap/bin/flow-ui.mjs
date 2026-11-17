#!/usr/bin/env node
// Local flow editor. Serves ui/flow-editor.html on 127.0.0.1 only, with a per-run token.
//   bootstrap flow [--port 4317] [--open]               edit this project's .bootstrap/flow.json
//   bootstrap flow --company <dir> [--port] [--open]    edit a company defaults folder (<dir>/company.json)
// Safety: binds to 127.0.0.1; every request needs the token (in the URL for the page, a header for the API);
// the Host header must be local (blocks DNS-rebinding); POST bodies are capped. Saving refuses on any error.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from './lib/fm.mjs';
import { KIT, PRESETS, loadLayers, merge, parseExtends, renderMarkdown, requiredFor, simulate, validate } from './lib/flow.mjs';
import { repoRoot } from './lib/policy.mjs';

function board(root, flow) {
  const dir = join(root, 'docs', 'signoffs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => !d.startsWith('.')).map((piece) => {
    const p = { piece, lane: 'normal', title: '', extra: [], signed: {} };
    for (const f of readdirSync(join(dir, piece)).filter((f) => f.endsWith('.md'))) {
      const { data } = parseFrontmatter(readFileSync(join(dir, piece, f), 'utf8'));
      if (!data) continue;
      if (f === '_piece.md') { p.lane = data.lane || 'normal'; p.title = data.title || ''; }
      else if (f === '_required.md') p.extra = Array.isArray(data.roles) ? data.roles : [];
      else if (String(data.verdict || '').toUpperCase() === 'PASS') p.signed[data.role || f.replace(/\.md$/, '')] = data.sha;
    }
    p.required = requiredFor(flow, p.lane, [], p.extra);
    p.missing = p.required.filter((r) => !p.signed[r]);
    return p;
  });
}

async function fetchCompany(ext, sha) {
  const raw = `https://raw.githubusercontent.com/${ext.owner}/${ext.repo}/${sha}/${ext.path}`;
  const r = await fetch(raw);
  if (!r.ok) throw new Error(`could not fetch ${raw} (${r.status})`);
  return JSON.parse(await r.text());
}
async function latestSha(ext) {
  const r = await fetch(`https://api.github.com/repos/${ext.owner}/${ext.repo}/commits/HEAD`, { headers: { accept: 'application/vnd.github.sha' } });
  if (!r.ok) throw new Error(`could not read ${ext.owner}/${ext.repo} (${r.status})`);
  return (await r.text()).trim();
}

export function makeServer({ root = null, companyDir = null, token = randomBytes(16).toString('hex') } = {}) {
  const mode = companyDir ? 'company' : 'project';
  const companyFile = companyDir ? join(companyDir, 'company.json') : null;

  const layersFor = (project, company) => {
    const base = root ? loadLayers(root) : { ...loadLayers(null), project: { version: 1 } };
    if (mode === 'company') return { ...base, project: { version: 1 }, company: company || (existsSync(companyFile) ? JSON.parse(readFileSync(companyFile, 'utf8')) : { version: 1, name: 'Company' }) };
    return { ...base, project: project || base.project };
  };
  const stateOf = (layers) => {
    const flow = merge(layers);
    return { mode, project: layers.project, company: layers.company, flow, findings: validate(layers, flow), presets: PRESETS,
      board: root && mode === 'project' ? board(root, flow) : [], root: root || companyDir };
  };

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = (req) => new Promise((ok, bad) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 1 << 20) { bad(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { bad(e); } });
  });

  const server = httpServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '');
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'local only' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        if (url.searchParams.get('t') !== token) return send(res, 403, 'Open the link printed by `bootstrap flow` (it carries the access token).', 'text/plain');
        const html = readFileSync(join(KIT, 'ui', 'flow-editor.html'), 'utf8').replace('__FLOW_TOKEN__', token);
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      if (req.headers['x-flow-token'] !== token) return send(res, 403, { error: 'bad token' });

      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, stateOf(layersFor()));
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      const body = await readBody(req);

      if (url.pathname === '/api/check') return send(res, 200, stateOf(layersFor(body.project, body.company)));
      if (url.pathname === '/api/simulate') {
        // "Try a change": the same lane/sign-off/word logic the pre-push check uses, on the flow being edited.
        const flow = merge(layersFor(body.project, body.company));
        return send(res, 200, simulate(flow, { condIds: Array.isArray(body.condIds) ? body.condIds : [], docsOnly: !!body.docsOnly, laneId: body.laneId || null }));
      }
      if (url.pathname === '/api/save') {
        if (mode === 'company') {
          const st = stateOf(layersFor(null, body.company));
          if (st.findings.some((f) => f.level === 'error')) return send(res, 409, { error: 'fix the errors first', findings: st.findings });
          mkdirSync(companyDir, { recursive: true });
          writeFileSync(companyFile, JSON.stringify(body.company, null, 2) + '\n');
          return send(res, 200, { saved: [companyFile], note: 'Commit and push this company repo, then press "Check for updates" in each project.' });
        }
        const st = stateOf(layersFor(body.project));
        if (st.findings.some((f) => f.level === 'error')) return send(res, 409, { error: 'fix the errors first', findings: st.findings });
        const fp = join(root, '.bootstrap', 'flow.json');
        mkdirSync(dirname(fp), { recursive: true });
        writeFileSync(fp, JSON.stringify(body.project, null, 2) + '\n');
        const md = join(root, 'docs', 'flow.md');
        mkdirSync(dirname(md), { recursive: true });
        writeFileSync(md, renderMarkdown(st.flow));
        return send(res, 200, { saved: ['.bootstrap/flow.json', 'docs/flow.md'], note: 'Saved. Tell the Chief of Staff "apply the flow change": it reads the change back to you, records your yes, and pushes it.' });
      }
      if (url.pathname === '/api/company/updates' || url.pathname === '/api/company/apply') {
        const project = body.project || layersFor().project;
        const ext = parseExtends(project.extends);
        if (!ext || ext.kind !== 'github') return send(res, 400, { error: 'This project does not inherit from a GitHub company repo. Set "Defaults live in" to github:owner/repo@<sha> first.' });
        if (url.pathname === '/api/company/updates') {
          const latest = await latestSha(ext);
          return send(res, 200, { current: ext.sha, latest, upToDate: latest.startsWith(ext.sha) || ext.sha.startsWith(latest) });
        }
        if (!/^[0-9a-f]{7,40}$/i.test(String(body.sha || ''))) return send(res, 400, { error: 'sha required' });
        const company = await fetchCompany(ext, body.sha);
        company.source = `github:${ext.owner}/${ext.repo}`; company.sha = body.sha.slice(0, 12);
        writeFileSync(join(root, '.bootstrap', 'company.json'), JSON.stringify(company, null, 2) + '\n');
        const next = { ...project, extends: `github:${ext.owner}/${ext.repo}${ext.path !== 'company.json' ? '/' + ext.path : ''}@${body.sha.slice(0, 12)}` };
        return send(res, 200, { ...stateOf(layersFor(next)), project: next, note: 'Company defaults updated in .bootstrap/company.json. Save the flow, then commit both files.' });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  });
  return { server, token, mode };
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* print only */ }
}

export function runFlowUi(args) {
  const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const companyDir = val('company', null) ? resolve(val('company')) : null;
  const root = companyDir ? null : repoRoot(process.cwd());
  if (!companyDir && !root) { console.error('Run inside the project (a git repository), or pass --company <dir>.'); process.exit(1); }
  const { server, token, mode } = makeServer({ root, companyDir });
  const port = Number(val('port', 4317));
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/?t=${token}`;
    console.log(`Flow editor (${mode}) for ${companyDir || root}\n  ${url}\nOnly this machine can open it. Ctrl+C to stop.`);
    if (args.includes('--open')) openBrowser(url);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runFlowUi(process.argv.slice(2));
