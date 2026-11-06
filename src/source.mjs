// Turns the three supported inputs into one shape: { format, text, locate(offset) }.
//   text   plain text or Markdown, read as-is (no Markdown syntax is interpreted)
//   srt    SubRip cues; cue numbers and timestamps are structure, never scanned for numbers
//   words  a JSON list of { word, start[, end] } as produced by speech-to-text tools
// `locate(offset)` maps an offset in `text` back to where the reader can find it.
import { InputError, LIMITS } from './limits.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkLength(text, label) {
  if (typeof text !== 'string') throw new InputError(`${label}: expected a string`);
  if (text.length > LIMITS.maxInputBytes) throw new InputError(`${label}: input is larger than ${LIMITS.maxInputBytes} characters`, { code: 'too-large' });
  if (text.includes('\0')) throw new InputError(`${label}: contains NUL characters (is this a binary file?)`);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) starts.push(i + 1);
  }
  return starts;
}

/** Index of the last element whose key is <= offset (binary search over an ascending array). */
function floorIndex(items, offset, key) {
  let lo = 0;
  let hi = items.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= offset) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Plain text or Markdown. Line and column are 1-based; the column counts UTF-16 code units.
 * A leading byte-order mark is dropped before positions are computed.
 */
export function textSource(input) {
  const text = checkLength(input, 'text');
  const starts = lineStarts(text);
  return {
    format: 'text',
    text,
    locate(offset) {
      const idx = floorIndex(starts, offset, (s) => s);
      return { line: idx + 1, column: offset - starts[idx] + 1 };
    },
  };
}

// ---------------------------------------------------------------- SRT

const TIMESTAMP = /^(\d{1,2}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{1,2}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s.*)?$/;

const toMs = (h, m, s, ms) => ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);

/** Blanks <i>…</i> and {\an8} style tags with spaces of the same length so positions stay valid. */
function blankTags(line) {
  if (!line.includes('<') && !line.includes('{')) return line;
  const out = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const close = c === '<' ? '>' : c === '{' && line[i + 1] === '\\' ? '}' : null;
    if (close) {
      const e = line.indexOf(close, i + 1);
      if (e !== -1 && e - i <= 200) {
        out.push(' '.repeat(e - i + 1));
        i = e + 1;
        continue;
      }
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

export function srtSource(input) {
  const content = checkLength(input, 'srt');
  const lines = content.split(/\r\n|\n|\r/);
  const fail = (n, msg) => {
    throw new InputError(`srt: line ${n}: ${msg}`, { code: 'invalid-srt' });
  };
  let joined = '';
  const segments = [];
  let cues = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].length > LIMITS.maxSrtLineLength) fail(i + 1, `line is longer than ${LIMITS.maxSrtLineLength} characters`);
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    if (lines[i].trim().startsWith('WEBVTT')) fail(i + 1, 'WebVTT is not supported, only SubRip (.srt)');
    if (!/^\d{1,9}$/.test(lines[i].trim())) fail(i + 1, 'expected a cue number');
    const cueNumber = Number(lines[i].trim());
    i++;
    if (i >= lines.length) fail(i, 'the cue has no timestamp line');
    if (lines[i].length > LIMITS.maxSrtLineLength) fail(i + 1, `line is longer than ${LIMITS.maxSrtLineLength} characters`);
    const m = TIMESTAMP.exec(lines[i]);
    if (!m) fail(i + 1, 'expected a timestamp line like 00:00:01,000 --> 00:00:03,500');
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    if (endMs < startMs) fail(i + 1, 'the cue ends before it starts');
    i++;
    if (++cues > LIMITS.maxCues) throw new InputError(`srt: more than ${LIMITS.maxCues} cues`, { code: 'too-large' });
    while (i < lines.length && lines[i].trim() !== '') {
      if (lines[i].length > LIMITS.maxSrtLineLength) fail(i + 1, `line is longer than ${LIMITS.maxSrtLineLength} characters`);
      if (joined) joined += '\n';
      segments.push({ at: joined.length, line: i + 1, cue: cueNumber, start: startMs / 1000, end: endMs / 1000 });
      joined += blankTags(lines[i]);
      i++;
    }
  }
  if (cues === 0) throw new InputError('srt: no cues found', { code: 'invalid-srt' });
  return {
    format: 'srt',
    text: joined,
    locate(offset) {
      const seg = segments[floorIndex(segments, offset, (s) => s.at)];
      return { line: seg.line, column: offset - seg.at + 1, cue: seg.cue, start: seg.start, end: seg.end };
    },
  };
}

