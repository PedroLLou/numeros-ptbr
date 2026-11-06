/** Unit of a reference or fact. Matching is exact on (unit, value). */
export type Unit = 'number' | 'percent' | 'BRL' | 'date';

export const UNIT_NAMES: readonly Unit[];

export interface Limits {
  readonly maxInputBytes: number;
  readonly maxFactsBytes: number;
  readonly maxFacts: number;
  readonly maxIgnoreRules: number;
  readonly maxCues: number;
  readonly maxWords: number;
  readonly maxSrtLineLength: number;
  readonly maxWordLength: number;
  readonly maxFactStringLength: number;
  readonly maxIdLength: number;
  readonly maxReportedErrors: number;
}
export const LIMITS: Limits;

export interface Thresholds {
  readonly maxIntegerDigits: number;
  readonly maxFractionDigits: number;
  readonly maxSpelledValue: number;
  readonly maxSuffixLetters: number;
  readonly maxRangeDigits: number;
  readonly sentenceWindow: number;
  readonly snippetLength: number;
  readonly excerptLength: number;
}
export const THRESHOLDS: Thresholds;

/** Thrown for invalid input: bad facts, malformed SRT/words, oversized input, unknown format. */
export class InputError extends Error {
  readonly name: 'InputError';
  /** 'invalid-input' | 'invalid-facts' | 'invalid-srt' | 'invalid-words' | 'too-large' | 'unreadable' | 'usage' */
  readonly code: string;
  /** One line per problem, with the JSON path or line number. Never contains long input excerpts. */
  readonly details: string[];
  constructor(message: string, options?: { code?: string; details?: string[] });
}

// ------------------------------------------------------------------ facts

export interface Fact {
  id: string;
  /** Canonical decimal string ("49.9"), or an ISO date ("2026-03-05", "--03-05") when unit is "date". */
  value: string;
  unit: Unit;
  /** A http(s) URL or an explicit reference. Never fetched, never checked for existence. */
  source: string;
  /** Informational only; never used for matching. */
  context?: string;
}

export interface IgnoreRule {
  value: string;
  unit: Unit;
  reason: string;
}

export interface FactsManifest {
  version: 1;
  facts: Fact[];
  ignore: IgnoreRule[];
}

/** What a user may write: value as a JSON number or a decimal string, unit optional ("number"). */
export interface FactsInput {
  version: 1;
  facts: Array<{ id: string; value: string | number; unit?: Unit; source: string; context?: string }>;
  ignore?: Array<{ value: string | number; unit?: Unit; reason: string }>;
}

export type FactsValidation = { ok: true; manifest: FactsManifest; errors: [] } | { ok: false; errors: string[] };

export function validateFacts(input: unknown): FactsValidation;
export function assertFacts(input: unknown): FactsManifest;
export function parseFactsJson(text: string): FactsManifest;

// ------------------------------------------------------------------ sources

export interface TextLocation {
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units. */
  column: number;
}
export interface SrtLocation extends TextLocation {
  /** Cue number as written in the file. */
  cue: number;
  /** Cue start and end, in seconds. */
  start: number;
  end: number;
}
export interface WordsLocation {
  wordIndex: number;
  /** Start of the word in which the reference begins, in seconds. */
  start: number;
  end?: number;
}
export type Location = TextLocation | SrtLocation | WordsLocation;

export interface Source {
  format: 'text' | 'srt' | 'words';
  /** The text that is scanned. For srt and words it is built from the cue text / the words. */
  text: string;
  locate(offset: number): Location;
}

export function textSource(text: string): Source;
export function srtSource(content: string): Source;
export function wordsSource(input: string | Array<{ word: string; start: number; end?: number }> | { words: Array<{ word: string; start: number; end?: number }> }): Source;
export function readSource(format: 'text' | 'srt' | 'words', content: unknown): Source;

// ------------------------------------------------------------------ extraction

export interface ScanOptions {
  /** Extract a lone "um"/"uma" with no numeric or unit context. Default false. */
  includeArticles?: boolean;
}

export interface RawMention {
  /** Canonical decimal string, or an ISO date for unit "date". */
  value: string;
  unit: Unit;
  /** The text as written, including "R$", "%" or the unit word. */
  raw: string;
  form: 'digits' | 'words';
  /** Offset and length in `Source.text` (UTF-16 code units). */
  offset: number;
  length: number;
}

export type OmissionKind = 'article' | 'idiom' | 'time' | 'identifier' | 'ordinal' | 'scale-without-multiplier';
export type UnparsedReason = 'ambiguous-separator' | 'number-too-long' | 'invalid-date' | 'unsupported-slash-number' | 'unsupported-fraction' | 'unsupported-sign';

export interface Omission {
  kind: OmissionKind;
  text: string;
  offset: number;
  length: number;
}
export interface Unparsed {
  reason: UnparsedReason;
  text: string;
  offset: number;
  length: number;
}

export function scanText(text: string, options?: ScanOptions): { mentions: RawMention[]; omissions: Omission[]; unparsed: Unparsed[] };
export function sentenceAround(text: string, offset: number, length: number): string;

export interface Mention extends RawMention {
  location: Location;
  sentence: string;
}

export interface Extraction {
  format: Source['format'];
  mentions: Mention[];
  omissions: Array<Omission & { location: Location }>;
  unparsed: Array<Unparsed & { location: Location; sentence: string }>;
}
export function extract(source: Source, options?: ScanOptions): Extraction;

// ------------------------------------------------------------------ check

export interface UnsupportedFinding extends Mention {
  type: 'unsupported';
}
export interface UnparsedFinding {
  type: 'unparsed';
  reason: UnparsedReason;
  text: string;
  offset: number;
  length: number;
  location: Location;
  sentence: string;
}
export type Finding = UnsupportedFinding | UnparsedFinding;

export interface Report {
  tool: 'numeros-ptbr';
  reportVersion: 1;
  format: Source['format'];
  /** True when there are no findings. Exit code 0 in the CLI. */
  clean: boolean;
  summary: {
    mentions: number;
    supported: number;
    ignored: number;
    unsupported: number;
    unparsed: number;
    omitted: number;
    omittedByKind: Partial<Record<OmissionKind, number>>;
    facts: number;
    ignoreRules: number;
  };
  findings: Finding[];
  supported: Array<Mention & { facts: Array<{ id: string; source: string; context?: string }> }>;
  ignored: Array<Mention & { reason: string }>;
  omissions: Array<Omission & { location: Location }>;
  /** Ids of facts that no reference matched. Informational, not a finding. */
  unusedFacts: string[];
}

/** Validates the manifest (throws InputError when invalid), then compares every reference with it. */
export function check(source: Source, facts: unknown, options?: ScanOptions): Report;

// ------------------------------------------------------------------ report text

/** Replace control, escape and bidirectional-override characters so untrusted text is safe to print. */
export function safe(value: unknown): string;
export function formatTime(seconds: number): string;
export function describeLocation(location: Location): string;
export function formatReport(report: Report, options?: { verbose?: boolean; factsLabel?: string }): string;
export function formatExtraction(extraction: Extraction, options?: { verbose?: boolean }): string;
