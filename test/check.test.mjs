import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputError, check, extract, formatReport, readSource, srtSource, textSource, wordsSource } from '../src/index.mjs';

const manifest = {
  version: 1,
  facts: [
    { id: 'price', value: '49.90', unit: 'BRL', source: 'https://example.com/pricing', context: 'monthly plan' },
    { id: 'discount', value: 20, unit: 'percent', source: 'pricing page' },
    { id: 'team', value: 120, source: 'headcount sheet' },
    { id: 'launch', value: '2026-03-05', unit: 'date', source: 'press release' },
    { id: 'unused', value: 999, source: 'nowhere' },
  ],
  ignore: [{ value: 2026, reason: 'the year as a label' }],
};

const run = (text, options) => check(textSource(text), manifest, options);
const kinds = (r) => r.findings.map((f) => `${f.type}:${f.unit ?? f.reason}:${f.value ?? f.text}`);

test('an unsupported claim is a finding; a registered value is supported', () => {
  const r = run('O plano custa R$ 59,90 e R$ 49,90.');
  assert.equal(r.clean, false);
  assert.deepEqual(kinds(r), ['unsupported:BRL:59.9']);
  assert.equal(r.supported.length, 1);
  assert.deepEqual(r.supported[0].facts, [{ id: 'price', source: 'https://example.com/pricing', context: 'monthly plan' }]);
});

test('currency vs percent: 20 reais does not match a 20% fact, and 20% does not match 20 reais', () => {
  assert.deepEqual(kinds(run('São 20 reais.')), ['unsupported:BRL:20']);
  assert.deepEqual(kinds(run('São 20%.')), []);
  assert.deepEqual(kinds(run('São vinte por cento.')), []);
  assert.deepEqual(kinds(run('São 49,90%.')), ['unsupported:percent:49.9'], 'the BRL fact does not cover a percent');
  assert.deepEqual(kinds(run('São 20.')), ['unsupported:number:20']);
});

test('boundary: 120 is supported by its own fact and says nothing about 20', () => {
  assert.deepEqual(kinds(run('Somos 120.')), []);
  assert.deepEqual(kinds(run('Somos cento e vinte.')), []);
  assert.deepEqual(kinds(run('Somos 20.')), ['unsupported:number:20']);
  assert.deepEqual(kinds(run('Somos 1200.')), ['unsupported:number:1200']);
});

test('1.234,56 versus 1,5: each is its own value', () => {
  const r = check(textSource('Reajuste de 1.234,56 e de 1,5.'), { version: 1, facts: [{ id: 'a', value: '1.5', source: 's' }] });
  assert.deepEqual(kinds(r), ['unsupported:number:1234.56']);
});

test('ignore rules cover a value with the stated reason, and are reported separately', () => {
  const r = run('Em 2026 o plano segue.');
  assert.equal(r.clean, true);
  assert.deepEqual(r.ignored.map((i) => [i.value, i.reason]), [['2026', 'the year as a label']]);
  assert.equal(r.summary.ignored, 1);
});

test('dates are compared as dates', () => {
  assert.deepEqual(kinds(run('Lançamos em 05/03/2026, em 5 de março de 2026 e em cinco de março de 2026.')), []);
  assert.deepEqual(kinds(run('Lançamos em 06/03/2026.')), ['unsupported:date:2026-03-06']);
  assert.deepEqual(kinds(run('Lançamos em 5 de março.')), ['unsupported:date:--03-05'], 'a date without a year is a different value');
});

test('unparsed text is a finding too: it is never swallowed', () => {
  const r = run('Pagou 3.5 e 31 de fevereiro.');
  assert.equal(r.clean, false);
  assert.deepEqual(r.findings.map((f) => f.type), ['unparsed', 'unparsed']);
  assert.equal(r.summary.unparsed, 2);
});

test('the report carries the sentence around each finding, one line, clipped', () => {
  const r = run('Primeira frase. O plano custa R$ 59,90 por mês.\nOutra frase.');
  assert.equal(r.findings[0].sentence, 'O plano custa R$ 59,90 por mês.');
  const long = run(`${'palavra '.repeat(100)}R$ 59,90 ${'palavra '.repeat(100)}`);
  assert.ok(long.findings[0].sentence.length <= 160);
  assert.match(long.findings[0].sentence, /59,90/);
});

