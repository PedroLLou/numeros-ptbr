// The facts manifest: what the author says is true, and where that comes from.
//
//   {
//     "version": 1,
//     "facts":  [ { "id": "plan-price", "value": "49.90", "unit": "BRL", "source": "https://example.com/pricing", "context": "optional note" } ],
//     "ignore": [ { "value": "2026", "unit": "number", "reason": "the current year, not a claim" } ]
//   }
//
// Validation is strict: unknown keys are errors, strings must be non-empty and control-character free,
// values use a dot decimal in a canonical form. Nothing in the manifest is ever fetched or executed.
import { canonFromString, dateValue } from './decimal.mjs';
import { InputError, LIMITS } from './limits.mjs';

export const UNIT_NAMES = Object.freeze(['number', 'percent', 'BRL', 'date']);

const ROOT_KEYS = new Set(['version', 'facts', 'ignore']);
const FACT_KEYS = new Set(['id', 'value', 'unit', 'source', 'context']);
const IGNORE_KEYS = new Set(['value', 'unit', 'reason']);
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DECIMAL = /^\d{1,24}(?:\.\d{1,12})?$/;
const DATE_FULL = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_NOYEAR = /^--(\d{2})-(\d{2})$/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const t = String(s).replace(FORBIDDEN, '?');
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
};

/** Key used to compare a mention with a fact: unit and canonical value. */
export const factKey = (unit, value) => `${unit}\u0000${value}`;

function readText(obj, key, path, errors, { max = LIMITS.maxFactStringLength, required = true } = {}) {
  const v = obj[key];
  if (v === undefined) {
    if (required) errors.push(`${path}.${key}: required`);
    return undefined;
  }
  if (typeof v !== 'string') {
    errors.push(`${path}.${key}: expected a string`);
    return undefined;
  }
  const t = v.trim();
  if (t === '') {
    errors.push(`${path}.${key}: must not be empty`);
    return undefined;
  }
  if (t.length > max) {
    errors.push(`${path}.${key}: longer than ${max} characters`);
    return undefined;
  }
  if (FORBIDDEN.test(t)) {
    errors.push(`${path}.${key}: contains control or bidirectional-override characters`);
    return undefined;
  }
  return t;
}

function readUnit(obj, path, errors) {
  if (obj.unit === undefined) return 'number';
  if (typeof obj.unit !== 'string' || !UNIT_NAMES.includes(obj.unit)) {
    errors.push(`${path}.unit: expected one of ${UNIT_NAMES.join(', ')}`);
    return undefined;
  }
  return obj.unit;
}

/** The canonical value string for a unit, or an error message. */
function normalizeValue(raw, unit) {
  if (unit === 'date') {
    if (typeof raw !== 'string') return { error: 'a date must be a string like "2026-03-05" or "--03-05" (no year)' };
    let m = DATE_FULL.exec(raw);
    if (m) {
      const v = dateValue(Number(m[1]), Number(m[2]), Number(m[3]));
      return v ? { value: v } : { error: `"${show(raw)}" is not a calendar date` };
    }
    m = DATE_NOYEAR.exec(raw);
    if (m) {
      const v = dateValue(null, Number(m[1]), Number(m[2]));
      return v ? { value: v } : { error: `"${show(raw)}" is not a calendar date` };
    }
    return { error: 'a date must look like "2026-03-05" or "--03-05" (no year)' };
  }
  let s;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return { error: 'a number must be finite and not negative' };
    s = String(raw);
    if (s.includes('e')) return { error: 'this number is too large or too small for a JSON number; write it as a string like "1234.56"' };
  } else if (typeof raw === 'string') {
    s = raw.trim();
  } else {
    return { error: 'expected a JSON number or a decimal string like "1234.56"' };
  }
  if (!DECIMAL.test(s)) {
    return { error: `"${show(raw)}" is not a plain decimal: use digits with a dot decimal, no thousands separator, no sign, no unit (e.g. "1234.56")` };
  }
  if (/^0\d/.test(s)) return { error: `"${show(raw)}" has a leading zero` };
  return { value: canonFromString(s) };
}

/**
 * Validate a parsed facts manifest.
 * @returns {{ ok: true, manifest: object, errors: [] } | { ok: false, errors: string[] }}
 */
