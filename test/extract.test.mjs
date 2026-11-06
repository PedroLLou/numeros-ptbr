import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../src/index.mjs';
import { refs } from './helpers.mjs';

test('digits in pt-BR: thousands dot and decimal comma are told apart', () => {
  assert.deepEqual(refs('Pagou 1.234,56 e depois 1,5.'), ['number:1234.56', 'number:1.5']);
  assert.deepEqual(refs('São 1.234.567 itens.'), ['number:1234567']);
  assert.deepEqual(refs('Foram 20, 007 e 0,50.'), ['number:20', 'number:0.5'], 'a leading-zero code like 007 is not a quantity');
});

test('1.234,56 is not 1,5: values compare exactly, never as floats', () => {
  const [a, b] = scanText('1.234,56 e 1,5').mentions;
  assert.equal(a.value, '1234.56');
  assert.equal(b.value, '1.5');
  assert.deepEqual(refs('R$ 1234,560 e R$ 1.234,56'), ['BRL:1234.56', 'BRL:1234.56']);
  assert.deepEqual(refs('123456789012345678,25'), ['number:123456789012345678.25'], 'no precision loss on long values');
});

test('percent and currency are units, not parts of the number', () => {
  assert.deepEqual(refs('20% de desconto'), ['percent:20']);
  assert.deepEqual(refs('20 % de desconto'), ['percent:20']);
  assert.deepEqual(refs('R$ 49,90 e R$49,90 e r$ 5'), ['BRL:49.9', 'BRL:49.9', 'BRL:5']);
  assert.deepEqual(refs('20 reais e 1 real e 50 centavos'), ['BRL:20', 'BRL:1', 'BRL:0.5']);
  assert.deepEqual(refs('20 por cento'), ['percent:20']);
  assert.deepEqual(refs('3 mil, 2,5 milhões e R$ 3 mil e 2 milhões de reais'), ['number:3000', 'number:2500000', 'BRL:3000', 'BRL:2000000']);
});

test('20 reais is not 20%, and 20 is not part of 120', () => {
  assert.deepEqual(refs('20 reais, 20% e 20'), ['BRL:20', 'percent:20', 'number:20']);
  assert.deepEqual(refs('Eram 120 pessoas'), ['number:120']);
  assert.deepEqual(refs('Eram cento e vinte pessoas e vinte reais'), ['number:120', 'BRL:20']);
  assert.deepEqual(refs('cem e vinte'), ['number:100', 'number:20'], '"cem" never absorbs a following "e vinte"');
  assert.deepEqual(refs('US$ 20'), ['number:20'], 'other currencies are not read as BRL');
});

test('spelled-out numbers: hundreds, thousands, millions and their variants', () => {
  const cases = [
    ['zero', '0'], ['dez', '10'], ['catorze', '14'], ['quatorze', '14'], ['dezesseis', '16'],
    ['vinte e um', '21'], ['trinta e cinco', '35'], ['noventa e nove', '99'],
    ['cem', '100'], ['cento e um', '101'], ['cento e vinte', '120'], ['cento e dezenove', '119'],
    ['duzentos', '200'], ['duzentas e cinquenta', '250'], ['trezentos e quarenta e dois', '342'], ['novecentos e noventa e nove', '999'],
    ['mil', '1000'], ['mil e quinhentos', '1500'], ['mil novecentos e noventa', '1990'], ['dois mil e vinte e seis', '2026'],
    ['vinte e dois mil', '22000'], ['cento e vinte mil', '120000'], ['cem mil', '100000'],
    ['um milhão', '1000000'], ['um milhão e duzentos mil', '1200000'],
    ['três bilhões', '3000000000'], ['novecentos e noventa e nove bilhões novecentos e noventa e nove milhões novecentos e noventa e nove mil novecentos e noventa e nove', '999999999999'],
  ];
  for (const [words, value] of cases) {
    const r = scanText(`Foram ${words} ao todo.`).mentions;
    assert.equal(r[0]?.value, value, words);
    assert.equal(r[0].form, 'words');
  }
});

test('spelled-out decimals with "vírgula", and units after words', () => {
  assert.deepEqual(refs('três vírgula cinco'), ['number:3.5']);
  assert.deepEqual(refs('zero vírgula zero cinco'), ['number:0.05']);
  assert.deepEqual(refs('um vírgula vinte e cinco'), ['number:1.25']);
  assert.deepEqual(refs('dois vírgula cinco milhões'), ['number:2500000']);
  assert.deepEqual(refs('vinte por cento'), ['percent:20']);
  assert.deepEqual(refs('cinquenta reais e cinquenta centavos'), ['BRL:50', 'BRL:0.5']);
  assert.deepEqual(refs('dois milhões de reais'), ['BRL:2000000']);
  assert.deepEqual(refs('Coloque uma vírgula aqui'), [], '"vírgula" without a number after it is just a word');
});

test('spelled-out numbers ignore accents, case and decomposed (NFD) forms', () => {
  assert.deepEqual(refs('TRÊS, três, tres, Três'), ['number:3', 'number:3', 'number:3', 'number:3']);
  assert.deepEqual(refs('três milhões'.replace('milhões', 'mil')), ['number:3000']);
  assert.deepEqual(refs('um milhão'.normalize('NFD')), ['number:1000000']);
  assert.deepEqual(refs('vírgula'.normalize('NFD') + ' dois, dois vírgula cinco'), ['number:2', 'number:2.5']);
});

