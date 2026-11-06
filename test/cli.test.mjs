import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, cliBytes, fixture, put, tempDir } from './helpers.mjs';

const FACTS = fixture('facts.json');

test('--help: usage on stdout, exit 0, documents the exit codes', () => {
  for (const flag of ['--help', '-h']) {
    const r = cli([flag]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /Usage:/);
    assert.match(r.stdout, /--facts <file>/);
    assert.match(r.stdout, /--format <format>/);
    assert.match(r.stdout, /0 {2}no findings/);
    assert.match(r.stdout, /1 {2}findings/);
    assert.match(r.stdout, /2 {2}invalid input or usage/);
  }
});

test('--version prints the package version', () => {
  const r = cli(['--version']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^0\.1\.0\n$/);
});

test('exit 0: a clean text, with the report on stdout', () => {
  const r = cli(['check', fixture('script-clean.txt'), '--facts', FACTS]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /numeros-ptbr: clean\. 5 references: 4 supported, 1 ignored/);
  assert.match(r.stdout, /Skipped by documented heuristics: article 2/);
  assert.equal(r.stderr, '');
});

test('"check" is optional: the first argument may already be the input', () => {
  const r = cli([fixture('script-clean.txt'), '--facts', FACTS]);
  assert.equal(r.code, 0, r.stderr);
});

test('exit 1: findings, with the number, the place and the sentence', () => {
  const r = cli(['check', fixture('script-findings.txt'), '--facts', FACTS]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /4 findings\./);
  assert.match(r.stdout, /unsupported: "20 reais" \(BRL 20\) has no matching fact/);
  assert.match(r.stdout, /line 2, column \d+/);
  assert.match(r.stdout, /"Hoje são vinte por cento de desconto, mas já chegamos a 20 reais de desconto\."/);
  assert.match(r.stdout, /unsupported: "20" \(number 20\)/);
  assert.match(r.stdout, /unsupported: "1\.234,56" \(number 1234\.56\)/);
  assert.match(r.stdout, /unsupported: "1,5 por cento" \(percent 1\.5\)/);
  assert.equal(r.stderr, '');
});

test('--json: one parseable report; exit code still follows the findings', () => {
  const r = cli(['check', fixture('script-findings.txt'), '--facts', FACTS, '--json']);
  assert.equal(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.tool, 'numeros-ptbr');
  assert.equal(report.clean, false);
  assert.equal(report.format, 'text');
  assert.deepEqual(report.findings.map((f) => `${f.unit}:${f.value}`), ['BRL:20', 'number:20', 'number:1234.56', 'percent:1.5']);
  assert.equal(report.findings[0].type, 'unsupported');
  assert.deepEqual(report.findings[0].location, { line: 2, column: 57 });
  assert.equal(report.summary.supported, 3);
  const clean = JSON.parse(cli(['check', fixture('script-clean.txt'), '--facts', FACTS, '--json']).stdout);
  assert.equal(clean.clean, true);
  assert.deepEqual(clean.unusedFacts, []);
});

test('SRT: format inferred from .srt, cue and start time reported, structure not read as numbers', () => {
  const r = cli([fixture('sample.srt'), '--facts', FACTS, '--json']);
  assert.equal(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.format, 'srt');
  assert.equal(report.summary.mentions, 4, 'cue numbers and timestamps are not references');
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].value, '150');
  assert.deepEqual(report.findings[0].location, { line: 8, column: 3, cue: 2, start: 4, end: 7.2 });
  const human = cli([fixture('sample.srt'), '--facts', FACTS]).stdout;
  assert.match(human, /cue 2, at 00:00:04\.000, line 8, column 3/);
});

test('words: format inferred from .json, word index and start time reported', () => {
  const r = cli([fixture('words.json'), '--facts', FACTS, '--json']);
  assert.equal(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.format, 'words');
  assert.deepEqual(report.findings.map((f) => `${f.unit}:${f.value}`), ['number:35']);
  assert.deepEqual(report.findings[0].location, { wordIndex: 12, start: 3.9, end: 4.3 });
  assert.match(cli([fixture('words.json'), '--facts', FACTS]).stdout, /word 12, at 00:00:03\.900/);
});

test('--format overrides the extension', (t) => {
  const dir = tempDir(t);
  const file = put(dir, 'cues.txt', '1\n00:00:01,000 --> 00:00:02,000\nSomos 120.\n');
  assert.equal(cli([file, '--facts', FACTS]).code, 1, 'as plain text the cue number is a number, the timestamp is not a fact');
  const asText = JSON.parse(cli([file, '--facts', FACTS, '--json']).stdout);
  assert.equal(asText.format, 'text');
  const asSrt = JSON.parse(cli([file, '--facts', FACTS, '--format', 'srt', '--json']).stdout);
  assert.equal(asSrt.format, 'srt');
  assert.equal(asSrt.summary.mentions, 1);
  assert.equal(cli([file, '--facts', FACTS, '--format=srt']).code, 0);
});

