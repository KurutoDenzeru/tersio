# Tersio Token Benchmark

Measured before/after token costs for `caveman`, `rtk`, `ponytail`, and `combo` presets, plus runtime/memory deltas against the pre-refactor v2.9.0 tag. Full rerun 2026-09-13.

## Method

- **Tokenizer.** All counts use `o200k_base` (js-tiktoken) — real BPE tokens, not chars÷4 estimates. Measured 2026-09-13, Node v26.8.1.
- **Overhead (measured).** Exact prompt text each mode injects, extracted programmatically from the extension sources in this repo (`INSTRUCTIONS`, `RTK_PROMPT`, bundled `rule.md`, combo fallback, reinforcement line) — plus the installed Ponytail plugin's real instructions (v4.9.0).
- **Reply and code savings (measured samples).** 3 reply questions × 4 registers and 2 code tasks, each written twice: plain and ruleset-compressed. Samples are re-authored to each ruleset for every rerun and disclosed as such — your model's compliance varies (see Caveats).
- **RTK (measured).** Real command runs in this repo, raw output vs `rtk` output, same command, same working tree.
- **Runtime/memory (measured).** Same machine (darwin 25.6.0, arm64), both builds freshly compiled via `tsc`; wall time = median of 5 runs, peak RSS = median of 3 via `/usr/bin/time -l`.

## 1. Current prompt payload

Current upstream-equivalent prompts are larger than the old terse activation banner. Measured with `omp toks --json` on 2026-09-25:

| Injected text | o200k tokens |
|---|---:|
| Caveman full (`rule.md`) | ≈1,650 |
| Ponytail full, installed v4.10.0 | 1,264 |
| RTK session guidance | ≈40 |
| retired mode reinforcement | 0 |

The retired reinforcement duplicated the Caveman, RTK, and Ponytail directives. Removing it saves the prior 67-token block each turn. Caveman's larger prompt buys current upstream rules and removes stale mode behavior. Keep Combo off by default for short sessions.

## 2. Before/after: Caveman replies

Same question answered plain vs ruleset-compressed. Fresh samples, 3 questions, tokens per reply.

| Register | s1 (explain `set -euo pipefail`) | s2 (flaky CI tests) | s3 (undefined `.map` in React) | Mean | Overhead | Pays off after |
|---|---:|---:|---:|---:|---:|---|
| plain | 162 | 178 | 173 | 171 | — | — |
| `/caveman lite` | 69 | 90 | 65 | 75 | 46 | 1 reply |
| `/caveman full` | 49 | 63 | 46 | 53 | 172 | 2 replies |
| `/caveman ultra` | 25 | 36 | 24 | 28 | 68 | 1 reply |

Mean saving vs plain: **lite −56.1% (0.44×) · full −69.0% (0.31×) · ultra −83.6% (0.16×)**. Median (p50) vs plain 173: lite 69 (−60.1%) · full 49 (−71.7%) · ultra 25 (−85.5%).

Pays-off math, `⌈overhead ÷ mean saving⌉`: lite `⌈46 ÷ 96⌉ = 1 reply` · full `⌈172 ÷ 118⌉ = 2 replies` · ultra `⌈68 ÷ 143⌉ = 1 reply`.

## 3. Before/after: Ponytail code tasks

Same task implemented bloated vs ponytail at each level. Fresh samples, tokens per diff. Overhead per level in §1 (floor = bundled fallback, installed = real plugin).

| Register | retry logic (tok) | request timeout (tok) | Mean | Overhead | Pays off after |
|---|---:|---:|---:|---:|---|
| bloated baseline | 462 | 326 | 394 | — | — |
| `/ponytail lite` | 121 | 57 | 89 | 54 floor · 1,260 installed | 1 task (floor) · 5 (installed) |
| `/ponytail full` | 88 | 55 | 71.5 | 60 floor · 1,264 installed | 1 task (floor) · 4 (installed) |
| `/ponytail ultra` | 88 | 40 | 64 | 60 floor · 1,275 installed | 1 task (floor) · 4 (installed) |

Mean saving vs bloated 394: **lite −77.4% (0.23×) · full −81.9% (0.18×) · ultra −83.8% (0.16×)**. Ultra's edge narrows here because its output includes the requirement challenge — on `timeout` it beat full (−87.7% vs −83.1%); on `retry` it spends prose arguing the retry loop should not exist yet.

Pays-off math, `⌈overhead ÷ mean saving⌉`: floor repays inside the first task at every level (54–60 vs 305–330 saved). Installed plugin: lite `⌈1260 ÷ 305⌉ = 5` tasks · full `⌈1264 ÷ 322.5⌉ = 4` · ultra `⌈1275 ÷ 330⌉ = 4` — fine for sustained sessions, negative on one-shot asks.