export function validateFacts(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['$: expected an object'] };
  for (const k of Object.keys(input)) if (!ROOT_KEYS.has(k)) errors.push(`$.${show(k)}: unknown key (allowed: version, facts, ignore)`);
  if (input.version !== 1) errors.push('$.version: required and must be 1');
  if (!Array.isArray(input.facts)) errors.push('$.facts: required, expected a list');
  if (input.ignore !== undefined && !Array.isArray(input.ignore)) errors.push('$.ignore: expected a list');
  if (Array.isArray(input.facts) && input.facts.length > LIMITS.maxFacts) errors.push(`$.facts: more than ${LIMITS.maxFacts} entries`);
  if (Array.isArray(input.ignore) && input.ignore.length > LIMITS.maxIgnoreRules) errors.push(`$.ignore: more than ${LIMITS.maxIgnoreRules} entries`);
  // Without well-formed lists there is nothing more to look at; otherwise keep going so every problem is listed at once.
  if (!Array.isArray(input.facts) || (input.ignore !== undefined && !Array.isArray(input.ignore))) return { ok: false, errors };
  if (input.facts.length > LIMITS.maxFacts || (input.ignore ?? []).length > LIMITS.maxIgnoreRules) return { ok: false, errors };

  const facts = [];
  const ids = new Set();
  const keys = new Set();
  input.facts.forEach((f, i) => {
    const path = `$.facts[${i}]`;
    if (!isPlainObject(f)) return errors.push(`${path}: expected an object`);
    for (const k of Object.keys(f)) if (!FACT_KEYS.has(k)) errors.push(`${path}.${show(k)}: unknown key (allowed: id, value, unit, source, context)`);
    const id = readText(f, 'id', path, errors, { max: LIMITS.maxIdLength });
    if (id !== undefined) {
      if (!ID.test(id)) errors.push(`${path}.id: use letters, digits, dot, underscore or hyphen, starting with a letter or digit`);
      else if (ids.has(id)) errors.push(`${path}.id: duplicate id "${show(id)}"`);
      else ids.add(id);
    }
    const source = readText(f, 'source', path, errors);
    if (source !== undefined && URL_SCHEME.test(source)) {
      let u = null;
      try {
        u = new URL(source);
      } catch {
        /* reported below */
      }
      if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) errors.push(`${path}.source: a URL source must be a valid http or https URL (or use a plain reference such as "contract-2026.pdf p.3")`);
    }
    const context = readText(f, 'context', path, errors, { required: false });
    const unit = readUnit(f, path, errors);
    let value;
    if (f.value === undefined) errors.push(`${path}.value: required`);
    else if (unit !== undefined) {
      const r = normalizeValue(f.value, unit);
      if (r.error) errors.push(`${path}.value: ${r.error}`);
      else value = r.value;
    }
    if (id !== undefined && source !== undefined && unit !== undefined && value !== undefined) {
      keys.add(factKey(unit, value));
      const fact = { id, value, unit, source };
      if (context !== undefined) fact.context = context;
      facts.push(fact);
    }
  });

  const ignore = [];
  const ignored = new Set();
  (input.ignore ?? []).forEach((r, i) => {
    const path = `$.ignore[${i}]`;
    if (!isPlainObject(r)) return errors.push(`${path}: expected an object`);
    for (const k of Object.keys(r)) if (!IGNORE_KEYS.has(k)) errors.push(`${path}.${show(k)}: unknown key (allowed: value, unit, reason)`);
    const reason = readText(r, 'reason', path, errors);
    const unit = readUnit(r, path, errors);
    let value;
    if (r.value === undefined) errors.push(`${path}.value: required`);
    else if (unit !== undefined) {
      const n = normalizeValue(r.value, unit);
      if (n.error) errors.push(`${path}.value: ${n.error}`);
      else value = n.value;
    }
    if (reason !== undefined && unit !== undefined && value !== undefined) {
      const key = factKey(unit, value);
      if (ignored.has(key)) errors.push(`${path}: duplicate ignore rule for ${unit} ${value}`);
      else if (keys.has(key)) errors.push(`${path}: ${unit} ${value} is both a fact and an ignore rule; keep one`);
      else {
        ignored.add(key);
        ignore.push({ value, unit, reason });
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors: errors.slice(0, LIMITS.maxReportedErrors) };
  return { ok: true, errors: [], manifest: { version: 1, facts, ignore } };
}

/** Like validateFacts but throws InputError with every problem listed. */
export function assertFacts(input) {
  const r = validateFacts(input);
  if (!r.ok) throw new InputError(`facts manifest is invalid (${r.errors.length} problem${r.errors.length === 1 ? '' : 's'})`, { code: 'invalid-facts', details: r.errors });
  return r.manifest;
}

/** Parse the text of a facts file. The text is JSON and nothing else; it is never evaluated. */
export function parseFactsJson(text) {
  if (typeof text !== 'string') throw new InputError('facts: expected a string', { code: 'invalid-facts' });
  if (text.length > LIMITS.maxFactsBytes) throw new InputError(`facts: larger than ${LIMITS.maxFactsBytes} bytes`, { code: 'too-large' });
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new InputError(`facts: not valid JSON (${String(e.message).replace(FORBIDDEN, '?').slice(0, 120)})`, { code: 'invalid-facts' });
  }
  return assertFacts(data);
}
