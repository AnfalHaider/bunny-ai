/**
 * G-1 / tokenizer: the quote-aware shell parser (lib/shellparse.mjs) shared by C, A3, A2 and E.
 * Tested alone, before anything is built on it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { BIN, fileUrl } from './guard-helpers.js';

const sp = await import(fileUrl(join(BIN, 'lib', 'shellparse.mjs')));
const parse = sp.parseShell;
const texts = (cmd) => cmd.words.map((w) => w.text);
const all = (s) => parse(s).commands.map(texts);

test('words split on spaces; quotes group and are removed', () => {
  assert.deepEqual(all('git commit -m "fix -n handling"'), [['git', 'commit', '-m', 'fix -n handling']]);
  assert.deepEqual(all("echo 'a  \"b\"  $x'"), [['echo', 'a  "b"  $x']]);
  assert.deepEqual(all('echo "a \\" b"'), [['echo', 'a " b']]);
  assert.deepEqual(all('echo a"b c"d'), [['echo', 'ab cd']]);
  assert.deepEqual(all('echo ""'), [['echo', '']], 'an empty quoted word is still a word');
});

test('a quoted word is marked quoted; expansions are marked dynamic, single quotes are not', () => {
  const [c] = parse('git commit -m "x" -- $f \'$g\' *.md').commands;
  assert.equal(c.words[3].quoted, true);
  assert.equal(c.words[5].dynamic, true, '$f');
  assert.equal(c.words[6].dynamic, false, "single-quoted '$g' is data");
  assert.equal(c.words[7].dynamic, true, 'a glob');
  assert.equal(parse('echo "$HOME/x"').commands[0].words[1].dynamic, true);
});

test('commands split on ; && || | & and newlines, never inside quotes', () => {
  assert.equal(parse('a && b; c | d\ne || f & g').commands.length, 7);
  assert.deepEqual(all('echo "a && b; c | d"'), [['echo', 'a && b; c | d']]);
  assert.deepEqual(all("echo 'x\ny'"), [['echo', 'x\ny']], 'a newline inside quotes does not split');
  assert.deepEqual(all('a;'), [['a']], 'a trailing ; is fine');
  assert.deepEqual(all('(cd x && git status)'), [['cd', 'x'], ['git', 'status']]);
});

test('redirections are separate from words', () => {
  const [c] = parse('echo hi > docs/a.md').commands;
  assert.deepEqual(texts(c), ['echo', 'hi']);
  assert.deepEqual(c.redirs.map((r) => [r.op, r.target.text]), [['>', 'docs/a.md']]);
  const forms = {
    'echo hi >> a': ['>>', 'a'], 'echo hi >a': ['>', 'a'], 'echo hi >"a b"': ['>', 'a b'],
    'echo hi 2> err': ['>', 'err'], 'echo hi &> both': ['&>', 'both'], 'echo hi >| force': ['>|', 'force'],
    'cat < in.txt': ['<', 'in.txt'], 'echo hi > /dev/null': ['>', '/dev/null'],
  };
  for (const [src, [op, target]] of Object.entries(forms)) {
    const r = parse(src).commands[0].redirs[0];
    assert.deepEqual([r.op, r.target.text], [op, target], src);
  }
  assert.equal(parse('echo hi 2> err').commands[0].redirs[0].fd, 2);
  const dup = parse('make 2>&1 | tail -5').commands[0].redirs[0];
  assert.deepEqual([dup.op, dup.fd, dup.target.text], ['>&', 2, '1'], '2>&1 is a duplication, not a file');
});

test('a > inside quotes is not a redirection', () => {
  assert.equal(parse('grep ">" file').commands[0].redirs.length, 0);
  assert.equal(parse('echo "a>b" x').commands[0].redirs.length, 0);
  assert.equal(parse("node -e 'if (a > b) c()'").commands[0].redirs.length, 0);
  assert.equal(parse('git commit -m "a -> b"').commands[0].redirs.length, 0);
});

test('a redirection to a variable is dynamic', () => {
  assert.equal(parse('echo hi > $x').commands[0].redirs[0].target.dynamic, true);
});

test('heredoc bodies are data: operators inside them neither split nor redirect', () => {
  const r = parse("cat <<'EOF' > docs/a.md\nbody > not-a-redirect; rm -rf x && git commit -n\nEOF\nls docs");
  assert.deepEqual(r.commands.map(texts), [['cat'], ['ls', 'docs']]);
  assert.equal(r.commands[0].redirs.find((x) => x.op === '>').target.text, 'docs/a.md');
  assert.equal(r.unbalanced, false);
  assert.deepEqual(all('cat <<-EOF\n\tx\n\tEOF\necho done'), [['cat'], ['echo', 'done']]);
});

test('a here-string is data', () => {
  const r = parse('tee f <<< "a > b; c"');
  assert.deepEqual(r.commands.map(texts), [['tee', 'f']]);
});

test('command and process substitutions are parsed too, and marked nested', () => {
  const r = parse('echo $(git commit -n) `rm x` "$(cp a b)"');
  const nested = r.commands.filter((c) => c.nested).map(texts);
  assert.deepEqual(nested, [['git', 'commit', '-n'], ['rm', 'x'], ['cp', 'a', 'b']]);
  assert.equal(r.commands.find((c) => !c.nested).words[1].dynamic, true);
});

test('commandWord skips assignments and wrappers; baseName strips directories and .exe', () => {
  const idx = (s) => sp.commandWord(parse(s).commands[0].words);
  assert.equal(idx('FOO=1 BAR=2 git status'), 2);
  assert.equal(idx('env -i FOO=1 git status'), 3);
  assert.equal(idx('command git status'), 1);
  assert.equal(idx('sudo -u me cp a b') >= 1, true);
  assert.equal(idx('git status'), 0);
  assert.equal(sp.baseName('C:\\Program Files\\Git\\cmd\\git.exe'), 'git');
  assert.equal(sp.baseName('/usr/bin/GIT'), 'git');
});

test('PowerShell here-strings and backslash paths survive', () => {
  assert.deepEqual(all("Set-Content -Path docs\\a.md -Value @'\nline > one\n'@"), [['Set-Content', '-Path', 'docs\\a.md', '-Value', '@\nline > one\n@']]);
  assert.deepEqual(all('copy C:\\a\\b.txt D:\\c'), [['copy', 'C:\\a\\b.txt', 'D:\\c']]);
});

test('malformed input never throws: unbalanced quotes, empty, huge, odd bytes', () => {
  assert.equal(parse('echo "abc').unbalanced, true);
  assert.equal(parse("echo 'abc").unbalanced, true);
  assert.equal(parse('echo $(unclosed').unbalanced, true);
  assert.deepEqual(parse('').commands, []);
  assert.deepEqual(parse('   \n  ').commands, []);
  assert.deepEqual(parse(undefined).commands, []);
  parse('a\0b > \u00e9\u2713');
  const big = `echo ${'x'.repeat(1_000_000)} > docs/a.md`;
  const t0 = Date.now();
  const r = parse(big);
  assert.ok(Date.now() - t0 < 3000, 'a 1 MB command is parsed well inside the 10 s hook limit');
  assert.equal(r.commands[0].redirs[0].target.text, 'docs/a.md');
  const deep = '$('.repeat(500) + 'x' + ')'.repeat(500);
  assert.doesNotThrow(() => parse(deep));
});