test('a number out of descending order ends before the offending group', () => {
  assert.deepEqual(refs('dois mil e três mil'), ['number:2000', 'number:3000']);
  assert.deepEqual(refs('vinte e cinco e trinta'), ['number:25', 'number:30']);
  assert.deepEqual(refs('cinco e dez'), ['number:5', 'number:10']);
});

test('spelled-out numbers do not cross punctuation or a paragraph break', () => {
  assert.deepEqual(refs('vinte, cinco'), ['number:20', 'number:5']);
  assert.deepEqual(refs('vinte e\ncinco'), ['number:25'], 'one line break is allowed');
  assert.deepEqual(refs('vinte e\n\ncinco'), ['number:20', 'number:5'], 'a blank line separates');
});

test('no article false positive: a lone um/uma is skipped, and the skip is reported', () => {
  const r = scanText('Um homem comprou uma casa e um carro.');
  assert.deepEqual(r.mentions, []);
  assert.deepEqual(r.omissions.map((o) => o.kind), ['article', 'article', 'article']);
  assert.deepEqual(r.omissions.map((o) => o.text), ['Um', 'uma', 'um']);
});

test('um/uma still count with a numeric or unit context', () => {
  assert.deepEqual(refs('vinte e um e vinte e uma'), ['number:21', 'number:21']);
  assert.deepEqual(refs('um real e um por cento e um milhão, mil e uma'), ['BRL:1', 'percent:1', 'number:1000000', 'number:1001']);
  assert.deepEqual(refs('um vírgula cinco'), ['number:1.5']);
  assert.deepEqual(refs('uma casa', { includeArticles: true }), ['number:1'], 'the documented opt-in');
});

test('idioms and look-alikes are skipped and reported, not silently dropped', () => {
  const r = scanText('Comece do zero, ganhe por cento, os milhões, a CEP 12345-678, o 1º lugar, às 10:30 e 10h30, COVID19, tel 0800.');
  assert.deepEqual(r.mentions, []);
  const kinds = r.omissions.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ['identifier', 'identifier', 'identifier', 'idiom', 'ordinal', 'scale-without-multiplier', 'time', 'time']);
});

test('ranges are two numbers; long hyphenated codes are identifiers', () => {
  assert.deepEqual(refs('de 5-10 minutos'), ['number:5', 'number:10']);
  assert.deepEqual(refs('CPF 123.456.789-00'), []);
});

test('dates: numeric, ISO, with month names and spelled out', () => {
  assert.deepEqual(refs('05/03/2026'), ['date:2026-03-05']);
  assert.deepEqual(refs('5/3'), ['date:--03-05']);
  assert.deepEqual(refs('2026-03-05'), ['date:2026-03-05']);
  assert.deepEqual(refs('5 de março de 2026 e 1º de maio e 12 de Dezembro'), ['date:2026-03-05', 'date:--05-01', 'date:--12-12']);
  assert.deepEqual(refs('cinco de março de 2026'), ['date:2026-03-05']);
  assert.deepEqual(refs('vinte de março de dois mil e vinte e seis'), ['date:2026-03-20']);
  assert.deepEqual(refs('29/02/2024'), ['date:2024-02-29']);
});

test('impossible dates and unreadable numbers are reported as unparsed, never guessed', () => {
  const bad = (text) => scanText(text).unparsed.map((u) => `${u.reason}:${u.text}`);
  assert.deepEqual(bad('31 de fevereiro'), ['invalid-date:31 de fevereiro']);
  assert.deepEqual(bad('29/02/2025'), ['invalid-date:29/02/2025']);
  assert.deepEqual(bad('3.5 e 1,5,3 e 1234.567'), ['ambiguous-separator:3.5', 'ambiguous-separator:1,5,3', 'ambiguous-separator:1234.567']);
  assert.deepEqual(bad('05/03/26'), ['unsupported-slash-number:05/03/26']);
  assert.deepEqual(bad('3/15'), ['invalid-date:3/15']);
  assert.deepEqual(bad('dois milhões e meio e 3 e meia'), ['unsupported-fraction:dois milhões e meio', 'unsupported-fraction:3 e meia']);
  assert.deepEqual(bad(`${'9'.repeat(30)}`), ['number-too-long:' + '9'.repeat(30)]);
  assert.deepEqual(refs('3.5'), []);
});

test('a date is one reference: its day, month name and year are not extra numbers', () => {
  const m = scanText('Em 5 de março de 2026, às vinte horas.').mentions;
  assert.deepEqual(m.map((x) => x.raw), ['5 de março de 2026', 'vinte']);
});

test('offsets point at the exact text of each reference', () => {
  const text = 'Custa R$ 49,90 e cento e vinte reais.';
  for (const m of scanText(text).mentions) assert.equal(text.slice(m.offset, m.offset + m.length), m.raw);
  assert.deepEqual(scanText(text).mentions.map((m) => m.raw), ['R$ 49,90', 'cento e vinte reais']);
});

test('pathological input stays fast and bounded', () => {
  const started = Date.now();
  const inputs = [
    'mil '.repeat(100_000),
    'vinte e '.repeat(100_000),
    '1.'.repeat(100_000),
    '1,'.repeat(100_000),
    '5/'.repeat(100_000),
    '<'.repeat(100_000),
    `${'9'.repeat(200_000)}`,
    'um '.repeat(100_000),
    '0'.repeat(1000) + ',' + '0'.repeat(1000),
  ];
  for (const text of inputs) scanText(text);
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
});

test('words that merely contain number words are not numbers', () => {
  assert.deepEqual(refs('A mesma milhares, mileniais, centenas, dezenas, sétimo'), []);
});
