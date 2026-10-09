# ERRORS.md

Recurring mistakes log. Committed to git; reviewed periodically to promote entries into permanent rules in `AGENTS.md` or linter config.

## Format

```md
## YYYY-MM-DD — <short title>
**What happened:** Describe the mistake or unexpected behavior.
**Root cause:** Why it happened.
**Prevention rule:** What to do differently next time.
```

## 2026-10-10 — Line-range deletions computed against a list an earlier deletion had shifted
**What happened:** A python pass deleted two function blocks from `extensions/shared/omp-stats.ts` by line range. The first deletion lowered every later index, and the second range used indices read before that deletion, so it cut the middle of `readSessionTrace` instead of the gain block. The file lost 168 lines of live code while the target functions survived.
**Root cause:** Computed all the line anchors, then applied the deletions one after another, so only the first range was still valid.
**Prevention rule:** Delete one span at a time, or match anchors by text, never by a precomputed line number. After any multi-span deletion, `git diff --stat` must show the expected line count per file before the build.
**Verification note:** `git checkout <file>` restored the file; the second attempt used string anchors.

## 2026-09-23 — Malformed oldString/newString boundary in edit calls
**What happened:** `edit` calls produced broken intermediates: a stray `async function` declaration line, a dropped `const SOURCES` opener, duplicated function headers, and deleted neighbors in dashboard/app.js. Each was caught by reading the edited region right after and repaired before building.
**Root cause:** Drafting replacement text that overlapped neighboring declarations instead of keeping the boundary to the exact lines being changed.
**Prevention rule:** Keep every edit boundary to the smallest requested change; read the edited region immediately after each structural edit and repair before moving on. Prefer python-script replacement for large JS block swaps.

## 2026-09-24 — Pixel harness measured live data and live animations, not the conversion
**What happened:** 16-region byte comparison showed 11–16/16 differing after a correct conversion. Three harness flaws stacked: exports embedded the live usage ledger (drifted between runs), addInitScript crashed on missing document.head so CSS animations kept running (ticker/donut positions shifted), and the model-row selector still targeted the deleted `.mrow` class.
**Root cause:** Verified against moving targets. Assumed frozen Date + animations-off without checking the init script survived page load; assumed exports were deterministic while the ledger appends every session turn.
**Prevention rule:** Freeze data first (snapshot DB via TERSIO_USAGE_DB, assert identical token totals in both exports), harden init scripts (guard document.head, MutationObserver re-apply), and re-run same-file double capture to prove 0/16 noise floor before comparing conversions. Disable recharts JS entrance animation (isAnimationActive={false}) — CSS kill-switches cannot stop it.

## 2026-10-04 — Benchmark probes raced the sweep over shared settings file
**What happened:** Manual diagnostic `run-one` probes ran while the background prose/code sweep was in flight. Both set modes through `~/.tersio/settings.json`, so combo samples measured ponytail-only prompt deltas (+1241) instead of the full block (+2968), and settings showed leftover modes (wenyan-ultra/off) from probes.
**Root cause:** Ran probes against the same mutable settings file the sweep driver sequences through. Two writers, no lock.
**Prevention rule:** Never run manual mode-setting probes while a sweep driver runs. Serialize everything through one driver; verify with `tail drive.log` before probing.

## 2026-10-04 — Backticks nested inside a template-literal code generator
**What happened:** `gen-report.mjs` embedded markdown code spans (backticks) inside a JS template literal and failed with `Unterminated string literal`.
**Root cause:** Assumed escaped backticks scale; they don't stay readable or safe in a 100-line template.
**Prevention rule:** In generator scripts, use a placeholder char (e.g. `§`) for code spans and replace with `String.fromCharCode(96)` at write time. No literal backticks inside template literals.

## 2026-09-29 — Unpriced model assumed unknown instead of aliased
**What happened:** The Dashboard showed `Space-Bunny` at $246.52 beside `stealth/Space-Bunny-Alpha` at $0.00. The first id matched no feed key, so it fell to the Sonnet-class default with `known:false` and reported a cost that was never charged.
**Root cause:** Read "no feed match" as "unpriced model" without checking for another spelling of the same model. The feed carries it as `openrouter/stealth/space-bunny-alpha`, priced at zero, and the plain alias missed it because the lookup only tried exact keys before the default.
**Prevention rule:** When a model lands on the default price, search the feed for suffixed, prefixed, and provider-spelled ids before concluding it is unpriced. Treat stealth and alias spellings as one model: group them under one key and resolve its price through the same exact-then-suffix chain, so a free model never reports a default. `MODEL_ALIASES` in `extensions/shared/pricing.ts` is where a new one goes.