test('text location: line and column of the reference, 1-based', () => {
  const r = run('linha um\nO plano custa R$ 59,90 hoje.\r\nlinha final com 77');
  assert.deepEqual(r.findings.map((f) => f.location), [{ line: 2, column: 15 }, { line: 3, column: 17 }]);
  const bom = check(textSource('﻿77'), manifest);
  assert.deepEqual(bom.findings[0].location, { line: 1, column: 1 }, 'a BOM does not shift columns');
});

test('omissions are counted by kind and unused facts are listed', () => {
  const r = run('Um homem do zero. Uma casa.');
  assert.deepEqual(r.summary.omittedByKind, { article: 2, idiom: 1 });
  assert.deepEqual(r.unusedFacts, ['price', 'discount', 'team', 'launch', 'unused']);
  assert.equal(run('Somos 120.').unusedFacts.includes('team'), false);
});

test('includeArticles turns the lone-article skip off', () => {
  assert.equal(run('Um homem.').summary.mentions, 0);
  const r = run('Um homem.', { includeArticles: true });
  assert.deepEqual(kinds(r), ['unsupported:number:1']);
});

test('SRT: cue numbers and timestamps are structure, not facts; tags are ignored; locations carry the cue start', () => {
  const srt = [
    '1', '00:00:01,000 --> 00:00:03,500', 'O plano custa R$ 49,90.', '',
    '2', '00:00:04,000 --> 00:00:07,250', 'São <i>vinte por cento</i> de desconto', 'e cento e cinquenta {\\an8}clientes.', '',
    '3', '00:01:10,500 --> 00:01:12,000', 'Fim em 2026.', '',
  ].join('\n');
  const source = srtSource(srt);
  const found = extract(source);
  assert.deepEqual(found.mentions.map((m) => m.raw), ['R$ 49,90', 'vinte por cento', 'cento e cinquenta', '2026']);
  const r = check(source, manifest);
  assert.deepEqual(kinds(r), ['unsupported:number:150']);
  assert.deepEqual(r.findings[0].location, { line: 8, column: 3, cue: 2, start: 4, end: 7.25 });
  assert.equal(r.findings[0].sentence.includes('<i>'), false);
  assert.deepEqual(extract(source).mentions[3].location, { line: 12, column: 8, cue: 3, start: 70.5, end: 72 });
});

test('SRT: a number can span two lines of a cue and CRLF files work', () => {
  const srt = '1\r\n00:00:00,000 --> 00:00:02,000\r\nsomos cento e\r\nvinte pessoas\r\n';
  const r = check(srtSource(srt), manifest);
  assert.equal(r.clean, true);
  assert.equal(r.supported[0].raw, 'cento e\nvinte');
});

test('SRT: malformed input is an InputError with the line number', () => {
  const bad = (srt, pattern) => assert.throws(() => srtSource(srt), (e) => e instanceof InputError && e.code === 'invalid-srt' && pattern.test(e.message), srt);
  bad('', /no cues/);
  bad('hello\n00:00:01,000 --> 00:00:02,000\nx', /line 1: expected a cue number/);
  bad('1\nnot a timestamp\nx', /line 2: expected a timestamp/);
  bad('1\n00:00:01,000 --> 00:00:00,500\nx', /line 2: the cue ends before it starts/);
  bad('1\n00:61:01,000 --> 00:62:02,000\nx', /line 2: expected a timestamp/);
  bad('1\n00:00:01,5 --> 00:00:02,0\nx', /line 2: expected a timestamp/);
  bad('1', /no timestamp/);
  bad('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nx', /WebVTT is not supported/);
  bad(`1\n00:00:01,000 --> 00:00:02,000\n${'x'.repeat(2001)}`, /longer than 2000/);
  assert.throws(() => srtSource('1\n00:00:01,000 --> 00:00:02,000\nx\0'), /NUL/);
});

