import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from '../src/index.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BIN = join(ROOT, 'bin', 'numeros-ptbr.mjs');
export const FIXTURES = join(ROOT, 'fixtures');
export const fixture = (name) => join(FIXTURES, name);

/** A fresh temp directory, removed after the test. */
export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'numeros-ptbr-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write a file in `dir` and return its path. */
export function put(dir, name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

/** Run the real CLI as a child process. */
export function cli(args, { input, cwd } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', input, cwd, timeout: 30000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Run the real CLI with raw bytes on stdin. */
export function cliBytes(args, bytes) {
  const r = spawnSync(process.execPath, [BIN, ...args], { input: bytes, timeout: 30000 });
  return { code: r.status, stdout: r.stdout.toString('utf8'), stderr: r.stderr.toString('utf8') };
}

/** "unit:value" strings for every reference found in a text, in order. */
export function refs(text, options) {
  return scanText(text, options).mentions.map((m) => `${m.unit}:${m.value}`);
}

export const facts = (extra = {}) => ({ version: 1, facts: [], ...extra });
