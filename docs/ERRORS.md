# ERRORS.md

Recurring mistakes log. Committed to git; reviewed periodically to promote entries into permanent rules in `AGENTS.md` or linter config.

## Promoted and cleared

Reviewed 2026-10-11. Each entry below is resolved in the repo, so its log entry is gone and the guard is named here.

| Mistake | Permanent guard |
|---|---|
| Unpriced model read as unknown instead of aliased | `MODEL_ALIASES` in `extensions/shared/pricing.ts`, pinned by `test/shared/pricing.test.ts` |
| React duplicate chased with four config knobs | `vitest.config.ts` runs `dashboard/app` as its own project, so it uses its own React |
| Test script split broke `bun run test -- <path>` | one `vitest run` with `test.projects`; forwarding verified at 1 file |
| Host hook wired against an assumed payload shape | `test/extensions/server-sessions.test.ts` fires the hook with the real shape |
| `COUNT` with an `ELSE 0` literal counted every row | `extensions/shared/agent-stats.ts` writes `COUNT(CASE WHEN … THEN 1 END)`; `test/cli/omp-stats.test.ts` pins the throughput |
| Rounding stored values before deriving metrics | `round4` applies only to the output series; the same test pins the derived figure and the series |
| A row field no reader filled left a column blank | the same test asserts `row.provider` for every grouped row shape |
| A unit test imported a component file under the root tsconfig | pure logic lives in `dashboard/app/src/lib/*.ts`; `test/tsconfig.json` includes `.ts` only |
| Slow-CI timeout on a heavy test that passed locally | `vitest.config.ts` sets `testTimeout: 30000`, so no test relies on the 5s framework default |
| Benchmark probes raced the sweep over shared settings file | `docs/BENCHMARK.md` exports `TERSIO_HOME` into the throwaway dir, so a run never opens the live settings file for writing |
| Pixel harness measured live data and live animations | `test/repo-integrity.test.ts` fails if any chart sets `isAnimationActive` to true, so a JS entrance animation cannot return |
| A type-import split dropped an existing type import | `bun run build` runs `tsc`, and `bun run verify` runs the build, so a dropped name fails the build |
| Two edits rewrote a span they only half re-emitted | the same `tsc` step; the half-rewritten interface and the dropped field are compile errors |
| Backticks nested inside a template-literal code generator | the generator is gone; no tracked script writes markdown from a template literal |

## Format

```md
## YYYY-MM-DD — <short title>
**What happened:** Describe the mistake or unexpected behavior.
**Root cause:** Why it happened.
**Prevention rule:** What to do differently next time.
```

## The entries that stay

The eight entries below are editing and verification discipline. No test, lint rule, or config can pin them, because each one describes a choice made while writing the change rather than a state the repo ends in. They stay as written.

## 2026-10-10 — Line-range deletions computed against a list an earlier deletion had shifted
**What happened:** A python pass deleted two function blocks from `extensions/shared/agent-stats.ts` by line range. The first deletion lowered every later index, and the second range used indices read before that deletion, so it cut the middle of `readSessionTrace` instead of the gain block. The file lost 168 lines of live code while the target functions survived.
**Root cause:** Computed all the line anchors, then applied the deletions one after another, so only the first range was still valid.
**Prevention rule:** Delete one span at a time, or match anchors by text, never by a precomputed line number. After any multi-span deletion, `git diff --stat` must show the expected line count per file before the build.
**Verification note:** `git checkout <file>` restored the file; the second attempt used string anchors.

## 2026-09-23 — Malformed oldString/newString boundary in edit calls
**What happened:** `edit` calls produced broken intermediates: a stray `async function` declaration line, a dropped `const SOURCES` opener, duplicated function headers, and deleted neighbors in dashboard/app.js. Each was caught by reading the edited region right after and repaired before building.
**Root cause:** Drafting replacement text that overlapped neighboring declarations instead of keeping the boundary to the exact lines being changed.
**Prevention rule:** Keep every edit boundary to the smallest requested change; read the edited region immediately after each structural edit and repair before moving on. Prefer python-script replacement for large JS block swaps.

