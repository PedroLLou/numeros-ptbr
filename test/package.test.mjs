import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function runNpm(args) {
  const env = { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
  const cliJs = process.env.npm_execpath;
  if (cliJs && cliJs.endsWith('.js')) {
    return spawnSync(process.execPath, [cliJs, ...args], { cwd: ROOT, encoding: 'utf8', env });
  }
  // Started outside npm: use the platform shim. npm.cmd needs a shell on Windows; the arguments are fixed constants.
  if (process.platform === 'win32') return spawnSync(['npm.cmd', ...args].join(' '), { cwd: ROOT, encoding: 'utf8', env, shell: true });
  return spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', env });
}

test('package.json: private, MIT, ESM, Node >= 22, no dependencies, no lifecycle scripts', () => {
  assert.equal(pkg.private, true, 'private blocks accidental publication');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(pkg[key], undefined, key);
  assert.equal(pkg.scripts.test, 'node --test');
  assert.ok(!pkg.scripts.postinstall && !pkg.scripts.install && !pkg.scripts.prepare);
});

test('package.json carries the GitHub repository metadata and stays private', () => {
  assert.equal(pkg.repository.url, 'git+https://github.com/PedroLLou/numeros-ptbr.git');
  assert.equal(pkg.bugs.url, 'https://github.com/PedroLLou/numeros-ptbr/issues');
  assert.equal(pkg.homepage, 'https://github.com/PedroLLou/numeros-ptbr#readme');
  assert.equal(pkg.private, true);
});

test('bin and exports point at files that exist; the bin has a shebang; the legal files are present', () => {
  const bin = join(ROOT, pkg.bin['numeros-ptbr']);
  assert.ok(existsSync(bin));
  assert.ok(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node\n'));
  for (const t of [pkg.exports['.'].types, pkg.exports['.'].default]) assert.ok(existsSync(join(ROOT, t)), t);
  for (const f of ['LICENSE', 'README.md', 'README.pt-BR.md', 'PROVENANCE.md', 'SECURITY.md', '.gitignore', '.github/workflows/ci.yml']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  assert.match(readFileSync(join(ROOT, 'LICENSE'), 'utf8'), /^MIT License[\s\S]*Copyright \(c\) 2026 Pedro Lourenconi Lima/);
});

test('the package imports by its entry point and every export is declared in the .d.mts', async () => {
  const api = await import('../src/index.mjs');
  for (const name of ['check', 'extract', 'scanText', 'validateFacts', 'parseFactsJson', 'readSource', 'formatReport', 'LIMITS', 'THRESHOLDS', 'InputError']) {
    assert.ok(name in api, name);
  }
  const dts = readFileSync(join(ROOT, 'src', 'index.d.mts'), 'utf8');
  for (const name of Object.keys(api)) assert.match(dts, new RegExp(`export (?:function|const|class|type|interface) ${name}\\b`), `${name} is declared in index.d.mts`);
});

test('the source has no network, process, or code-evaluation APIs', () => {
  const dir = join(ROOT, 'src');
  const banned = /node:(?:http|https|http2|net|dgram|dns|tls|child_process|worker_threads|vm|cluster)|\bfetch\s*\(|\beval\s*\(|new Function\b|\bimport\s*\(|require\s*\(|process\.env/;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), banned, f);
  }
});

test('npm pack --dry-run lists exactly the intended files and nothing else', (t) => {
  const r = runNpm(['pack', '--dry-run', '--json', '--ignore-scripts']);
  if (r.error?.code === 'ENOENT') return t.skip('npm is not available');
  assert.equal(r.status, 0, r.stderr);
  const files = JSON.parse(r.stdout)[0].files.map((f) => f.path.replaceAll('\\', '/'));
  for (const needed of [
    'package.json', 'LICENSE', 'README.md', 'README.pt-BR.md', 'PROVENANCE.md', 'SECURITY.md',
    'bin/numeros-ptbr.mjs', 'src/index.mjs', 'src/index.d.mts', 'src/cli.mjs', 'src/extract.mjs',
    'fixtures/facts.json', 'fixtures/script-clean.txt', 'fixtures/script-findings.txt', 'fixtures/sample.srt', 'fixtures/words.json',
  ]) assert.ok(files.includes(needed), `missing from the tarball: ${needed}`);
  for (const f of files) {
    assert.ok(!f.startsWith('test/') && !f.startsWith('.github/') && !f.endsWith('.tmp') && !f.startsWith('.git') && !f.endsWith('.tgz'), `unexpected file in the tarball: ${f}`);
  }
});

test('the packaged CLI runs from the file list alone: the example script exits 0', (t) => {
  const r = runNpm(['run', 'example', '--silent']);
  if (r.error?.code === 'ENOENT') return t.skip('npm is not available');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /numeros-ptbr: clean\./);
});

test('the workflow covers Node 22 and 24 on ubuntu and windows without shell-specific syntax', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /ubuntu-latest/);
  assert.match(yml, /windows-latest/);
  assert.match(yml, /node: \[22, 24\]/);
  assert.match(yml, /npm test/);
  assert.match(yml, /npm run pack:dry/);
  assert.ok(!/powershell|pwsh|bash -c|\.ps1|\$\(/.test(yml));
});
