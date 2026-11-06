// Finds numeric references in Brazilian Portuguese text.
//
// Two linear passes, no regular expression is ever applied to the input text as a whole:
//   1. a character scanner for digit forms (1.234,56  1,5  20%  R$ 49,90  05/03/2026  5 de março de 2026)
//   2. a word scanner for spelled-out numbers (cento e vinte, dois mil e vinte e seis, três vírgula cinco)
// Each reference becomes { value, unit, raw, form, offset, length } where `value` is a canonical decimal
// string and `unit` is one of "number" | "percent" | "BRL" | "date". Matching later is exact on (unit, value).
//
// Whatever is deliberately skipped is returned as `omissions` and whatever looks numeric but cannot be
// read is returned as `unparsed`; neither disappears silently.
import { canonDecimal, dateValue, shiftDecimal } from './decimal.mjs';
import { THRESHOLDS } from './limits.mjs';

const LETTER = /[\p{L}\p{M}]/u;
const MARKS = /\p{M}/gu;
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c) => c !== undefined && LETTER.test(c);
const isWordChar = (c) => isLetter(c) || isDigit(c) || c === '_';
const isInline = (c) => c === ' ' || c === '\t' || c === ' ';

/** Lowercase, accent-insensitive form used for word matching. Works for precomposed and decomposed input. */
export const normWord = (s) => s.normalize('NFD').replace(MARKS, '').toLowerCase();

const table = (obj) => new Map(Object.entries(obj));
const UNITS = table({ um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 });
const TEENS = table({ dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 });
const TENS = table({ vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 });
const HUNDREDS = table({
  duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
});
const SCALES = table({ mil: 1e3, milhao: 1e6, milhoes: 1e6, bilhao: 1e9, bilhoes: 1e9 });
const SCALE_POW = table({ mil: 3, milhao: 6, milhoes: 6, bilhao: 9, bilhoes: 9 });
const MONTHS = table({ janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 });
const STARTERS = new Set(['zero', 'cem', 'cento', ...UNITS.keys(), ...TEENS.keys(), ...TENS.keys(), ...HUNDREDS.keys(), ...SCALES.keys()]);

// ---------------------------------------------------------------- small text helpers

function digitRunEnd(text, i) {
  let j = i;
  while (isDigit(text[j])) j++;
  return j;
}

function alnumEnd(text, i) {
  let j = i;
  while (isWordChar(text[j])) j++;
  return j;
}

/** End of an identifier-like run such as 12345-678 or 123.456.789-00 (digits joined by . , - / :). */
function identifierEnd(text, i) {
  let k = i;
  for (;;) {
    const c = text[k];
    if (isDigit(c)) k++;
    else if ((c === '.' || c === ',' || c === '-' || c === '/' || c === ':') && isDigit(text[k + 1])) k++;
    else return k;
  }
}

/** Skips up to 3 inline whitespace characters (never a line break). */
function skipInline(text, pos) {
  let p = pos;
  while (p < pos + 3 && isInline(text[p])) p++;
  return p;
}

/** The next letters-only word after 1–3 inline spaces, or null. */
function peekWord(text, pos) {
  const q = skipInline(text, pos);
  if (q === pos || !isLetter(text[q])) return null;
  let e = q;
  while (isLetter(text[e])) e++;
  return { norm: normWord(text.slice(q, e)), start: q, end: e };
}

/** A four-digit year after "de ", e.g. the 2026 of "5 de março de 2026". */
function peekYear(text, pos) {
  const q = skipInline(text, pos);
  if (q === pos || !isDigit(text[q])) return null;
  const e = digitRunEnd(text, q);
  if (e - q !== 4 || isLetter(text[e]) || ((text[e] === '.' || text[e] === ',') && isDigit(text[e + 1]))) return null;
  return { year: Number(text.slice(q, e)), end: e };
}

/** "de <month>[ de <year>]" after a day number. */
function readDateTail(text, pos) {
  const w1 = peekWord(text, pos);
  if (!w1 || w1.norm !== 'de') return null;
  const w2 = peekWord(text, w1.end);
  if (!w2 || !MONTHS.has(w2.norm)) return null;
  let end = w2.end;
  let year = null;
  const w3 = peekWord(text, end);
  if (w3 && w3.norm === 'de') {
    const y = peekYear(text, w3.end);
    if (y) {
      year = y.year;
      end = y.end;
    }
  }
  return { month: MONTHS.get(w2.norm), year, end, monthEnd: w2.end };
}