## 2026-10-06 — Pasted a numbered diff with stale line ranges into `edit`
**What happened:** An `edit` call was given a `PUT 89.=90` body pasted from a `git diff` fragment instead of the file's real content. It silently dropped `expect(existsSync(usageDbPath())).toBe(true);` from a test. The same pattern later removed the body of a whole test and a `mkdtempSync` line from another file.
**Root cause:** Drafted patch hunk numbers from diff output and reused them as line coordinates. Diff line numbers are hunk offsets, not file coordinates, and a body copied from one file does not describe the target file.
**Prevention rule:** Never paste a diff fragment into `edit`. Read the target region first, then write the smallest literal replacement. Treat any edit that removes an assertion or a statement you did not intend to remove as corrupt: re-read the region immediately.

## 2026-10-06 — Edit body dropped a line the replacement was meant to keep
**What happened:** A `PUT 642.=643` edit in `cli/dashboard.ts` added an `onError` reject handler, but the replacement body omitted `let stopping = false;`. Two functions kept referencing the missing variable until the build caught it with three TS2304 errors.
**Root cause:** The replacement body listed only the new lines. A range PUT replaces the entire range, so any surviving line inside it must be re-emitted in the body.
**Prevention rule:** After an edit that inserts inside a block, read the whole block and confirm every referenced variable is declared. When drafting a replacement body, re-emit each surviving line from the target range.

## 2026-10-07 — RTK coverage judged from a savings summary instead of the rewrite registry
**What happened:** Reported `bun` (1120 calls) and `bunx` (481 calls) as uncovered gaps because neither appeared in `rtk gain`'s top-10 list. Direct probing showed both rewrite (exit 3).
**Root cause:** Treated a savings summary as a coverage report. `rtk gain` ranks by tokens saved, so a rewritten command with small output never appears in it.
**Prevention rule:** Probe `rtk rewrite "<command>"` for coverage: exit 0/3 with stdout means covered, exit 1 means passthrough. Never infer it from `rtk gain` or `rtk session`, which scans Claude Code history only.

## 2026-10-07 — Edit truncated an existing test while trying to insert before it
**What happened:** Adding two new tests to `test/cli/host-menus.test.ts`, the `oldText` spanned a whole existing test and the `newText` contained only that test's opening line. The replacement deleted the body and the closing brace, leaving a parse error at EOF. It also silently dropped an existing assertion before tsc caught the syntax break.
**Root cause:** Used a replacing primitive for an insertion. A range replacement rewrites the entire matched span, so anything intended to survive must be re-emitted in full.
**Prevention rule:** To insert before a block, keep `oldText` to the insertion point alone, or re-emit the whole original block in `newText`. After editing near an existing test, run `git diff -U0 -- <file>` and confirm the change is pure insertion before running the suite.

## 2026-10-10 — A page recomputed a figure the payload already carried
**What happened:** The Providers and Models tables derived throughput as total output tokens divided by average duration, which read 173,158/s where the payload's own `avgTokensPerSecond` read 64.8. A live screenshot caught it, not a test.
**Root cause:** Reached for the two fields that were in front of me instead of the one field the contract already defines for that metric.
**Prevention rule:** Before computing anything from raw fields, check whether the payload carries the finished metric. Render the page and read the numbers once before calling it done.

## 2026-10-10 — A UI check read a stale build
**What happened:** Screenshots and DOM probes against the dashboard reported duplicated month labels, a wrong cell count, and a legend that ran off the card. The source was correct in each case, or already fixed.
**Root cause:** The server ran `dist/tersio.js` from a build made before the last edits, so every probe measured the old bundle.
**Prevention rule:** Restart the server after `bun run build`, and confirm the served bundle dates from this session before trusting a visual or DOM result.

## 2026-10-12 — A tier assertion read the live price cache, so it passed only where that cache exists
**What happened:** `test/cli/usage-tokens.test.ts` asserted a resolved tier for `deepseek/deepseek-v4.1-flash` with no `TERSIO_PRICES_FILE` set, so `loadLivePrices()` fell through to `~/.tersio/prices.json`. That file exists on the developer's machine and nowhere in CI, so the tier resolved `tail` locally and `default` on the runner. The whole suite went green locally; CI failed one test on the next push.
**Root cause:** Wrote an assertion against a cache the host owns, while every neighbouring test in the same file already built its own feed with `setEnv`. The one test that skipped the convention was the one that read machine state.
**Prevention rule:** Any assertion about a resolved price tier, a `known` flag, or a rate must point `TERSIO_PRICES_FILE` at a file the test writes. Prove it by running the file with `HOME` set to an empty temporary directory before pushing, which reproduces the runner's missing home exactly.