## 2026-10-06 — Pasted a numbered diff with stale line ranges into `edit`
**What happened:** An `edit` call was given a `PUT 89.=90` body pasted from a `git diff` fragment instead of the file's real content. It silently dropped `expect(existsSync(usageDbPath())).toBe(true);` from a test. The same pattern later removed the body of a whole test and a `mkdtempSync` line from another file.
**Root cause:** Drafted patch hunk numbers from diff output and reused them as line coordinates. Diff line numbers are hunk offsets, not file coordinates, and a body copied from one file does not describe the target file.
**Prevention rule:** Never paste a diff fragment into `edit`. Read the target region first, then write the smallest literal replacement. Treat any edit that removes an assertion or a statement you did not intend to remove as corrupt: re-read the region immediately.

## 2026-10-06 — Chased a React duplicate with four config knobs before measuring
**What happened:** A dashboard component test threw `Invalid hook call`. Four config changes were tried in sequence: `resolve.alias`, a `react` alias to the other tree, `resolve.dedupe`, and `server.deps.inline: true`. None worked. A probe that rendered a bare hook component passed, which localized the failure to the one import crossing the package boundary.
**Root cause:** Assumed a resolver setting could fix a structural problem. `dashboard/app` is a separate package with its own `node_modules`, so the duplicate React is real, and aliases are not honored for imports inside `node_modules`.
**Prevention rule:** Write the smallest probe that splits the failing case, and read it before changing config. Resolve duplicate libraries structurally, by running the code under the package that owns them, not by tuning the resolver. A config change that does not move the probe result is noise.

## 2026-10-06 — Split the test script into two commands and broke `bun run test -- <path>`
**What happened:** `"test": "vitest run && vitest run --root dashboard/app"` stopped `bun run test -- test/settings.test.ts` from running the requested file. Every path also ran twice.
**Root cause:** Assumed bun forwards script arguments. Probe output showed bun appends them after the last token, so `"$@"` is empty and the paths sit outside both commands.
**Prevention rule:** Probe argument forwarding with an `echo` script before relying on it. For two suites, use one `vitest run` with `test.projects`, each with its own `root`, `include`, and `environment`.

## 2026-10-06 — Edit body dropped a line the replacement was meant to keep
**What happened:** A `PUT 642.=643` edit in `cli/dashboard.ts` added an `onError` reject handler, but the replacement body omitted `let stopping = false;`. Two functions kept referencing the missing variable until the build caught it with three TS2304 errors.
**Root cause:** The replacement body listed only the new lines. A range PUT replaces the entire range, so any surviving line inside it must be re-emitted in the body.
**Prevention rule:** After an edit that inserts inside a block, read the whole block and confirm every referenced variable is declared. When drafting a replacement body, re-emit each surviving line from the target range.

## 2026-10-06 — Slow-CI timeout on a heavy test that passed locally
**What happened:** CI failed on `test/usage/opencode-db.test.ts` "a session_message table past 1MB still syncs and reads back" with `Test timed out in 5000ms`. The test seeds 2500 sqlite rows and syncs them; on the `ubuntu-24.04` runner it took ~6s, over vitest's 5s default. It passed locally in ~3s.
**Root cause:** Judged the test green from a fast local machine. A workload whose runtime crosses a framework default is a flake wherever the machine is slower, not a local flake.
**Prevention rule:** For any test that does real I/O at scale (large seeds, subprocess loops), set an explicit timeout with headroom instead of relying on the framework default. `bun run verify` now stands in for CI; a local pass there is the bar, and a heavy test that needs more than a few seconds gets an explicit timeout it.

## 2026-10-07 — RTK coverage judged from a savings summary instead of the rewrite registry
**What happened:** Reported `bun` (1120 calls) and `bunx` (481 calls) as uncovered gaps because neither appeared in `rtk gain`'s top-10 list. Direct probing showed both rewrite (exit 3).
**Root cause:** Treated a savings summary as a coverage report. `rtk gain` ranks by tokens saved, so a rewritten command with small output never appears in it.
**Prevention rule:** Probe `rtk rewrite "<command>"` for coverage: exit 0/3 with stdout means covered, exit 1 means passthrough. Never infer it from `rtk gain` or `rtk session`, which scans Claude Code history only.

## 2026-10-07 — A host hook wired against an assumed payload shape
**What happened:** The OpenCode `tool.execute.after` handler read `event.output` and `activeSid`. The real payload is `{ tool, sessionID, status, result: { content } }`, and `activeSid` is reset to `undefined` when a start hook finishes. Both reads were wrong, so the handler returned early on every call and filtered nothing.
**Root cause:** Wrote the host integration from a sibling host's shape instead of reading the payload the host actually constructs. Every branch was fail-open, so nothing errored.
**Prevention rule:** Read the host's own source for a hook payload before wiring it, then add one test that fires the hook with the real shape. A fail-open handler that never matches is invisible without one.

