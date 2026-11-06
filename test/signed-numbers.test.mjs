import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, textSource } from '../src/index.mjs';

const manifest = { version: 1, facts: [{ id: 'positive', value: 20, unit: 'percent', source: 'synthetic-reference' }] };

test('a signed negative claim cannot be supported by a registered positive number', () => {
  for (const text of ['Variação de -20%.', 'Variação de −20%.', 'Variação de menos vinte por cento.']) {
    const report = check(textSource(text), manifest);
    assert.equal(report.clean, false, text);
    assert.equal(report.supported.length, 0, text);
    assert.equal(report.findings[0].type, 'unparsed', text);
    assert.equal(report.findings[0].reason, 'unsupported-sign', text);
  }
});

test('unsigned quantities remain matchable', () => {
  assert.equal(check(textSource('Variação de 20%.'), manifest).clean, true);
});