/** End index of " e meio" / " e meia" after a number, or -1. Halves are not supported, so the number is reported, not read. */
function halfAfter(text, pos) {
  const e = peekWord(text, pos);
  if (!e || e.norm !== 'e') return -1;
  const h = peekWord(text, e.end);
  return h && (h.norm === 'meio' || h.norm === 'meia') ? h.end : -1;
}

/** Unit written after a number: %, "por cento", reais/real, centavos, and "de reais" after a scale word. */
function readUnit(text, pos, scaled) {
  const q = pos + (isInline(text[pos]) ? 1 : 0);
  if (text[q] === '%') return { unit: 'percent', end: q + 1 };
  const w = peekWord(text, pos);
  if (!w) return null;
  if (w.norm === 'reais' || w.norm === 'real') return { unit: 'BRL', end: w.end };
  if ((w.norm === 'centavo' || w.norm === 'centavos') && !scaled) return { unit: 'BRL', end: w.end, shift: -2 };
  if (w.norm === 'por') {
    const w2 = peekWord(text, w.end);
    if (w2 && w2.norm === 'cento') return { unit: 'percent', end: w2.end };
  }
  if (scaled && w.norm === 'de') {
    const w2 = peekWord(text, w.end);
    if (w2 && (w2.norm === 'reais' || w2.norm === 'real')) return { unit: 'BRL', end: w2.end };
  }
  return null;
}

/** Start index of an "R$" prefix directly before the number (one space allowed), or -1. "US$" does not count. */
function currencyPrefixStart(text, i) {
  let p = i - 1;
  if (isInline(text[p])) p--;
  if (text[p] === '$' && (text[p - 1] === 'R' || text[p - 1] === 'r') && !isLetter(text[p - 2])) return p - 1;
  return -1;
}

// ---------------------------------------------------------------- digit scanner

/** Reads 1.234,56 / 1,5 / 20. Dot is only a thousands separator when followed by exactly three digits. */
function readNumber(text, i) {
  let j = digitRunEnd(text, i);
  const first = text.slice(i, j);
  let intDigits = first;
  let frac = null;
  let sep = false;
  let bad = false;
  while (text[j] === '.' && isDigit(text[j + 1])) {
    const k = digitRunEnd(text, j + 1);
    const grp = text.slice(j + 1, k);
    if (grp.length === 3 && first.length <= 3 && first[0] !== '0') {
      intDigits += grp;
      sep = true;
      j = k;
    } else {
      bad = true;
      j = k;
      break;
    }
  }
  if (!bad && text[j] === ',' && isDigit(text[j + 1])) {
    const k = digitRunEnd(text, j + 1);
    frac = text.slice(j + 1, k);
    j = k;
  }
  if (!bad && (text[j] === '.' || text[j] === ',') && isDigit(text[j + 1])) bad = true;
  if (bad) {
    while (isDigit(text[j]) || ((text[j] === '.' || text[j] === ',') && isDigit(text[j + 1]))) j++;
    return { error: 'ambiguous-separator', end: j };
  }
  if (intDigits.length > THRESHOLDS.maxIntegerDigits || (frac !== null && frac.length > THRESHOLDS.maxFractionDigits)) {
    return { error: 'number-too-long', end: j };
  }
  return { end: j, int: intDigits, frac, sep };
}

function pushDate(ctx, offset, end, year, month, day) {
  const value = dateValue(year, month, day);
  if (value === null) ctx.bad('invalid-date', offset, end);
  else ctx.add({ value, unit: 'date', form: 'digits' }, offset, end);
}

/** 05/03/2026, 05/03, and shapes that look like them. Returns the index to resume at. */
function handleSlash(text, i, ctx) {
  const parts = [];
  let k = i;
  for (;;) {
    const e = digitRunEnd(text, k);
    parts.push(text.slice(k, e));
    k = e;
    if (text[k] === '/' && isDigit(text[k + 1]) && parts.length < 4) k++;
    else break;
  }
  const [d, m, y] = parts;
  const shapeOk = (parts.length === 2 || (parts.length === 3 && y.length === 4)) && d.length <= 2 && m.length <= 2;
  if (!shapeOk) {
    ctx.bad('unsupported-slash-number', i, k);
    return k;
  }
  pushDate(ctx, i, k, y === undefined ? null : Number(y), Number(m), Number(d));
  return k;
}

