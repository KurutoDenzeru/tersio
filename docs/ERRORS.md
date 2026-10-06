# ERRORS.md

Recurring mistakes log. Committed to git; reviewed periodically to promote entries into permanent rules in `AGENTS.md` or linter config.

## Format

```md
## YYYY-MM-DD — <short title>
**What happened:** Describe the mistake or unexpected behavior.
**Root cause:** Why it happened.
**Prevention rule:** What to do differently next time.
```

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