test('standard input with "-"', () => {
  const r = cli(['-', '--facts', FACTS], { input: 'Somos 120 e R$ 59,90.' });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /"R\$ 59,90" \(BRL 59\.9\)/);
  const srt = cli(['-', '--facts', FACTS, '--format', 'srt', '--json'], { input: '1\n00:00:01,000 --> 00:00:02,000\nSomos 120.\n' });
  assert.equal(srt.code, 0);
});

test('--verbose lists supported, ignored and skipped items', () => {
  const r = cli(['check', fixture('script-clean.txt'), '--facts', FACTS, '--verbose']);
  assert.match(r.stdout, /supported: "R\$ 49,90" \(BRL 49\.9\) by plan-price \[https:\/\/example\.com\/pricing\]/);
  assert.match(r.stdout, /ignored: "2026" \(number 2026\): The current year used as a label/);
  assert.match(r.stdout, /skipped article: "Um"/);
});

test('--include-articles extracts the lone um/uma', () => {
  const r = cli(['check', fixture('script-clean.txt'), '--facts', FACTS, '--include-articles', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout).findings.map((f) => f.raw), ['Um', 'uma']);
});

test('extract: lists references without a manifest, exit 0', () => {
  const r = cli(['extract', fixture('script-findings.txt')]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /"vinte por cento" -> percent 20 \[words\]/);
  assert.match(r.stdout, /"R\$ 49,90" -> BRL 49\.9 \[digits\]/);
  const json = JSON.parse(cli(['extract', fixture('script-findings.txt'), '--json']).stdout);
  assert.equal(json.mentions.length, 7);
  assert.equal(cli(['extract', fixture('script-findings.txt'), '--facts', FACTS]).code, 2, 'extract does not take --facts');
});

// ---- exit 2: usage and invalid input