// ---------------------------------------------------------------- words

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/**
 * @param {string | unknown[] | { words: unknown[] }} input a JSON string, a list, or an object with a "words" list
 */
export function wordsSource(input) {
  let data = input;
  if (typeof input === 'string') {
    const text = checkLength(input, 'words');
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new InputError(`words: not valid JSON (${String(e.message).slice(0, 120)})`, { code: 'invalid-words' });
    }
  }
  const list = Array.isArray(data) ? data : isPlainObject(data) && Array.isArray(data.words) ? data.words : null;
  if (!list) throw new InputError('words: expected a list or an object with a "words" list', { code: 'invalid-words' });
  if (list.length === 0) throw new InputError('words: the list is empty', { code: 'invalid-words' });
  if (list.length > LIMITS.maxWords) throw new InputError(`words: more than ${LIMITS.maxWords} words`, { code: 'too-large' });

  const errors = [];
  const err = (path, msg) => {
    if (errors.length < LIMITS.maxReportedErrors) errors.push(`${path}: ${msg}`);
  };
  let text = '';
  const segments = [];
  let prevStart = -Infinity;
  for (let idx = 0; idx < list.length && errors.length < LIMITS.maxReportedErrors; idx++) {
    const w = list[idx];
    const path = `words[${idx}]`;
    if (!isPlainObject(w)) {
      err(path, 'expected an object with "word" and "start"');
      continue;
    }
    let ok = true;
    if (typeof w.word !== 'string' || w.word.trim() === '') {
      err(`${path}.word`, 'expected a non-empty string');
      ok = false;
    } else if (w.word.length > LIMITS.maxWordLength || CONTROL.test(w.word)) {
      err(`${path}.word`, `expected at most ${LIMITS.maxWordLength} characters and no control characters`);
      ok = false;
    }
    if (typeof w.start !== 'number' || !Number.isFinite(w.start) || w.start < 0 || w.start > 1e7) {
      err(`${path}.start`, 'expected a number of seconds between 0 and 10000000');
      ok = false;
    } else if (w.start < prevStart) {
      err(`${path}.start`, 'start times must not decrease');
      ok = false;
    }
    if (w.end !== undefined && (typeof w.end !== 'number' || !Number.isFinite(w.end) || (typeof w.start === 'number' && w.end < w.start))) {
      err(`${path}.end`, 'expected a number of seconds not before "start"');
      ok = false;
    }
    if (!ok) continue;
    prevStart = w.start;
    if (text) text += ' ';
    segments.push({ at: text.length, wordIndex: idx, start: w.start, end: w.end });
    text += w.word.trim();
  }
  if (errors.length > 0) {
    throw new InputError(`words: ${errors.length >= LIMITS.maxReportedErrors ? 'at least ' : ''}${errors.length} problem(s)`, { code: 'invalid-words', details: errors });
  }
  return {
    format: 'words',
    text,
    locate(offset) {
      const seg = segments[floorIndex(segments, offset, (s) => s.at)];
      const loc = { wordIndex: seg.wordIndex, start: seg.start };
      if (seg.end !== undefined) loc.end = seg.end;
      return loc;
    },
  };
}

/**
 * @param {'text' | 'srt' | 'words'} format
 * @param {string | unknown} content text/srt: a string; words: a JSON string or an already parsed value
 */
export function readSource(format, content) {
  if (format === 'text') return textSource(content);
  if (format === 'srt') return srtSource(content);
  if (format === 'words') return wordsSource(content);
  throw new InputError(`unknown format "${String(format).slice(0, 20)}" (expected text, srt or words)`, { code: 'usage' });
}
