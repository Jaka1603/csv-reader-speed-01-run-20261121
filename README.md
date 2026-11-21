# csv-reader-speed — Read broken CSV files faster

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Jaka1603/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Jaka1603/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for the make.fun bounty **csv-reader-speed-01-run-20261121**: a faster
drop-in for csv-reader 1.0.0. `solve.js` exports `run(input)` returning exactly
csv-reader 1.0.0's answer — `{columns, rows, errors}` — for every `{text, header}`
input, under its full broken-row policy; `main.ts` is the harness driver that
answers `/input/cases.json` into `/output/answers.json`.

## How it is faster

The reference builds every field a character at a time. This reader finds
field boundaries first and cuts each field out with one `slice()`:

- Unquoted fields: one `charCodeAt` scan to the next comma or line break
  (an indexOf-per-delimiter variant measured ~50% slower and was dropped).
- Quoted fields: one fused pass over the content finds the closing quote,
  notes doubled-quote split points, counts LF breaks and flags any CR;
  the common case is then a single `slice()`. `cleanSegment` (CR/CRLF read
  as LF inside quotes) runs only for segments that actually contain a CR.
- Segment paths survive only where the policy needs them: stray CRs inside
  a field, junk after a closing quote, the re-read after an unterminated
  quote. Errors (`stray_cr`, `quote_junk`, `unterminated_quote`,
  `short_row`, `long_row`) are produced in exactly the reference's order.

## Benchmark (practice set, measured locally)

Practice set: 6 cases, 10,193,953 characters of CSV in total. Method: same
machine, same process type, CPU time from `process.cpuUsage`, median of
repeated full-set runs; the vendor is the kit's own csv-reader 1.0.0.
Local node is v24; the grader runs node 22 in a 1-CPU container, so the
ratios, not the absolute times, are the claim.

- `run()` only: csv-reader ≈ 770–800 ms CPU vs this reader ≈ 152–168 ms
  CPU — about **4.6–5.1× faster**.
- Whole program (`main.ts` on the practice input, JSON parse and stringify
  included, median of 5): house baseline ≈ 1,672 ms CPU vs this entry
  ≈ 972 ms CPU — about **1.7× faster** end to end.

## Correctness evidence

- All 6 practice cases byte-identical answers to csv-reader 1.0.0
  (deep-equal per case, and the driver's `answers.json` byte-identical to
  the house baseline's on the practice input).
- 10,000+ randomized broken-CSV fuzz inputs (quotes, doubled quotes, stray
  CRs, CRLF inside quotes, unterminated quotes, quote junk, BOM, empty
  lines) deep-equal against the vendor reader on every input.