/** yyyy-mm-dd. Returns the resume index, or -1 when the shape is not an ISO date. */
function tryIso(text, i, ctx) {
  const y = text.slice(i, i + 4);
  if (text[i + 4] !== '-' || !isDigit(text[i + 5]) || !isDigit(text[i + 6]) || text[i + 7] !== '-' || !isDigit(text[i + 8]) || !isDigit(text[i + 9])) return -1;
  const e = i + 10;
  if (isDigit(text[e]) || isLetter(text[e])) return -1;
  pushDate(ctx, i, e, Number(y), Number(text.slice(i + 5, i + 7)), Number(text.slice(i + 8, i + 10)));
  return e;
}

function handleDigits(text, i, ctx) {
  const prev = text[i - 1];
  if (i > 0 && (isLetter(prev) || prev === '_')) {
    const e = alnumEnd(text, i);
    ctx.omit('identifier', i, e);
    return e;
  }
  const run0 = digitRunEnd(text, i);
  if (text[run0] === '/' && isDigit(text[run0 + 1])) return handleSlash(text, i, ctx);
  if (run0 - i === 4 && text[run0] === '-') {
    const r = tryIso(text, i, ctx);
    if (r !== -1) return r;
  }

  const tok = readNumber(text, i);
  if (tok.error) {
    ctx.bad(tok.error, i, tok.end);
    return tok.end;
  }
  const j = tok.end;
  const plain = !tok.sep && tok.frac === null;

  if (plain && tok.int.length <= 2) {
    const c = text[j];
    if (c === ':' && isDigit(text[j + 1]) && isDigit(text[j + 2]) && !isDigit(text[j + 3])) {
      let e = j + 3;
      if (text[e] === ':' && isDigit(text[e + 1]) && isDigit(text[e + 2]) && !isDigit(text[e + 3])) e += 3;
      ctx.omit('time', i, e);
      return e;
    }
    if ((c === 'h' || c === 'H') && isDigit(text[j + 1]) && isDigit(text[j + 2]) && !isDigit(text[j + 3])) {
      ctx.omit('time', i, j + 3);
      return j + 3;
    }
  }

  if (text[j] === '-' && isDigit(text[j + 1])) {
    const rEnd = digitRunEnd(text, j + 1);
    const rightPlain = !((text[rEnd] === '.' || text[rEnd] === ',') && isDigit(text[rEnd + 1]));
    const range = plain && tok.int.length <= THRESHOLDS.maxRangeDigits && rEnd - (j + 1) <= THRESHOLDS.maxRangeDigits && rightPlain;
    if (!range) {
      const e = identifierEnd(text, j);
      ctx.omit('identifier', i, e);
      return e;
    }
  }
  if (text[j] === '/' && isDigit(text[j + 1])) {
    const e = identifierEnd(text, j);
    ctx.omit('identifier', i, e);
    return e;
  }

  const c = text[j];
  if (c === 'º' || c === 'ª' || c === '°') {
    if (plain && tok.int.length <= 2) {
      const tail = readDateTail(text, j + 1);
      if (tail) {
        pushDate(ctx, i, tail.end, tail.year, tail.month, Number(tok.int));
        return tail.end;
      }
    }
    ctx.omit('ordinal', i, j + 1);
    return j + 1;
  }

  if (plain && tok.int.length <= 2) {
    const tail = readDateTail(text, j);
    if (tail) {
      pushDate(ctx, i, tail.end, tail.year, tail.month, Number(tok.int));
      return tail.end;
    }
  }

  let suffixEnd = j;
  if (isLetter(text[j])) {
    let k = j;
    while (isLetter(text[k])) k++;
    if (k - j > THRESHOLDS.maxSuffixLetters) {
      ctx.omit('identifier', i, k);
      return k;
    }
    suffixEnd = k;
  }
  if (plain && tok.int.length > 1 && tok.int[0] === '0') {
    ctx.omit('identifier', i, suffixEnd);
    return suffixEnd;
  }

  let start = i;
  let unit = null;
  const pre = currencyPrefixStart(text, i);
  if (pre !== -1) {
    start = pre;
    unit = 'BRL';
  }
  let value = canonDecimal(tok.int, tok.frac ?? '');
  let end = j;
  let scaled = false;
  if (suffixEnd === j) {
    const sw = peekWord(text, end);
    if (sw && SCALE_POW.has(sw.norm)) {
      value = shiftDecimal(value, SCALE_POW.get(sw.norm));
      end = sw.end;
      scaled = true;
    }
    if (unit === null) {
      const u = readUnit(text, end, scaled);
      if (u) {
        unit = u.unit;
        end = u.end;
        if (u.shift) value = shiftDecimal(value, u.shift);
      }
    }
  } else {
    end = suffixEnd;
  }
  const half = halfAfter(text, end);
  if (half !== -1) {
    ctx.bad('unsupported-fraction', start, half);
    return half;
  }
  ctx.add({ value, unit: unit ?? 'number', form: 'digits' }, start, end);
  return end;
}