const usage = (args, pattern, options) => {
  const r = cli(args, options);
  assert.equal(r.code, 2, `${args.join(' ')} -> ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, pattern);
  return r;
};

test('exit 2: usage errors', () => {
  usage([], /missing <input>/);
  usage(['check'], /missing <input>/);
  usage([fixture('script-clean.txt')], /needs --facts/);
  usage([fixture('script-clean.txt'), '--facts'], /--facts needs a value/);
  usage([fixture('script-clean.txt'), '--facts', FACTS, '--bogus'], /unknown option --bogus/);
  usage([fixture('script-clean.txt'), '--facts', FACTS, '--format', 'docx'], /--format must be text, srt or words/);
  usage([fixture('script-clean.txt'), '--facts', FACTS, '--facts', FACTS], /--facts given more than once/);
  usage([fixture('script-clean.txt'), fixture('script-findings.txt'), '--facts', FACTS], /only one <input>/);
  usage([fixture('script-clean.txt'), '--facts', FACTS, '--json=1'], /--json does not take a value/);
});

test('exit 2: missing or unreadable files, and folders are never read', (t) => {
  const dir = tempDir(t);
  usage([join(dir, 'nope.txt'), '--facts', FACTS], /input: cannot read .*ENOENT/);
  usage([fixture('script-clean.txt'), '--facts', join(dir, 'nope.json')], /facts: cannot read .*ENOENT/);
  mkdirSync(join(dir, 'folder'));
  put(join(dir, 'folder'), 'a.txt', 'Somos 20.');
  usage([join(dir, 'folder'), '--facts', FACTS], /not a file \(folders are never read\)/);
  usage([fixture('script-clean.txt'), '--facts', dir], /facts: .* is not a file/);
  usage([join(dir, '*.txt'), '--facts', FACTS], /cannot read/, {});
});

test('exit 2: invalid UTF-8 and binary input', (t) => {
  const dir = tempDir(t);
  const bad = join(dir, 'bad.txt');
  writeFileSync(bad, Buffer.from([0x53, 0x6f, 0x6d, 0x6f, 0x73, 0xff, 0xfe, 0x20, 0x32, 0x30]));
  usage([bad, '--facts', FACTS], /input: not valid UTF-8/);
  const nul = join(dir, 'nul.txt');
  writeFileSync(nul, Buffer.from('abc\0def'));
  usage([nul, '--facts', FACTS], /NUL/);
  const r = cliBytes(['-', '--facts', FACTS], Buffer.from([0xc3, 0x28]));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not valid UTF-8/);
});

test('exit 2: oversized input is refused before it is read', (t) => {
  const dir = tempDir(t);
  const big = join(dir, 'big.txt');
  writeFileSync(big, Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
  usage([big, '--facts', FACTS], /larger than 4194304 bytes/);
  const bigFacts = join(dir, 'big.json');
  writeFileSync(bigFacts, Buffer.alloc(1024 * 1024 + 1, 0x20));
  usage([fixture('script-clean.txt'), '--facts', bigFacts], /facts: .* larger than 1048576 bytes/);
});

test('exit 2: malformed facts, every problem listed with its path', (t) => {
  const dir = tempDir(t);
  const facts = put(dir, 'facts.json', JSON.stringify({ version: 1, facts: [{ id: 'a', value: '1,5', source: '' }, { id: 'a', value: 1 }], extra: true }));
  const r = usage([fixture('script-clean.txt'), '--facts', facts], /facts manifest is invalid \(\d+ problems?\)/);
  assert.match(r.stderr, /\$\.extra: unknown key/);
  assert.match(r.stderr, /facts\[0\]\.source: must not be empty/);
  assert.match(r.stderr, /facts\[0\]\.value: .* not a plain decimal/);
  assert.match(r.stderr, /facts\[1\]\.source: required/);
  usage([fixture('script-clean.txt'), '--facts', put(dir, 'broken.json', '{"version": 1,')], /facts: not valid JSON/);
  usage([fixture('script-clean.txt'), '--facts', put(dir, 'js.json', 'process.exit(0)')], /facts: not valid JSON/);
});

test('exit 2: malformed SRT names the line', (t) => {
  const dir = tempDir(t);
  usage([put(dir, 'a.srt', '1\nnot a timestamp\nSomos 120.\n'), '--facts', FACTS], /srt: line 2: expected a timestamp line/);
  usage([put(dir, 'b.srt', ''), '--facts', FACTS], /srt: no cues found/);
  usage([put(dir, 'c.srt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx\n'), '--facts', FACTS], /WebVTT is not supported/);
  usage([put(dir, 'd.srt', '1\n00:00:05,000 --> 00:00:01,000\nx\n'), '--facts', FACTS], /line 2: the cue ends before it starts/);
});

test('exit 2: malformed words list names the entry', (t) => {
  const dir = tempDir(t);
  const bad = (name, content, pattern) => usage([put(dir, name, content), '--facts', FACTS], pattern);
  bad('a.json', '{"words": [{"word": "Somos", "start": 0}, {"word": "", "start": 1}]}', /words\[1\]\.word: expected a non-empty string/);
  bad('b.json', '{"words": [{"word": "Somos"}]}', /words\[0\]\.start/);
  bad('c.json', '{"words": [{"word": "a", "start": "0.5"}]}', /words\[0\]\.start/);
  bad('d.json', '{"words": [{"word": "a", "start": 2}, {"word": "b", "start": 1}]}', /start times must not decrease/);
  bad('e.json', '{"words": []}', /list is empty/);
  bad('f.json', '{"words": "Somos 120"}', /expected a list/);
  bad('g.json', 'not json', /words: not valid JSON/);
});

test('--json: invalid input is reported as JSON on stdout with exit 2', () => {
  const r = cli([fixture('script-clean.txt'), '--facts', FACTS, '--format', 'bogus', '--json']);
  assert.equal(r.code, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'usage');
  assert.equal(r.stderr, '');
});

test('input text cannot reach the terminal as control sequences', (t) => {
  const dir = tempDir(t);
  const file = put(dir, 'evil.txt', 'Pagou \u001b[2J\u001b]0;pwned\u0007 R$ 59,90 ‮ agora.\n');
  const r = cli([file, '--facts', FACTS]);
  assert.equal(r.code, 1);
  assert.equal(/[\u001b\u0007‮]/.test(r.stdout + r.stderr), false);
});

test('a hostile path in an error message is printed safely', () => {
  const r = cli(['bad\u001b[2Jname.txt', '--facts', FACTS]);
  assert.equal(r.code, 2);
  assert.equal(/\u001b/.test(r.stderr), false);
});

test('runs from another working directory and never reads the current folder', (t) => {
  const dir = tempDir(t);
  put(dir, 'distraction.txt', 'Somos 1 milhão.');
  const r = cli([fixture('script-clean.txt'), '--facts', FACTS], { cwd: dir });
  assert.equal(r.code, 0);
});
