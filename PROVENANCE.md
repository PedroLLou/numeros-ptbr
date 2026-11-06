# Provenance

## What this is

A new implementation, written on 2026-11-06 for this package. It is based on the **observed behavior** of a private gate used in a video-production workflow: spoken or written numbers must either appear in a facts file or be listed in an "ignore" list with a reason, and a failure reports the number and the sentence it was in. No source code was copied from that gate or from any upstream project, and nothing was adapted line by line. The number grammar, the scanner, the facts schema and validator, the SRT and word-list readers, the report and the CLI are original to this package.

Copyright for the new code in this package belongs to Pedro Lourenconi Lima (2026), released under the MIT License. The license covers this package's code only. It does not cover, and implies no rights to, the private gate, its product, its data or its policies.

## Behaviors observed, then re-expressed

- Numbers in a transcript need a registered fact or an ignore entry with a reason.
- The reading of numbers covers digits, percent, reais and dates, and also numbers spelled out in Brazilian Portuguese.
- Expressions that contain number words but are not quantities are excluded (for example "por cento" as a unit and "do zero" as an idiom).
- A failure carries the time at which the number was spoken and the sentence around it.

## Deliberately NOT carried over

- Any fact, brand, project, number, path, configuration or data of the private workflow. All fixtures are synthetic and the names in them are made up.
- Coupling to a studio folder layout, to a brand registry or to a video pipeline. Here the input is a file you name.
- Silent behavior. The private gate is not documented as reporting what it skips; here every skip is counted and every unreadable number is a finding.

## Design choices made here, not observed there

- Values are canonical decimal strings and matching is exact on unit and value (`number`, `percent`, `BRL`, `date`), so `20 reais`, `20%` and `120` never match each other.
- A hand-written scanner instead of large regular expressions, with fixed limits (see the README), so input size and shape cannot cause catastrophic backtracking.
- A rigorous facts schema: mandatory non-empty `source`, mandatory `reason` for ignore rules, no unknown keys, canonical values, calendar-valid dates.
- A documented grammar for spelled-out numbers (descending groups, `e` joiners, `vírgula` decimals) and explicit, reported omissions and unparsed cases.
- SRT, word-list and plain-text readers with line, column, cue and start-time locations.
- Treating all input text as data: terminal output is sanitized, and nothing in the text or the facts is evaluated, fetched or followed.

## Prior art

A search for existing number-provenance or number-linting tools for Portuguese was **not** done for this implementation, so no claim of originality is made. If an existing tool already covers this, contributing there is preferable to growing this package.

## Local sources

Internal research notes dated 2026-11-06 and the private workflow described above. Both are private and not distributed with this package. No upstream repository is vendored or forked.
