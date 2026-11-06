// Human-readable reports. Text taken from the input is untrusted: control characters, escape
// sequences and bidirectional overrides are replaced before anything reaches a terminal.

const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Make an untrusted string safe to print on one line. */
export function safe(value) {
  return String(value)
    .replace(/[\t\n\r]/g, ' ')
    .replace(UNSAFE, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
}

export function formatTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(f, 3)}`;
}

export function describeLocation(loc) {
  const parts = [];
  if (loc.cue !== undefined) parts.push(`cue ${loc.cue}`);
  if (loc.wordIndex !== undefined) parts.push(`word ${loc.wordIndex}`);
  if (loc.start !== undefined) parts.push(`at ${formatTime(loc.start)}`);
  if (loc.line !== undefined) parts.push(`line ${loc.line}, column ${loc.column}`);
  return parts.join(', ');
}

const UNIT_LABEL = { number: 'number', percent: 'percent', BRL: 'BRL', date: 'date' };
const label = (m) => `${UNIT_LABEL[m.unit]} ${m.value}`;

const REASONS = {
  'ambiguous-separator': 'the separators are ambiguous (a dot is only a thousands separator before exactly three digits; the decimal mark is a comma)',
  'number-too-long': 'the number has more digits than the documented limit',
  'invalid-date': 'this is not a calendar date',
  'unsupported-fraction': 'halves ("e meio", "e meia") are not supported, so the value cannot be read',
  'unsupported-slash-number': 'a number with slashes that is not a day/month[/year] date (fractions are not supported)',
};

/**
 * @param {object} report the object returned by check()
 * @param {{ verbose?: boolean, factsLabel?: string }} [options]
 */
export function formatReport(report, { verbose = false, factsLabel } = {}) {
  const s = report.summary;
  const lines = [];
  const counts = `${s.mentions} reference${s.mentions === 1 ? '' : 's'}: ${s.supported} supported, ${s.ignored} ignored, ${s.unsupported} unsupported, ${s.unparsed} unparsed`;
  const against = factsLabel ? ` against ${safe(factsLabel)} (${s.facts} fact${s.facts === 1 ? '' : 's'}, ${s.ignoreRules} ignore rule${s.ignoreRules === 1 ? '' : 's'})` : '';
  if (report.clean) {
    lines.push(`numeros-ptbr: clean. ${counts}${against}.`);
  } else {
    lines.push(`numeros-ptbr: ${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}. ${counts}${against}.`);
  }
  report.findings.forEach((f, i) => {
    lines.push('');
    if (f.type === 'unsupported') {
      lines.push(`${i + 1}. unsupported: "${safe(f.raw)}" (${label(f)}) has no matching fact`);
    } else {
      lines.push(`${i + 1}. unparsed: "${safe(f.text)}" could not be read: ${REASONS[f.reason] ?? safe(f.reason)}`);
    }
    lines.push(`   ${describeLocation(f.location)}`);
    lines.push(`   "${safe(f.sentence)}"`);
  });
  if (report.findings.length > 0) {
    lines.push('');
    lines.push('Add a fact (with a source) for each reference that is right, correct the text where it is wrong,');
    lines.push('or add an ignore rule with a reason where it is not a claim.');
  }
  if (s.omitted > 0) {
    const kinds = Object.entries(s.omittedByKind).map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push('');
    lines.push(`Skipped by documented heuristics: ${kinds}.${verbose ? '' : ' Use --verbose to list them.'}`);
  }
  if (report.unusedFacts.length > 0) {
    const shown = report.unusedFacts.slice(0, 10).map(safe).join(', ');
    lines.push(`Facts never mentioned: ${shown}${report.unusedFacts.length > 10 ? `, and ${report.unusedFacts.length - 10} more` : ''}.`);
  }
  if (verbose) {
    for (const o of report.omissions) lines.push(`  skipped ${o.kind}: "${safe(o.text)}" (${describeLocation(o.location)})`);
    for (const m of report.supported) {
      lines.push(`  supported: "${safe(m.raw)}" (${label(m)}) by ${m.facts.map((f) => `${safe(f.id)} [${safe(f.source)}]`).join('; ')} (${describeLocation(m.location)})`);
    }
    for (const m of report.ignored) lines.push(`  ignored: "${safe(m.raw)}" (${label(m)}): ${safe(m.reason)} (${describeLocation(m.location)})`);
  }
  if (report.clean) lines.push('"Supported" means a fact with a source is registered for that value and unit. It does not mean the fact is true.');
  return `${lines.join('\n')}\n`;
}

/** The `extract` command output. */
export function formatExtraction(result, { verbose = false } = {}) {
  const lines = [`numeros-ptbr: ${result.mentions.length} reference${result.mentions.length === 1 ? '' : 's'} found.`];
  for (const m of result.mentions) lines.push(`  "${safe(m.raw)}" -> ${label(m)} [${m.form}] (${describeLocation(m.location)})`);
  for (const u of result.unparsed) lines.push(`  unparsed "${safe(u.text)}": ${REASONS[u.reason] ?? safe(u.reason)} (${describeLocation(u.location)})`);
  if (result.omissions.length > 0) {
    const kinds = {};
    for (const o of result.omissions) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
    lines.push(`Skipped by documented heuristics: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}.${verbose ? '' : ' Use --verbose to list them.'}`);
    if (verbose) for (const o of result.omissions) lines.push(`  skipped ${o.kind}: "${safe(o.text)}" (${describeLocation(o.location)})`);
  }
  return `${lines.join('\n')}\n`;
}