test('words: the reference carries the start of the word where it begins', () => {
  const words = [
    { word: 'Custa', start: 0.1 }, { word: 'R$', start: 0.5, end: 0.8 }, { word: '59,90', start: 0.8, end: 1.2 },
    { word: 'e', start: 1.3 }, { word: 'cento', start: 1.4 }, { word: 'e', start: 1.6 }, { word: 'cinquenta', start: 1.7, end: 2.1 }, { word: 'pessoas.', start: 2.2 },
  ];
  const r = check(wordsSource(words), manifest);
  assert.deepEqual(kinds(r), ['unsupported:BRL:59.9', 'unsupported:number:150']);
  assert.deepEqual(r.findings[0].location, { wordIndex: 1, start: 0.5, end: 0.8 });
  assert.deepEqual(r.findings[1].location, { wordIndex: 4, start: 1.4 });
  const viaObject = check(wordsSource({ words }), manifest);
  assert.deepEqual(viaObject.findings, r.findings);
  const viaJson = check(readSource('words', JSON.stringify({ words })), manifest);
  assert.deepEqual(viaJson.findings, r.findings);
});

test('words: malformed lists are rejected with every problem and its path', () => {
  const bad = (input) => {
    try {
      wordsSource(input);
    } catch (e) {
      assert.ok(e instanceof InputError, String(e));
      assert.equal(e.code, 'invalid-words');
      return `${e.message}\n${e.details.join('\n')}`;
    }
    assert.fail('expected an InputError');
  };
  assert.match(bad('not json'), /not valid JSON/);
  assert.match(bad('{"nope":[]}'), /expected a list/);
  assert.match(bad('[]'), /list is empty/);
  assert.match(bad([{ word: 'a' }]), /words\[0\]\.start/);
  assert.match(bad([{ start: 1 }]), /words\[0\]\.word: expected a non-empty string/);
  assert.match(bad([{ word: '  ', start: 1 }]), /words\[0\]\.word: expected a non-empty string/);
  assert.match(bad([{ word: 'a', start: '1' }]), /words\[0\]\.start/);
  assert.match(bad([{ word: 'a', start: -1 }]), /words\[0\]\.start/);
  assert.match(bad([{ word: 'a', start: NaN }]), /words\[0\]\.start/);
  assert.match(bad([{ word: 'a', start: 2 }, { word: 'b', start: 1 }]), /words\[1\]\.start: start times must not decrease/);
  assert.match(bad([{ word: 'a', start: 2, end: 1 }]), /words\[0\]\.end/);
  assert.match(bad([{ word: 'a\nb', start: 1 }]), /no control characters/);
  assert.match(bad(['x', null, 5]), /words\[2\]: expected an object/);
  const many = bad(Array.from({ length: 100 }, () => ({})));
  assert.match(many, /at least 25 problem/);
});

test('words: extra keys such as confidence are tolerated', () => {
  const r = check(wordsSource([{ word: 'Somos', start: 0, confidence: 0.9 }, { word: '120', start: 0.5, speaker: 'A' }]), manifest);
  assert.equal(r.clean, true);
});

test('check validates the manifest and refuses an invalid one', () => {
  assert.throws(() => check(textSource('x'), { version: 1, facts: [{ id: 'a', value: 1 }] }), (e) => e instanceof InputError && e.code === 'invalid-facts');
});

test('readSource rejects an unknown format and oversized input', () => {
  assert.throws(() => readSource('docx', 'x'), (e) => e.code === 'usage');
  assert.throws(() => textSource('x'.repeat(4 * 1024 * 1024 + 1)), (e) => e.code === 'too-large');
});

test('the human report names the finding, the place, the sentence and the way out', () => {
  const r = run('O plano custa R$ 59,90.');
  const text = formatReport(r, { factsLabel: 'facts.json' });
  assert.match(text, /1 finding\. 1 reference: 0 supported, 0 ignored, 1 unsupported, 0 unparsed against facts\.json \(5 facts, 1 ignore rule\)/);
  assert.match(text, /1\. unsupported: "R\$ 59,90" \(BRL 59\.9\) has no matching fact/);
  assert.match(text, /line 1, column 15/);
  assert.match(text, /"O plano custa R\$ 59,90\."/);
  assert.match(text, /Add a fact \(with a source\)/);
});

test('terminal output of untrusted text cannot carry escape sequences or bidi overrides', () => {
  const r = run('Pagou \u001b[31mR$ 59,90\u001b[0m ‮ e 77');
  const text = formatReport(r);
  assert.equal(/[\u001b‮]/.test(text), false);
  assert.match(text, /\\u\{1b\}/);
});

test('a clean report says what "supported" does and does not mean', () => {
  const text = formatReport(run('Somos 120.'));
  assert.match(text, /clean\./);
  assert.match(text, /does not mean the fact is true/);
});
