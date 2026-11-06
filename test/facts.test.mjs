import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputError, LIMITS, parseFactsJson, validateFacts } from '../src/index.mjs';

const ok = { id: 'price', value: '49.90', unit: 'BRL', source: 'https://example.com/pricing' };
const valid = (extra = {}) => ({ version: 1, facts: [ok], ...extra });

function errorsOf(input) {
  const r = validateFacts(input);
  assert.equal(r.ok, false, 'expected the manifest to be rejected');
  return r.errors.join('\n');
}

test('a valid manifest is normalized: canonical values, default unit, trimmed strings', () => {
  const r = validateFacts({
    version: 1,
    facts: [
      { id: 'a', value: '1234.50', unit: 'BRL', source: ' https://example.com/x ', context: ' note ' },
      { id: 'b', value: 20, source: 'contract.pdf p.3' },
      { id: 'c', value: '2026-03-05', unit: 'date', source: 'ref' },
      { id: 'd', value: '--02-29', unit: 'date', source: 'ref' },
    ],
    ignore: [{ value: 2026, reason: 'a year' }],
  });
  assert.equal(r.ok, true, r.errors?.join('\n'));
  assert.deepEqual(r.manifest.facts[0], { id: 'a', value: '1234.5', unit: 'BRL', source: 'https://example.com/x', context: 'note' });
  assert.deepEqual(r.manifest.facts[1], { id: 'b', value: '20', unit: 'number', source: 'contract.pdf p.3' });
  assert.deepEqual(r.manifest.ignore, [{ value: '2026', unit: 'number', reason: 'a year' }]);
});

test('the source is mandatory and must say something', () => {
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1 }] }), /facts\[0\]\.source: required/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1, source: '' }] }), /source: must not be empty/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1, source: '   ' }] }), /source: must not be empty/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1, source: 42 }] }), /source: expected a string/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1, source: 'x'.repeat(LIMITS.maxFactStringLength + 1) }] }), /source: longer than/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1, source: 'ok‮evil' }] }), /control or bidirectional/);
});

test('URL sources must be http(s); plain references are free text', () => {
  for (const bad of ['javascript://x', 'file:///etc/passwd', 'ftp://example.com/a', 'https://']) {
    assert.match(errorsOf({ version: 1, facts: [{ id: 'a', value: 1, source: bad }] }), /valid http or https URL/, bad);
  }
  assert.equal(validateFacts({ version: 1, facts: [{ id: 'a', value: 1, source: 'javascript:alert(1) is just text here' }] }).ok, true);
});

test('unknown keys are rejected everywhere, including __proto__', () => {
  assert.match(errorsOf({ ...valid(), extra: 1 }), /\$\.extra: unknown key/);
  assert.match(errorsOf({ version: 1, facts: [{ ...ok, note: 'x' }] }), /facts\[0\]\.note: unknown key/);
  assert.match(errorsOf({ version: 1, facts: [ok], ignore: [{ value: 1, reason: 'r', why: 'x' }] }), /ignore\[0\]\.why: unknown key/);
  const polluted = JSON.parse('{"version":1,"facts":[],"__proto__":{"admin":true}}');
  assert.match(errorsOf(polluted), /unknown key/);
  assert.equal({}.admin, undefined);
});

test('types and shapes: root, version, lists, entries', () => {
  for (const bad of [null, [], 'text', 5]) assert.match(errorsOf(bad), /expected an object/);
  assert.match(errorsOf({ facts: [] }), /version: required and must be 1/);
  assert.match(errorsOf({ version: '1', facts: [] }), /version: required and must be 1/);
  assert.match(errorsOf({ version: 1 }), /facts: required/);
  assert.match(errorsOf({ version: 1, facts: {} }), /facts: required, expected a list/);
  assert.match(errorsOf({ version: 1, facts: [], ignore: {} }), /ignore: expected a list/);
  assert.match(errorsOf({ version: 1, facts: [null] }), /facts\[0\]: expected an object/);
  assert.match(errorsOf({ version: 1, facts: [ok], ignore: ['x'] }), /ignore\[0\]: expected an object/);
});

test('ids: required, non-empty, well formed, unique', () => {
  assert.match(errorsOf({ version: 1, facts: [{ value: 1, source: 's' }] }), /facts\[0\]\.id: required/);
  assert.match(errorsOf({ version: 1, facts: [{ id: '', value: 1, source: 's' }] }), /id: must not be empty/);
  assert.match(errorsOf({ version: 1, facts: [{ id: '-x', value: 1, source: 's' }] }), /id: use letters/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'has space', value: 1, source: 's' }] }), /id: use letters/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'x'.repeat(LIMITS.maxIdLength + 1), value: 1, source: 's' }] }), /id: longer than/);
  assert.match(errorsOf({ version: 1, facts: [ok, ok] }), /facts\[1\]\.id: duplicate id/);
});

