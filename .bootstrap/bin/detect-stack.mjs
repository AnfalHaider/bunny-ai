#!/usr/bin/env node
// Stack profile (Phase 0B + 2A + 3A). Read-only: it prints, it never installs.
//   detect-stack [dir] [--json]
// The agent runs the printed install commands itself, then verifies them (Phase 5).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP = new Set(['node_modules', 'vendor', '.git', '.venv', 'venv', 'target', 'dist', 'build', '.next', 'obj', '.dart_tool', 'deps', '.build']);

// lockfile -> [manager, install command, dependency folder]
export const LOCKFILES = [
  ['composer.lock', 'composer', 'composer install --no-interaction --prefer-dist', 'vendor/'],
  ['package-lock.json', 'npm', 'npm ci', 'node_modules/'],
  ['pnpm-lock.yaml', 'pnpm', 'pnpm install --frozen-lockfile', 'node_modules/'],
  ['yarn.lock', 'yarn', 'yarn install --frozen-lockfile  # berry: yarn install --immutable', 'node_modules/'],
  ['bun.lock', 'bun', 'bun install --frozen-lockfile', 'node_modules/'],
  ['bun.lockb', 'bun', 'bun install --frozen-lockfile', 'node_modules/'],
  ['uv.lock', 'uv', 'uv sync --frozen', '.venv/'],
  ['poetry.lock', 'poetry', 'poetry install --sync', 'venv'],
  ['Pipfile.lock', 'pipenv', 'pipenv sync --dev', 'venv'],
  ['go.sum', 'go', 'go mod download', 'module cache'],
  ['Cargo.lock', 'cargo', 'cargo fetch --locked', 'cargo cache'],
  ['Gemfile.lock', 'bundler', 'bundle config set --local frozen true && bundle install', 'bundle path'],
  ['packages.lock.json', 'dotnet', 'dotnet restore --locked-mode', 'obj/'],
  ['pubspec.lock', 'pub', 'flutter pub get --enforce-lockfile  # or: dart pub get --enforce-lockfile', '.dart_tool/'],
  ['mix.lock', 'mix', 'mix deps.get', 'deps/'],
  ['Package.resolved', 'swiftpm', 'swift package resolve', '.build/'],
  ['deno.lock', 'deno', 'deno install --frozen', 'cache'],
  ['gradle.lockfile', 'gradle', './gradlew --no-daemon dependencies', 'gradle cache'],
];
// manifests that install without a lockfile (reported as UNPINNED)
const MANIFEST_ONLY = [
  ['requirements.txt', 'pip', 'python -m venv .venv && .venv/bin/pip install -r requirements.txt  # Windows: .venv\\Scripts\\pip', '.venv/'],
  ['pom.xml', 'maven', 'mvn -B -q dependency:go-offline', '~/.m2'],
  ['build.gradle', 'gradle', './gradlew --no-daemon dependencies', 'gradle cache'],
  ['build.gradle.kts', 'gradle', './gradlew --no-daemon dependencies', 'gradle cache'],
  ['package.json', 'npm', 'npm install  # NO LOCKFILE: versions unpinned', 'node_modules/'],
  ['composer.json', 'composer', 'composer install  # NO LOCKFILE: versions unpinned', 'vendor/'],
];

