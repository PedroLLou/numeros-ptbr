# numeros-ptbr

[Português](README.md) · English

CI: [Node 22/24 on Linux and Windows](https://github.com/PedroLLou/numeros-ptbr/actions/workflows/ci.yml).

Lists the numbers a Brazilian Portuguese text states, and checks that each one has a registered fact with a source. Input can be plain text or Markdown, an SRT subtitle file, or a speech-to-text word list with timestamps.

It answers one question: **"is every number in this text backed by an entry in my facts file?"** For each number that is not, it prints the number, the line and column (or the cue / word and its start time), and the sentence around it.

It is **not a fact-checker.** It does not know whether a fact is true, whether its source exists, or whether a sentence uses the number correctly. "Supported" only means the author registered that value and unit with a source. Treat a clean report as "nothing unregistered", not as "nothing wrong".

> Status: early. First public release is this GitHub repository (`PedroLLou/numeros-ptbr`); there is no npm release (`"private": true`), and availability of the name on npm has not been checked. Node >= 22, ESM, no runtime dependencies, no network access.

## What it reads

| Form | Examples | Read as |
| --- | --- | --- |
| Digits, pt-BR | `20`, `1,5`, `1.234,56`, `3 mil`, `2,5 milhões` | number (`20`, `1.5`, `1234.56`, `3000`, `2500000`) |
| Percent | `20%`, `20 %`, `20 por cento`, `vinte por cento` | percent `20` |
| Reais | `R$ 49,90`, `R$49,90`, `20 reais`, `50 centavos`, `2 milhões de reais` | BRL `49.9`, `20`, `0.5`, `2000000` |
| Dates | `05/03/2026`, `5/3`, `2026-03-05`, `5 de março de 2026`, `1º de maio`, `cinco de março de 2026` | date `2026-03-05`, `--03-05` (no year) |
| Spelled out | `vinte`, `cem`, `cento e vinte`, `duzentas e cinquenta`, `mil e quinhentos`, `dois mil e vinte e seis`, `um milhão e duzentos mil`, `três vírgula cinco` | number (`20`, `100`, `120`, `250`, `1500`, `2026`, `1200000`, `3.5`) |

Matching is exact on **unit and value**: `number`, `percent`, `BRL` and `date` never match each other. `20 reais` is not `20%`, `20` is not part of `120`, `1.234,56` is not `1,5`. Values are canonical decimal strings, never floats (`"R$ 1234,560"` and `"R$ 1.234,56"` are both `1234.56`).

Spelled-out numbers work from 0 to 999 999 999 999 (up to bilhões), with the variants `catorze/quatorze`, `duzentos/duzentas` and so on, and ignore case and accents (`TRÊS`, `três`, `tres`, composed or decomposed Unicode).

## Quick start

```sh
node bin/numeros-ptbr.mjs check fixtures/script-findings.txt --facts fixtures/facts.json
```

```
numeros-ptbr: 4 findings. 7 references: 3 supported, 0 ignored, 4 unsupported, 0 unparsed against fixtures/facts.json (4 facts, 1 ignore rule).

1. unsupported: "20 reais" (BRL 20) has no matching fact
   line 2, column 57
   "Hoje são vinte por cento de desconto, mas já chegamos a 20 reais de desconto."
...
```

The project is not published to npm. Use it from a checkout of this repository (`node bin/numeros-ptbr.mjs`). Do not fetch it from a registry by name: a package with that name there would not be this one.

### Command line

```
numeros-ptbr [check] <input|-> --facts <facts.json> [options]
numeros-ptbr extract <input|-> [options]
```

| Option | Meaning |
| --- | --- |
| `--facts <file>` | The facts manifest (required by `check`). |
| `--format text\|srt\|words` | Default: from the extension (`.srt` is `srt`, `.json` is `words`, anything else is `text`). |
| `--json` | Print the report as JSON on standard output. |
| `--include-articles` | Also extract a lone `um`/`uma` (see below). |
| `--verbose` | Also list supported and ignored references and skipped text. |
| `-` as input | Read standard input. |

| Exit code | Meaning |
| --- | --- |
| `0` | `check`: no findings. `extract`: input read. |
| `1` | Findings: a reference without a matching fact, or text that looks numeric but cannot be read. |
| `2` | Invalid input or usage: unreadable file, folder given, invalid UTF-8, malformed facts, SRT or words, unknown option. |

With `--json`, errors (exit 2) are also JSON on standard output: `{ "ok": false, "error": { "code", "message", "details" } }`.

It reads only the files you name. It never opens a folder, expands a glob, fetches a URL or calls a service.

### Library

```js
import { check, readSource, parseFactsJson, formatReport } from 'numeros-ptbr'; // from a checkout: './src/index.mjs'
import { readFileSync } from 'node:fs';

const facts = parseFactsJson(readFileSync('facts.json', 'utf8'));
const source = readSource('srt', readFileSync('video.srt', 'utf8'));
const report = check(source, facts);
if (!report.clean) process.stdout.write(formatReport(report));
```

TypeScript declarations ship in `src/index.d.mts`. Invalid input throws `InputError` (`code`, `details`).

## The facts manifest

```json
{
  "version": 1,
  "facts": [
    { "id": "plan-price", "value": "49.90", "unit": "BRL", "source": "https://example.com/pricing", "context": "Monthly plan" },
    { "id": "team-size", "value": 120, "source": "headcount sheet, 2026-11" }
  ],
  "ignore": [
    { "value": 2026, "reason": "The current year used as a label, not a claim." }
  ]
}
```

- `id`: required, unique, letters/digits/`.`/`_`/`-`, at most 64 characters.
- `value`: required. A JSON number or a plain decimal string with a dot: `"1234.56"`. No `1.234,56`, no `%`, no `R$`, no sign, no leading zero. For `date`: `"2026-03-05"` or `"--03-05"` (no year), validated as a real calendar date.
- `unit`: optional, one of `number` (default), `percent`, `BRL`, `date`.
- `source`: required, not empty. An `http(s)` URL or any explicit reference (`"contract-2026.pdf p.3"`). A URL-shaped source must be a valid `http`/`https` URL. It is **never fetched** and its existence is not checked.
- `context`: optional, informational only (shown with `--verbose`, never used for matching).
- `ignore[]`: a value you declare is not a claim, with a required `reason`. Reported separately, never hidden. A value cannot be both a fact and an ignore rule.

Validation is strict: unknown keys, wrong types, empty strings, control characters and duplicates are errors, and every problem is listed with its JSON path. Duplicate JSON object keys are not detected (`JSON.parse` keeps the last one).

## Formats

- **text** (also Markdown): read as-is. No Markdown syntax is interpreted, so a number inside a URL or a code block is still a number. Use an ignore rule, or remove it from the input.
- **srt**: SubRip. Cue numbers and timestamps are structure and are never scanned. Tags like `<i>` and `{\an8}` are blanked. A number may continue across lines and cues. Locations give the file line and column, the cue number and the cue start. WebVTT is rejected.
- **words**: a JSON list of `{ "word", "start" }` (optional `end`), or `{ "words": [...] }`. Words are joined with single spaces. `start` is a number of seconds, must not decrease, and the report gives the start of the word where the reference begins. Extra keys such as `confidence` are ignored.

Line and column are 1-based. The column counts UTF-16 code units. A leading byte-order mark is dropped before positions are computed.

## Heuristics, omissions and what is not read

Nothing is dropped silently. Every skip is counted in the report (`--verbose` lists them), and text that looks numeric but cannot be read is a **finding** (`unparsed`, exit 1).

Skipped by heuristic (`omissions`):

| Kind | What | Why |
| --- | --- | --- |
| `article` | A lone `um`/`uma` with no number, scale word, `vírgula` or unit after it | Almost always an article. `--include-articles` turns this off. `vinte e um`, `um real`, `um por cento`, `um milhão`, `um vírgula cinco` are read. |
| `idiom` | `do zero`, `desde zero` | An expression, not a quantity. `por cento` without a number is also ignored. |
| `time` | `10:30`, `10:30:15`, `10h30` | A clock time. `10h` alone is read as the number 10. |
| `identifier` | `COVID19`, `A4`, `0800`, `007`, `12345-678`, `123.456.789-00`, glued letters longer than 4 | Codes and identifiers. |
| `ordinal` | `1º`, `2ª`, `3°` | An ordinal is not a quantity. `1º de maio` is a date. |
| `scale-without-multiplier` | `milhão`, `milhões`, `bilhão`, `bilhões` alone | No multiplier to read. A bare `mil` **is** read as 1000. |

Reported as `unparsed`:

| Reason | Example |
| --- | --- |
| `ambiguous-separator` | `3.5`, `1,5,3`, `1234.567`: a dot is a thousands separator only before exactly three digits, and the decimal mark is a comma |
| `invalid-date` | `31 de fevereiro`, `29/02/2025`, `3/15` |
| `unsupported-slash-number` | `05/03/26` (two-digit year), `1/2/3/4` |
| `unsupported-fraction` | `dois milhões e meio`, `3 e meia` |
| `number-too-long` | more than 24 integer or 12 decimal digits |

Signed quantities such as `-5%`, `−5%` and `menos cinco por cento` are findings
(`unparsed`, reason `unsupported-sign`), not positive quantities. A nearby sign
is checked within 32 characters of each extracted reference. A Markdown bullet
directly before a quantity can therefore require review too.

Other forms not supported, and therefore either not extracted or read partially:
fractions (`1/2` is read as a date, 1 February), `meio`/`meia` and ordinals spelled
out, years as bare numbers (`2026` is a number, so register or ignore it),
currencies other than BRL (`US$ 20` is the number 20), `dezasseis`-style European
spellings, non-ASCII digits, a decimal point (`3.5`), numbers inside Markdown/URLs,
and spelled-out decimals digit by digit (`zero vírgula dois cinco` is read as
`0.2` and `5`). Quantifiers such as `os dois` are extracted like any number.

## Limits and thresholds

Exported as `LIMITS` and `THRESHOLDS`.

| Name | Value |
| --- | --- |
| Input size (file or stdin) | 4 MiB |
| Facts file size | 1 MiB |
| Facts / ignore rules | 5000 each |
| SRT cues / words | 100 000 / 500 000 |
| SRT line length | 2000 characters |
| Digits | 24 integer, 12 decimal |
| Spelled-out range | 0 to 999 999 999 999 |
| Glued unit letters (`20kg`) | up to 4 |
| Range `5-10` | each side up to 4 plain digits, else identifier |
| Sentence shown | up to 160 characters, searched 400 characters each way |

## Tests

```sh
npm test            # node --test: behavior, CLI exit codes, malformed input, npm pack --dry-run
npm run example     # a clean check of the synthetic example
npm run pack:dry    # list what would be packed; nothing is published; no npm release
```

All fixtures are synthetic. No test touches the network. See [SECURITY.md](SECURITY.md) and [PROVENANCE.md](PROVENANCE.md). Portuguese documentation: [README.md](README.md).

## License

MIT, copyright 2026 Pedro Lourenconi Lima. The license covers this package's code only.
