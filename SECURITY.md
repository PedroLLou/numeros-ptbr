# Security notes

This is an early package, published on GitHub only (no npm release). These are its real limits.

## What a clean report means

Exit code 0 means every number the tool could read has a fact with a source or an ignore rule with a reason. It does **not** mean that:

- the facts are true, or that a `source` exists, is reachable or says what the fact claims. Sources are never fetched or checked, and a placeholder source passes;
- the sentence uses the number correctly. `Somos 120` passes if 120 is registered, even if the sentence is wrong about what is 120;
- every number was found. Numbers outside the supported grammar, skipped by a heuristic or inside Markdown/URLs are not checked (see the README "Heuristics, omissions and what is not read"). Skips are counted in the report, but a skipped number is still unchecked;
- a number in an ignore rule is really not a claim. Ignore rules are the author's statement, with the reason echoed in the report.

Matching is on canonical value and unit. A number can be right for the wrong thing: `20` registered for "20 employees" also covers "20 offices".

## Untrusted content

The text being checked, the SRT file, the word list and the facts file are all data. The tool never evaluates, executes, imports, fetches or follows anything from them: there is no `eval`, no dynamic import, no network or child-process module in the source (a test enforces this). Facts files are parsed with `JSON.parse` only.

Text from the input that appears in the human report (the number, the surrounding sentence, file paths in error messages) has control characters, escape sequences and bidirectional overrides replaced with visible `\u{..}` escapes, so a hostile file cannot rewrite the terminal. JSON output is escaped by `JSON.stringify`.

This does **not** stop an agent that reads the report or the input from obeying an instruction written in the text ("ignore previous instructions"). That is a prompt-injection problem outside this tool. Do not give an agent that reads a report more authority than it would have without it.

Facts files are validated strictly: unknown keys (including `__proto__`), wrong types, empty or oversized strings, control and bidirectional-override characters, invalid dates and duplicates are rejected. Duplicate keys inside one JSON object are **not** detected: `JSON.parse` keeps the last one, so a repeated `"value"` silently wins.

## Resource limits

The scanner is hand-written and linear in the input size, uses no large regular expressions on the input, and was exercised with repetitive and pathological strings in the tests. Input size is capped (4 MiB for text, SRT and words, 1 MiB for facts, caps on entries, cues, words and line length) and checked before parsing. These bound memory and time for ordinary use. They are not a defense against a determined resource-exhaustion attack on a shared machine, and standard input is read into memory up to the cap.

## File system behavior

- The tool reads only the paths you pass (`<input>`, `--facts`). It never lists, opens or recurses into a folder, expands a glob, or reads the current directory by default. A folder is refused with exit code 2.
- It writes nothing: no output files, caches or temporary files. Results go to standard output, errors to standard error.
- Paths are used as given, including `..` segments and symbolic links; the files you name are followed. Do not run it on paths an attacker controls and can swap while it runs.

## Other limits

- No fuzzing and no third-party audit. No production use so far.
- Positions count UTF-16 code units. Look-alike (homoglyph) digits and letters are not detected; non-ASCII digits are not read as numbers.
- The CI matrix exercises Node 22 and 24 on Ubuntu and Windows. See the repository Actions page for the result of a particular commit. Local development was verified on Windows with Node 24.

## Reporting

Report vulnerabilities privately through GitHub: open
<https://github.com/PedroLLou/numeros-ptbr/security/advisories/new> (Security tab,
"Report a vulnerability"). Please do not open a public issue for a suspected
vulnerability. Include the version or commit, the input or command that triggers
it and the impact you observed. This is a personal project maintained on a best-effort
basis, with no response-time guarantee. Non-security bugs go to
<https://github.com/PedroLLou/numeros-ptbr/issues>.