const LANG = { '.php': 'php', '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.vue': 'typescript', '.svelte': 'typescript', '.py': 'python', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.swift': 'swift', '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir' };

// language -> [official Claude Code LSP plugin, server binary install]
export const LSP = {
  php: ['php-lsp', 'npm install -g intelephense'],
  typescript: ['typescript-lsp', 'npm install -g typescript-language-server typescript'],
  javascript: ['typescript-lsp', 'npm install -g typescript-language-server typescript'],
  python: ['pyright-lsp', 'npm install -g pyright'],
  go: ['gopls-lsp', 'go install golang.org/x/tools/gopls@<pinned version>'],
  rust: ['rust-analyzer-lsp', 'rustup component add rust-analyzer'],
  ruby: ['ruby-lsp', 'gem install ruby-lsp'],
  csharp: ['csharp-lsp', 'dotnet tool install --global csharp-ls'],
  java: ['jdtls-lsp', 'jdtls from your package manager or release archive'],
  kotlin: ['kotlin-lsp', 'kotlin-lsp release'],
  c: ['clangd-lsp', 'clangd (LLVM)'],
  cpp: ['clangd-lsp', 'clangd (LLVM)'],
  swift: ['swift-lsp', 'sourcekit-lsp (ships with the Swift toolchain)'],
};

const RUNTIME_FILES = ['.nvmrc', '.node-version', '.python-version', '.tool-versions', 'mise.toml', '.ruby-version', 'rust-toolchain.toml', 'rust-toolchain', 'global.json', '.java-version'];

function read(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

function frameworks(dir) {
  const found = [];
  const pkg = read(join(dir, 'package.json'));
  const composer = read(join(dir, 'composer.json'));
  const py = read(join(dir, 'pyproject.toml')) + read(join(dir, 'requirements.txt'));
  const gem = read(join(dir, 'Gemfile'));
  const has = (s, re) => re.test(s);
  if (existsSync(join(dir, 'artisan')) || has(composer, /laravel\/framework/)) found.push('laravel');
  if (has(composer, /symfony\/framework-bundle/)) found.push('symfony');
  if (has(composer, /wordpress|wpackagist/) || existsSync(join(dir, 'wp-config.php'))) found.push('wordpress');
  if (has(pkg, /"next"\s*:/)) found.push('nextjs');
  if (has(pkg, /"nuxt"\s*:/)) found.push('nuxt');
  if (has(pkg, /"react"\s*:/)) found.push('react');
  if (has(pkg, /"vue"\s*:/)) found.push('vue');
  if (has(pkg, /"svelte"\s*:/)) found.push('svelte');
  if (has(pkg, /"@angular\/core"\s*:/)) found.push('angular');
  if (has(pkg, /"@nestjs\/core"\s*:/)) found.push('nestjs');
  if (has(pkg, /"expo"\s*:/)) found.push('expo');
  if (has(pkg, /"react-native"\s*:/)) found.push('react-native');
  if (has(pkg, /"electron"\s*:/)) found.push('electron');
  if (existsSync(join(dir, 'manage.py')) || has(py, /\bdjango\b/i)) found.push('django');
  if (has(py, /\bfastapi\b/i)) found.push('fastapi');
  if (has(py, /\bflask\b/i)) found.push('flask');
  if (existsSync(join(dir, 'bin', 'rails')) || has(gem, /gem ['"]rails['"]/)) found.push('rails');
  if (has(read(join(dir, 'pom.xml')) + read(join(dir, 'build.gradle')) + read(join(dir, 'build.gradle.kts')), /spring-boot/)) found.push('spring-boot');
  if (existsSync(join(dir, 'pubspec.yaml')) && has(read(join(dir, 'pubspec.yaml')), /flutter:/)) found.push('flutter');
  return found;
}

function scripts(dir) {
  try { return Object.keys(JSON.parse(read(join(dir, 'package.json'))).scripts || {}); } catch { return []; }
}

export function detect(root) {
  const workspaces = [];
  const langCount = {};
  const visit = (dir, depth) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    const lock = LOCKFILES.filter(([f]) => entries.includes(f));
    // a manifest is covered when any lockfile of its ecosystem is present (package.json + pnpm-lock = pnpm only)
    const COVERS = { npm: ['npm', 'pnpm', 'yarn', 'bun'], gradle: ['gradle'], composer: ['composer'], pip: ['uv', 'poetry', 'pipenv'], maven: [] };
    const manifests = MANIFEST_ONLY.filter(([f, mgr]) => entries.includes(f) && !lock.some(([, m]) => (COVERS[mgr] || [mgr]).includes(m)));
    if (lock.length || manifests.length) {
      workspaces.push({
        dir: relative(root, dir).replace(/\\/g, '/') || '.',
        installs: [...lock.map(([f, m, c, d]) => ({ file: f, manager: m, command: c, folder: d, pinned: true })),
          ...manifests.map(([f, m, c, d]) => ({ file: f, manager: m, command: c, folder: d, pinned: f !== 'package.json' && f !== 'composer.json' }))],
        frameworks: frameworks(dir),
        scripts: scripts(dir),
        runtime_files: RUNTIME_FILES.filter((f) => entries.includes(f)),
      });
    }
    for (const e of entries) {
      if (SKIP.has(e) || e.startsWith('.')) continue;
      const p = join(dir, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 4) visit(p, depth + 1); }
      else { const l = LANG[extname(e).toLowerCase()]; if (l) langCount[l] = (langCount[l] || 0) + 1; }
    }
  };
  visit(root, 0);
  const languages = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([l, n]) => ({ language: l, files: n }));
  const lsp = [...new Map(languages.filter((l) => LSP[l.language]).map((l) => [LSP[l.language][0], { plugin: LSP[l.language][0], binary: LSP[l.language][1], for: l.language }])).values()];
  const allFw = [...new Set(workspaces.flatMap((w) => w.frameworks))];
  const ui = allFw.some((f) => ['laravel', 'symfony', 'wordpress', 'nextjs', 'nuxt', 'react', 'vue', 'svelte', 'angular', 'django', 'rails', 'flask', 'expo', 'react-native', 'flutter', 'electron'].includes(f)) ||
    languages.some((l) => ['typescript', 'javascript'].includes(l.language));
  return {
    languages, workspaces, frameworks: allFw, ui, lsp_suggestions: lsp,
    needs: ['language server per primary language', allFw.length ? `framework plugin/skill: ${allFw.join(', ')}` : null,
      ui ? 'browser/E2E driver (e.g. playwright) + design skills' : null, 'one static-analysis/security reviewer', 'workflow skills (plans, TDD, debugging, verification)'].filter(Boolean),
    merge_gate: null, // the agent must find or build it (Phase 0B, O2) — never guessed here
  };
}

function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || process.cwd();
  const p = detect(root);
  if (args.includes('--json')) { console.log(JSON.stringify(p, null, 2)); return; }
  console.log(`languages: ${p.languages.map((l) => `${l.language}(${l.files})`).join(', ') || 'none found'}`);
  console.log(`frameworks: ${p.frameworks.join(', ') || 'none detected'}   ui: ${p.ui ? 'yes' : 'no'}`);
  for (const w of p.workspaces) {
    console.log(`\n[${w.dir}]${w.runtime_files.length ? `  runtime files: ${w.runtime_files.join(', ')}` : ''}`);
    for (const i of w.installs) console.log(`  ${i.pinned ? '' : 'UNPINNED '}${i.file}: ${i.command}`);
    if (w.scripts.length) console.log(`  scripts: ${w.scripts.join(', ')}`);
  }
  console.log('\nlanguage servers:');
  for (const l of p.lsp_suggestions) console.log(`  ${l.plugin}  (binary: ${l.binary})`);
  console.log('\nneeds to fill (Phase 3): ' + p.needs.join('; '));
  console.log('merge gate: NOT DETECTED — find or build it (Phase 0B / O2)');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
