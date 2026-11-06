import { scanText, sentenceAround } from './extract.mjs';
import { assertFacts, factKey } from './facts.mjs';

function describe(source, text, item) {
  return {
    ...item,
    location: source.locate(item.offset),
    sentence: sentenceAround(text, item.offset, item.length),
  };
}

const locate = (source, item) => ({ ...item, location: source.locate(item.offset) });

/**
 * List every numeric reference in a source, without judging it.
 * @param {{ format: string, text: string, locate(offset: number): object }} source from readSource()
 * @param {{ includeArticles?: boolean }} [options]
 */
export function extract(source, options = {}) {
  const { mentions, omissions, unparsed } = scanText(source.text, options);
  return {
    format: source.format,
    mentions: mentions.map((m) => describe(source, source.text, m)),
    omissions: omissions.map((o) => locate(source, o)),
    unparsed: unparsed.map((u) => describe(source, source.text, u)),
  };
}

/**
 * Compare every numeric reference against a facts manifest.
 * A reference is "supported" only when a fact (or an ignore rule, reported separately) has the same unit
 * and the same canonical value. That says the author registered it, not that it is true.
 * @param {{ format: string, text: string, locate(offset: number): object }} source from readSource()
 * @param {unknown} factsInput a parsed facts manifest (validated here; throws InputError when invalid)
 * @param {{ includeArticles?: boolean }} [options]
 */
export function check(source, factsInput, options = {}) {
  const manifest = assertFacts(factsInput);
  const byKey = new Map();
  for (const f of manifest.facts) {
    const k = factKey(f.unit, f.value);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  }
  const ignoreByKey = new Map(manifest.ignore.map((r) => [factKey(r.unit, r.value), r]));

  const found = extract(source, options);
  const supported = [];
  const ignored = [];
  const findings = [];
  const usedFacts = new Set();
  for (const m of found.mentions) {
    const k = factKey(m.unit, m.value);
    const facts = byKey.get(k);
    const base = { value: m.value, unit: m.unit, raw: m.raw, form: m.form, offset: m.offset, length: m.length, location: m.location, sentence: m.sentence };
    if (facts) {
      for (const f of facts) usedFacts.add(f.id);
      supported.push({ ...base, facts: facts.map((f) => ({ id: f.id, source: f.source, ...(f.context ? { context: f.context } : {}) })) });
    } else if (ignoreByKey.has(k)) {
      ignored.push({ ...base, reason: ignoreByKey.get(k).reason });
    } else {
      findings.push({ type: 'unsupported', ...base });
    }
  }
  for (const u of found.unparsed) {
    findings.push({ type: 'unparsed', reason: u.reason, text: u.text, offset: u.offset, length: u.length, location: u.location, sentence: u.sentence });
  }
  findings.sort((a, b) => a.offset - b.offset);

  const omittedByKind = {};
  for (const o of found.omissions) omittedByKind[o.kind] = (omittedByKind[o.kind] ?? 0) + 1;

  return {
    tool: 'numeros-ptbr',
    reportVersion: 1,
    format: source.format,
    clean: findings.length === 0,
    summary: {
      mentions: found.mentions.length,
      supported: supported.length,
      ignored: ignored.length,
      unsupported: findings.filter((f) => f.type === 'unsupported').length,
      unparsed: found.unparsed.length,
      omitted: found.omissions.length,
      omittedByKind,
      facts: manifest.facts.length,
      ignoreRules: manifest.ignore.length,
    },
    findings,
    supported,
    ignored,
    omissions: found.omissions,
    unusedFacts: manifest.facts.filter((f) => !usedFacts.has(f.id)).map((f) => f.id),
  };
}
