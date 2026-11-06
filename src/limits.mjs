// Documented limits and thresholds. Everything here is part of the public contract
// (see README "Limits and thresholds"); changing a value is a behavior change.

/** Input size limits, checked before any parsing work. */
export const LIMITS = Object.freeze({
  /** Text, SRT and words input: bytes (CLI) and UTF-16 units (library). */
  maxInputBytes: 4 * 1024 * 1024,
  /** Facts manifest file size in bytes. */
  maxFactsBytes: 1024 * 1024,
  maxFacts: 5000,
  maxIgnoreRules: 5000,
  maxCues: 100_000,
  maxWords: 500_000,
  /** Longest single line accepted in an SRT file, in UTF-16 units. */
  maxSrtLineLength: 2000,
  /** Longest `word` string accepted in a words list. */
  maxWordLength: 200,
  /** Longest id/source/context/reason string in a facts manifest. */
  maxFactStringLength: 500,
  maxIdLength: 64,
  /** Validation errors collected before the rest is skipped. */
  maxReportedErrors: 25,
});

/** Extraction thresholds. Anything outside them is reported, not silently dropped. */
export const THRESHOLDS = Object.freeze({
  /** Digits before the decimal comma / after it. Longer numbers are reported as unparsed. */
  maxIntegerDigits: 24,
  maxFractionDigits: 12,
  /** Largest spelled-out number understood: "novecentos e noventa e nove bilhões ... novecentos e noventa e nove". */
  maxSpelledValue: 999_999_999_999,
  /** Letters glued to a digit run that still count as a unit suffix ("20kg"); longer is an identifier. */
  maxSuffixLetters: 4,
  /** "12-15" is a range of two numbers when both sides have at most this many plain digits; otherwise an identifier. */
  maxRangeDigits: 4,
  /** How far, in characters, the sentence shown with a finding may extend on each side of the number. */
  sentenceWindow: 400,
  /** Longest sentence snippet kept in a report. */
  snippetLength: 160,
  /** Longest omitted/unparsed text excerpt kept in a report. */
  excerptLength: 80,
});

export class InputError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, details?: string[] }} [options]
   */
  constructor(message, { code = 'invalid-input', details = [] } = {}) {
    super(message);
    this.name = 'InputError';
    this.code = code;
    this.details = details;
  }
}