function scanDigits(text, ctx) {
  let i = 0;
  while (i < text.length) {
    if (isDigit(text[i])) i = Math.max(handleDigits(text, i, ctx), i + 1);
    else i++;
  }
}

// ---------------------------------------------------------------- spelled-out numbers

function tokenize(text) {
  const toks = [];
  let i = 0;
  let prevEnd = 0;
  const n = text.length;
  while (i < n) {
    if (!isLetter(text[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && isLetter(text[j])) j++;
    let adj = false;
    if (toks.length > 0) {
      adj = true;
      let breaks = 0;
      for (let k = prevEnd; k < i; k++) {
        const c = text[k];
        if (c === '\n') breaks++;
        else if (c === '\r') {
          if (text[k + 1] !== '\n') breaks++;
        } else if (!isInline(c)) {
          adj = false;
          break;
        }
      }
      if (breaks > 1) adj = false;
    }
    toks.push({ norm: normWord(text.slice(i, j)), start: i, end: j, adj });
    prevEnd = j;
    i = j;
  }
  return toks;
}

/** 1..99 */
function below100(toks, i) {
  const t = toks[i];
  if (!t) return null;
  const w = t.norm;
  if (TEENS.has(w)) return { v: TEENS.get(w), end: i + 1 };
  if (TENS.has(w)) {
    let v = TENS.get(w);
    let end = i + 1;
    const e = toks[end];
    const u = toks[end + 1];
    if (e?.adj && e.norm === 'e' && u?.adj && UNITS.has(u.norm)) {
      v += UNITS.get(u.norm);
      end += 2;
    }
    return { v, end };
  }
  if (UNITS.has(w)) return { v: UNITS.get(w), end: i + 1 };
  return null;
}

/** 1..999. "cem" stands alone; "cento" needs "e <1..99>". */
function below1000(toks, i) {
  const t = toks[i];
  if (!t) return null;
  const w = t.norm;
  if (w === 'cem') return { v: 100, end: i + 1 };
  if (w === 'cento' || HUNDREDS.has(w)) {
    const base = w === 'cento' ? 100 : HUNDREDS.get(w);
    const e = toks[i + 1];
    if (e?.adj && e.norm === 'e' && toks[i + 2]?.adj) {
      const r = below100(toks, i + 2);
      if (r) return { v: base + r.v, end: r.end };
    }
    return w === 'cento' ? null : { v: base, end: i + 1 };
  }
  return below100(toks, i);
}

/**
 * A cardinal of up to 999 999 999 999. Groups must descend (bilhão > milhão > mil > units); an
 * out-of-order group ("dois mil e três mil") ends the number before it.
 */
function parseCardinal(toks, i) {
  if (toks[i].norm === 'zero') return { total: 0, end: i + 1, groups: 1, scaled: false };
  let total = 0;
  let pos = i;
  let last = Infinity;
  let groups = 0;
  for (;;) {
    let p = pos;
    if (groups > 0) {
      if (toks[p]?.adj && toks[p].norm === 'e') p++;
      if (!toks[p]?.adj) break;
    }
    const g = below1000(toks, p);
    if (g) {
      const s = toks[g.end]?.adj ? SCALES.get(toks[g.end].norm) : undefined;
      if (s !== undefined) {
        if (s >= last) break;
        total += g.v * s;
        pos = g.end + 1;
        last = s;
        groups++;
        continue;
      }
      total += g.v;
      pos = g.end;
      groups++;
      break;
    }
    const s = toks[p] ? SCALES.get(toks[p].norm) : undefined;
    if (s !== undefined && (groups > 0 || s === 1e3) && s < last) {
      total += s; // a bare "mil" is read as 1000
      pos = p + 1;
      last = s;
      groups++;
      continue;
    }
    break;
  }
  return groups === 0 ? null : { total, end: pos, groups, scaled: last !== Infinity };
}

/** After "vírgula": leading "zero"s, then one number 1..99 ("vírgula zero cinco" -> 05, "vírgula vinte e cinco" -> 25). */
function parseDecimalDigits(toks, j) {
  let digits = '';
  let k = j;
  while (toks[k]?.adj && toks[k].norm === 'zero') {
    digits += '0';
    k++;
  }
  if (toks[k]?.adj) {
    const r = below100(toks, k);
    if (r) {
      digits += String(r.v);
      k = r.end;
    }
  }
  return digits ? { digits, end: k } : null;
}

function scanWords(text, ctx, covered, options) {
  const toks = tokenize(text);
  let ci = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    while (ci < covered.length && covered[ci].offset + covered[ci].length <= t.start) ci++;
    if (ci < covered.length && t.start >= covered[ci].offset) continue; // inside a reference the digit scanner already read
    if (!STARTERS.has(t.norm)) continue;
    const prev = k > 0 && t.adj ? toks[k - 1].norm : '';
    if (t.norm === 'cento' && prev === 'por') continue; // "por cento" is a unit word, not a number
    if (t.norm === 'zero' && (prev === 'do' || prev === 'desde')) {
      ctx.omit('idiom', t.start, t.end);
      continue;
    }
    if (SCALES.has(t.norm) && t.norm !== 'mil') {
      ctx.omit('scale-without-multiplier', t.start, t.end);
      continue;
    }
    const c = parseCardinal(toks, k);
    if (!c) continue;
    let end = c.end;
    let value = String(c.total);
    let scaled = c.scaled;
    let decimal = false;

    if (c.groups === 1 && !scaled && toks[end]?.adj && toks[end].norm === 'virgula') {
      const d = parseDecimalDigits(toks, end + 1);
      if (d) {
        decimal = true;
        value = canonDecimal(value, d.digits);
        end = d.end;
        const s = toks[end];
        if (s?.adj && SCALE_POW.has(s.norm)) {
          value = shiftDecimal(value, SCALE_POW.get(s.norm));
          end++;
          scaled = true;
        }
      }
    }
    const startOff = t.start;
    let endOff = toks[end - 1].end;

    // "cinco de março [de 2026]"
    if (!decimal && !scaled && c.total >= 1 && c.total <= 31) {
      const tail = readDateTail(text, endOff);
      if (tail) {
        let dEnd = tail.end;
        let year = tail.year;
        if (year === null) {
          // a spelled-out year: "vinte de março de dois mil e vinte e seis"
          const de = toks[end + 2];
          const y = de?.adj && de.norm === 'de' && toks[end + 3]?.adj ? parseCardinal(toks, end + 3) : null;
          if (y && Number.isInteger(y.total) && y.total >= 1000 && y.total <= 2999) {
            year = y.total;
            dEnd = toks[y.end - 1].end;
          }
        }
        const dv = dateValue(year, tail.month, c.total);
        if (dv === null) ctx.bad('invalid-date', startOff, dEnd);
        else ctx.add({ value: dv, unit: 'date', form: 'words' }, startOff, dEnd);
        while (k + 1 < toks.length && toks[k + 1].start < dEnd) k++;
        continue;
      }
    }

    const half = halfAfter(text, endOff);
    if (half !== -1) {
      ctx.bad('unsupported-fraction', startOff, half);
      while (k + 1 < toks.length && toks[k + 1].start < half) k++;
      continue;
    }
    let unit = null;
    const u = readUnit(text, endOff, scaled);
    if (u) {
      unit = u.unit;
      endOff = u.end;
      if (u.shift) value = shiftDecimal(value, u.shift);
    }
    const article = (t.norm === 'um' || t.norm === 'uma') && c.end === k + 1 && !decimal && !scaled;
    if (article && unit === null && !options.includeArticles) {
      ctx.omit('article', t.start, t.end);
      continue;
    }
    ctx.add({ value, unit: unit ?? 'number', form: 'words' }, startOff, endOff);
    while (k + 1 < toks.length && toks[k + 1].start < endOff) k++;
  }
}

// ---------------------------------------------------------------- public

/**
 * Scan a text for numeric references.
 * @param {string} text
 * @param {{ includeArticles?: boolean }} [options]
 */
export function scanText(text, options = {}) {
  const raw = [];
  const omissions = [];
  const unparsed = [];
  const excerpt = (a, b) => {
    const s = text.slice(a, b);
    return s.length > THRESHOLDS.excerptLength ? `${s.slice(0, THRESHOLDS.excerptLength - 1)}…` : s;
  };
  const ctx = {
    add: (m, a, b) => raw.push({ ...m, raw: text.slice(a, b), offset: a, length: b - a }),
    omit: (kind, a, b) => omissions.push({ kind, text: excerpt(a, b), offset: a, length: b - a }),
    bad: (reason, a, b) => unparsed.push({ reason, text: excerpt(a, b), offset: a, length: b - a }),
  };
  scanDigits(text, ctx);
  const digitMentions = raw.slice();
  scanWords(text, ctx, digitMentions, options);

  // A date made of words and a digit year ("cinco de março de 2026") overlaps a plain number found by the
  // digit scanner; keep the longest reference when two overlap.
  raw.sort((a, b) => a.offset - b.offset || b.length - a.length);
  const mentions = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.offset >= lastEnd) {
      const left = Math.max(0, m.offset - 32);
      const prefix = text.slice(left, m.offset);
      const sign = /[-+\u2212]\s*$/.exec(prefix);
      const minusWord = /\bmenos\s*$/iu.exec(prefix);
      const signed = minusWord ?? (sign && !/[0-9]/.test(prefix.charAt(sign.index - 1)) ? sign : null);
      if (signed) {
        // Signed quantities are outside the manifest's non-negative domain.
        // Never silently match their unsigned magnitude to a positive fact.
        ctx.bad('unsupported-sign', left + signed.index, m.offset + m.length);
      } else {
        mentions.push(m);
      }
      lastEnd = m.offset + m.length;
    }
  }
  omissions.sort((a, b) => a.offset - b.offset);
  unparsed.sort((a, b) => a.offset - b.offset);
  return { mentions, omissions, unparsed };
}