## 4. Before/after: RTK shell output

Real runs in this repo (dirty working tree, 129-test suite); tokens per command output.

| Command | Raw | Via RTK | Saving |
|---|---:|---:|---:|
| `git status` | 182 | 72 | −60.4% |
| `grep -rn dryRun cli/install.ts` | 376 | 274 | −27.1% |
| `find test -name '*.test.ts'` | 205 | 168 | −18.0% |
| `ls extensions` | 27 | 27 | 0% |
| `git diff HEAD~1` | 12,684 | 8,504 | −33.0% |
| `npm test` (direct CLI passthrough) | 2,597 | 2,577 | −0.8% |

Reading: RTK pays on status, grep, find, and large diffs; keeps failing output exact by design (you diagnose from failures). In hook-wrapped sessions the test suite is summarized instead of passed through: rtk's history.db records `rtk test npm test` at **−97.5% average savings across 4 runs** — the passthrough row above is the conservative direct-CLI number.

As of 2026-09-13 the tersio installer wires rtk into OMP automatically (`rtk init -g --agent omp`, tool_call rewrite extension at `~/.omp/agent/extensions/rtk.ts`), so OMP bash commands rewrite to rtk and meter into `history.db` without manual prefixing.

## 5. Combined session economics

Older mixed-surface sample (one reply + one grep + one code task):

| | Before | After |
|---|---:|---:|
| reply text + command output + code diff | 941 tok | 399 tok |
| sampled-surface reduction | | **−57.6%** |

This sample is not a provider-bill benchmark. It omits system prompts, provider overhead, cache reads, reasoning tokens, retries, and long-session context. Use current session telemetry for bill economics.

## 6. Runtime + memory delta (v2.9.0 tag vs current main)

Same machine, both builds fresh via `tsc`. v2.9.0 is the last tag before the concurrency refactor landed on main.

| Case | v2.9.0 | main | Δ |
|---|---:|---:|---:|
| `install --dry-run --yes` (median wall of 5) | 0.751 s | 0.645 s | **−14.1%** |
| `--doctor` (median wall of 5) | 3.197 s | 0.452 s | **−85.9%**¹ |
| install dry-run peak RSS (median of 3) | 139.8 MiB | 140.5 MiB | +0.5% (within noise) |
| `--doctor` peak RSS (median of 3) | 140.0 MiB | 140.5 MiB | +0.4% (within noise) |
| Source TS LOC | 3,861 | 4,589 | +728² |

¹ The doctor win combines the refactor's batched probes and the update-check cache added after v2.9.0.
² LOC grew because dashboard/CLI features landed since v2.9.0; the refactor-era deletion (−101 LOC) is retained on main.

Wall-time wins come from concurrent companion reads in `copySources`, batched doctor probes, and single shared caveman rule fetch. Memory is flat: Node's ~140 MiB baseline dominates.

## 7. Verify on your workload

1. Run the same task list twice (modes off, then target preset) in fresh OMP sessions.
2. Record per-session input/output tokens from the provider usage panel.
3. Net saving = (off − on) − preset overhead from §1.
4. With the OMP wiring installed, check metered reality afterwards: `rtk gain` and the gain dashboard's Command tools table.

## 8. Caveats

- Reply/code samples are authored to each ruleset, not live model sessions — treat percentages as what the ruleset asks for, not a compliance guarantee. Ultra/wenyan can harm clarity; re-prompt on confusion.
- RTK keeps failing-test output exact by design in direct CLI use; savings concentrate on listings, grep, large diffs, and (hook-wired) passing suites. The OMP rewrite extension rewrites bash tool calls only — native tool calls (`read`/`edit`/`eval`) stay unmetered by design of rtk's hook surface.
- Ponytail upstream instruction size is external and grew 76 → 1,264 tokens between reruns; re-measure after plugin updates. Wenyan not sampled (CJK tokenization is a separate study).
- Metered rtk figures come from `history.db` (rtk-owned, never touched by tersio).

## 9. Native tool-result compression trial (2026-09-25)

OMP `snapcompact.toolResults` was tested with temporary config overlays. The durable user config was not changed. One-turn `read` and `grep` trials completed with `toolResults: false` and `true`; both kept the tool result readable and the model returned the required response. The fixture was too small to measure billing savings. Result: no default change. Revisit only with a long, vision-capable workload that exceeds Snapcompact's per-result thresholds.

Prompt payload after fidelity fixes: Caveman full `rule.md` is 1,650 o200k tokens, installed Ponytail full is 1,264, and the retired reinforcement block is removed. Upstream-equivalent prose now costs more than the old terse activation banner, but removes stale or ambiguous behavior.
