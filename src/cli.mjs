import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { extract, check } from './check.mjs';
import { parseFactsJson } from './facts.mjs';
import { InputError, LIMITS } from './limits.mjs';
import { formatExtraction, formatReport, safe } from './report.mjs';
import { readSource } from './source.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const EXIT = Object.freeze({ clean: 0, findings: 1, invalid: 2 });

const USAGE = `numeros-ptbr ${VERSION}
Lists the numbers a Brazilian Portuguese text states and checks each one against a facts manifest.
It reads only the files you name. It never opens a folder, fetches a URL or calls a service.

Usage:
  numeros-ptbr [check] <input|-> --facts <facts.json> [options]
  numeros-ptbr extract <input|-> [options]
  numeros-ptbr --help | --version

  <input>   a file to read, or "-" for standard input
  check     is the default command (to read a file literally named "extract", write: check extract)

Options:
  --facts <file>       facts manifest (JSON), required by check
  --format <format>    text (also Markdown, read as plain text), srt or words (JSON list of {word, start}).
                       Default: from the file extension (.srt -> srt, .json -> words), otherwise text.
  --json               print the report as JSON on standard output
  --include-articles   also extract a lone "um"/"uma" with no numeric or unit context (skipped by default)
  --verbose            also list supported and ignored references and skipped text
  -h, --help           show this help
  -V, --version        show the version

Exit codes:
  0  no findings (check) / input read (extract)
  1  findings: a reference without a matching fact, or text that looks numeric but cannot be read
  2  invalid input or usage: unreadable file, malformed facts/SRT/words, unknown option
`;

class UsageError extends InputError {
  constructor(message) {
    super(message, { code: 'usage' });
  }
}

function parseArgs(argv) {
  const opts = { command: null, input: null, facts: null, format: null, json: false, includeArticles: false, verbose: false, help: false, version: false };
  const rest = [];
  const seen = new Set();
  const once = (name) => {
    if (seen.has(name)) throw new UsageError(`${name} given more than once`);
    seen.add(name);
  };
  const value = (name, inline, i) => {
    once(name);
    if (inline !== undefined) return [inline, i];
    if (i + 1 >= argv.length || (argv[i + 1].startsWith('--') && argv[i + 1] !== '-')) throw new UsageError(`${name} needs a value`);
    return [argv[i + 1], i + 1];
  };
  let onlyPositional = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (onlyPositional || a === '-' || !a.startsWith('-')) {
      rest.push(a);
      continue;
    }
    if (a === '--') {
      onlyPositional = true;
      continue;
    }
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const name = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    const flag = (key) => {
      if (inline !== undefined) throw new UsageError(`${name} does not take a value`);
      once(name);
      opts[key] = true;
    };
    switch (name) {
      case '-h': case '--help': flag('help'); break;
      case '-V': case '--version': flag('version'); break;
      case '--json': flag('json'); break;
      case '--verbose': flag('verbose'); break;
      case '--include-articles': flag('includeArticles'); break;
      case '--facts': [opts.facts, i] = value(name, inline, i); break;
      case '--format': [opts.format, i] = value(name, inline, i); break;
      default: throw new UsageError(`unknown option ${safe(name).slice(0, 40)}`);
    }
  }
  if (opts.help || opts.version) return opts;
  if (rest[0] === 'check' || rest[0] === 'extract') opts.command = rest.shift();
  else opts.command = 'check';
  if (rest.length === 0) throw new UsageError('missing <input> (a file, or "-" for standard input)');
  if (rest.length > 1) throw new UsageError('only one <input> is accepted (folders and globs are never expanded)');
  opts.input = rest[0];
  if (opts.command === 'check' && !opts.facts) throw new UsageError('check needs --facts <facts.json>');
  if (opts.command === 'extract' && opts.facts) throw new UsageError('extract does not use --facts');
  if (opts.format !== null && !['text', 'srt', 'words'].includes(opts.format)) throw new UsageError(`--format must be text, srt or words (got "${safe(opts.format).slice(0, 20)}")`);
  return opts;
}

function readFileLimited(path, limit, what) {
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    throw new InputError(`${what}: cannot read "${safe(path)}" (${e.code ?? 'error'})`, { code: 'unreadable' });
  }
  if (!st.isFile()) throw new InputError(`${what}: "${safe(path)}" is not a file (folders are never read)`, { code: 'unreadable' });
  if (st.size > limit) throw new InputError(`${what}: "${safe(path)}" is larger than ${limit} bytes`, { code: 'too-large' });
  try {
    return readFileSync(path);
  } catch (e) {
    throw new InputError(`${what}: cannot read "${safe(path)}" (${e.code ?? 'error'})`, { code: 'unreadable' });
  }
}

async function readStdin(limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > limit) throw new InputError(`input: standard input is larger than ${limit} bytes`, { code: 'too-large' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decode(buffer, what) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new InputError(`${what}: not valid UTF-8`, { code: 'invalid-input' });
  }
}

function inferFormat(path) {
  const ext = path === '-' ? '' : extname(path).toLowerCase();
  if (ext === '.srt') return 'srt';
  if (ext === '.json') return 'words';
  return 'text';
}

/**
 * Run the CLI. Returns the exit code; writes only to the given streams.
 * @param {string[]} argv
 * @param {{ stdout?: { write(s: string): unknown }, stderr?: { write(s: string): unknown } }} [io]
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const wantsJson = argv.includes('--json');
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      out.write(USAGE);
      return EXIT.clean;
    }
    if (opts.version) {
      out.write(`${VERSION}\n`);
      return EXIT.clean;
    }
    const manifest = opts.command === 'check' ? parseFactsJson(decode(readFileLimited(opts.facts, LIMITS.maxFactsBytes, 'facts'), 'facts')) : null;
    const buffer = opts.input === '-' ? await readStdin(LIMITS.maxInputBytes) : readFileLimited(opts.input, LIMITS.maxInputBytes, 'input');
    const format = opts.format ?? inferFormat(opts.input);
    const source = readSource(format, decode(buffer, 'input'));
    const options = { includeArticles: opts.includeArticles };
    if (opts.command === 'extract') {
      const result = extract(source, options);
      out.write(opts.json ? `${JSON.stringify({ tool: 'numeros-ptbr', ...result }, null, 2)}\n` : formatExtraction(result, { verbose: opts.verbose }));
      return EXIT.clean;
    }
    const report = check(source, manifest, options);
    out.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report, { verbose: opts.verbose, factsLabel: opts.facts }));
    return report.clean ? EXIT.clean : EXIT.findings;
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    if (wantsJson) {
      out.write(`${JSON.stringify({ tool: 'numeros-ptbr', ok: false, error: { code: e.code, message: e.message, details: e.details } }, null, 2)}\n`);
    } else {
      err.write(`numeros-ptbr: ${e.message}\n`);
      for (const d of e.details) err.write(`  - ${d}\n`);
      if (e instanceof UsageError) err.write('Run numeros-ptbr --help for usage.\n');
    }
    return EXIT.invalid;
  }
}