test('values: plain decimals only, no locale formats, no zero-length, no overflow', () => {
  const v = (value, unit) => errorsOf({ version: 1, facts: [{ id: 'a', value, unit, source: 's' }] });
  assert.match(v('1.234,56'), /not a plain decimal/);
  assert.match(v('1,5'), /not a plain decimal/);
  assert.match(v('20%'), /not a plain decimal/);
  assert.match(v('R$ 20'), /not a plain decimal/);
  assert.match(v(''), /not a plain decimal/);
  assert.match(v('-5'), /not a plain decimal/);
  assert.match(v(-5), /not be negative|not negative/);
  assert.match(v(1e21), /too large/);
  assert.match(v('007'), /leading zero/);
  assert.match(v('1'.repeat(25)), /not a plain decimal/);
  assert.match(v(null), /expected a JSON number/);
  assert.match(v(true), /expected a JSON number/);
  assert.match(v({ n: 1 }), /expected a JSON number/);
  assert.match(errorsOf({ version: 1, facts: [{ id: 'a', source: 's' }] }), /value: required/);
});

test('units: a closed set; dates must be real calendar dates', () => {
  const v = (value, unit) => errorsOf({ version: 1, facts: [{ id: 'a', value, unit, source: 's' }] });
  assert.match(v(1, 'USD'), /unit: expected one of number, percent, BRL, date/);
  assert.match(v(1, ''), /unit: expected one of/);
  assert.match(v(1, 5), /unit: expected one of/);
  assert.match(v('2026-02-30', 'date'), /not a calendar date/);
  assert.match(v('2026-13-01', 'date'), /not a calendar date/);
  assert.match(v('2026-02-29', 'date'), /not a calendar date/);
  assert.match(v('--04-31', 'date'), /not a calendar date/);
  assert.match(v('05/03/2026', 'date'), /must look like/);
  assert.match(v(20260305, 'date'), /must be a string/);
});

test('ignore rules need a non-empty reason and may not contradict a fact', () => {
  const rule = (r) => errorsOf({ version: 1, facts: [ok], ignore: [r] });
  assert.match(rule({ value: 1 }), /ignore\[0\]\.reason: required/);
  assert.match(rule({ value: 1, reason: '' }), /reason: must not be empty/);
  assert.match(rule({ value: 1, reason: '   ' }), /reason: must not be empty/);
  assert.match(rule({ value: 1, reason: 5 }), /reason: expected a string/);
  assert.match(rule({ reason: 'x' }), /value: required/);
  assert.match(rule({ value: '49.9', unit: 'BRL', reason: 'x' }), /both a fact and an ignore rule/);
  assert.match(errorsOf({ version: 1, facts: [], ignore: [{ value: 1, reason: 'a' }, { value: '1.0', reason: 'b' }] }), /duplicate ignore rule/);
});

test('every problem is reported together, with its path', () => {
  const e = errorsOf({ version: 1, facts: [{ id: '', value: 'x', unit: 'USD' }, { id: 'ok', value: 1 }] });
  assert.match(e, /facts\[0\]\.id/);
  assert.match(e, /facts\[0\]\.source/);
  assert.match(e, /facts\[0\]\.unit/);
  assert.match(e, /facts\[1\]\.source/);
});

test('size limits on the number of entries', () => {
  const many = Array.from({ length: LIMITS.maxFacts + 1 }, (_, i) => ({ id: `f${i}`, value: i, source: 's' }));
  assert.match(errorsOf({ version: 1, facts: many }), /more than 5000 entries/);
  const rules = Array.from({ length: LIMITS.maxIgnoreRules + 1 }, (_, i) => ({ value: i, reason: 'r' }));
  assert.match(errorsOf({ version: 1, facts: [], ignore: rules }), /more than 5000 entries/);
});

test('parseFactsJson: JSON only, never evaluated; failures are InputError', () => {
  assert.equal(parseFactsJson(JSON.stringify(valid())).facts.length, 1);
  assert.equal(parseFactsJson(`﻿${JSON.stringify(valid())}`).facts.length, 1, 'a BOM is tolerated');
  for (const bad of ['', '{', '{"version":1,"facts":[],}', 'module.exports = {}', '({"version":1,"facts":[]})']) {
    assert.throws(() => parseFactsJson(bad), (e) => e instanceof InputError && e.code === 'invalid-facts', bad);
  }
  assert.throws(() => parseFactsJson(JSON.stringify({ version: 1 })), (e) => e instanceof InputError && e.details.length > 0);
  assert.throws(() => parseFactsJson('x'.repeat(LIMITS.maxFactsBytes + 1)), (e) => e.code === 'too-large');
});