/** The sentence around a reference, collapsed to one line and clipped. */
export function sentenceAround(text, offset, length) {
  const w = THRESHOLDS.sentenceWindow;
  const isEnd = (k) => (text[k] === '.' || text[k] === '?' || text[k] === '!') && (k + 1 >= text.length || /\s/.test(text[k + 1]));
  let a = Math.max(0, offset - w);
  for (let k = offset - 1; k >= Math.max(0, offset - w); k--) {
    if (isEnd(k) || (text[k] === '\n' && text[k - 1] === '\n')) {
      a = k + 1;
      break;
    }
  }
  let b = Math.min(text.length, offset + length + w);
  for (let k = offset + length; k < Math.min(text.length, offset + length + w); k++) {
    if (isEnd(k)) {
      b = k + 1;
      break;
    }
    if (text[k] === '\n' && text[k + 1] === '\n') {
      b = k;
      break;
    }
  }
  const lead = text.slice(a, offset).replace(/\s+/g, ' ');
  const mid = text.slice(offset, offset + length).replace(/\s+/g, ' ');
  const tail = text.slice(offset + length, b).replace(/\s+/g, ' ');
  let s = `${lead}${mid}${tail}`.trim();
  if (s.length > THRESHOLDS.snippetLength) {
    const at = Math.max(0, lead.trimStart().length - 60);
    const clipped = s.slice(at, at + THRESHOLDS.snippetLength - 2);
    s = `${at > 0 ? '…' : ''}${clipped}${at + clipped.length < s.length ? '…' : ''}`;
  }
  return s;
}