## 2026-10-07 — Edit truncated an existing test while trying to insert before it
**What happened:** Adding two new tests to `test/installer/host-menus.test.ts`, the `oldText` spanned a whole existing test and the `newText` contained only that test's opening line. The replacement deleted the body and the closing brace, leaving a parse error at EOF. It also silently dropped an existing assertion before tsc caught the syntax break.
**Root cause:** Used a replacing primitive for an insertion. A range replacement rewrites the entire matched span, so anything intended to survive must be re-emitted in full.
**Prevention rule:** To insert before a block, keep `oldText` to the insertion point alone, or re-emit the whole original block in `newText`. After editing near an existing test, run `git diff -U0 -- <file>` and confirm the change is pure insertion before running the suite.

## 2026-10-10 — A type-import split dropped an existing type import
**What happened:** Splitting type-only names out of a value import in `extensions/shared/usage-store.ts`, the new `import type { OpencodeDbRow, OpencodeMessage }` line replaced the existing `import type { RunStatus, SessionTokens }` line instead of adding to it. `tsc` then reported `Cannot find name 'SessionTokens'` and `Cannot find name 'RunStatus'`.
**Root cause:** Wrote the replacement line from the names I was moving and forgot the names already on that line. The same edit pass also removed `RtkRelease` from a value import in `cli/install.ts` without adding the type import.
**Prevention rule:** When a name moves between import lines, read the target line first and re-emit its full existing content plus the moved names. Run `tsc --noEmit` after any import-shape change, not only at the end of the task.

## 2026-10-10 — `COUNT` with an `ELSE 0` literal counted every row
**What happened:** The omp aggregate read `COUNT(CASE WHEN duration > 0 THEN 1 ELSE 0 END)` as the throughput denominator. `COUNT(expr)` counts non-null values, so the `ELSE 0` made it count every row: the dashboard read 21.7 tokens/s where the reference read 29.3.
**Root cause:** Copied the neighbouring `SUM(CASE … ELSE 0 END)` shape onto a `COUNT`, where the zero is not a no-op but an extra counted row.
**Prevention rule:** Add `ELSE 0` only inside `SUM`. After any aggregate change, diff the metric against the reference at a matched row count before trusting the page.

## 2026-10-10 — Two edits rewrote a span they only half re-emitted
**What happened:** Two replacement edits lost content. One matched `HealthReport` plus its first field and dropped `tersio: string;`. The other removed a block of window interfaces and, matching on a nearby anchor, renamed `OmpFrustrationModel` into `OmpUsageWindowPoint` and deleted that interface's body. `tsc` caught both.
**Root cause:** Put a multi-line span in `oldText` while `newText` re-emitted only part of it. A range replacement rewrites the whole span.
**Prevention rule:** Keep `oldText` to the smallest unique span and re-emit every surviving line in `newText`. Run `tsc --noEmit` after any multi-line structural edit, not only at the end of the task.

## 2026-10-10 — Rounding stored values before deriving metrics moved the metrics
**What happened:** Rounded `used_fraction` to four decimals while reading quota snapshots, to shrink the payload. Every derived window figure drifted from the reference: fraction consumed 0.1825 against 0.182526, peak 0.1284 against 0.128413, and tokens per window off by 800,000.
**Root cause:** Rounded at the read boundary, which also rounded the inputs to sums over thousands of snapshots.
**Prevention rule:** Round only when serializing, never before arithmetic. Compare derived figures against the reference before shipping them.

## 2026-10-10 — A row field no reader filled left a whole column blank
**What happened:** Provider rows carried an empty `provider` field, because the row builder set that field only for model groups. The Providers table lost its name column, the "Most tokens:" hint read blank, and the mark tint fell back.
**Root cause:** Assumed a field was populated for every row shape instead of checking the reader that builds each shape.
**Prevention rule:** When a page reads `row.field`, confirm the reader sets it for that row shape. A screenshot of the rendered page catches what a type check cannot.

## 2026-10-10 — A page recomputed a figure the payload already carried
**What happened:** The Providers and Models tables derived throughput as total output tokens divided by average duration, which read 173,158/s where the payload's own `avgTokensPerSecond` read 64.8. A live screenshot caught it, not a test.
**Root cause:** Reached for the two fields that were in front of me instead of the one field the contract already defines for that metric.
**Prevention rule:** Before computing anything from raw fields, check whether the payload carries the finished metric. Render the page and read the numbers once before calling it done.

