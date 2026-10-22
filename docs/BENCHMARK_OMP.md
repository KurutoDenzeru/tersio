# Tersio benchmark: omp

- Agent: omp 18.12.1
- Model: `magpie/workbuddy-ai/deepseek-v4.1-flash`, thinking effort high, temperature not reported by the harness
- Tersio 2.25.9, RTK 1.0.1, Ponytail 5.3.2
- Caveman release 4.0.1 and pstack pin `a968159`: the upstream bodies this run measured
- Repository and commit: `tersio` at `72b6716`. Prose, code, and command sessions ran in an empty directory. The agentic surface ran in a copy with 333 tracked files and one injected failing test.
- Runs (N), date, surface: 5 per prompt on prose and code, 5 per case on the other surfaces, 2026-10-19
- Sessions: one per run, a fresh session for each turn. This run predates the guide's one-session-per-case rule.
- Path: saved defaults for the token protocol, slash commands for the command surface. The two are reported separately.

Measured with `omp -p --no-session --mode json`, which reports `usage` per turn. Each run is a fresh
session with its own `TERSIO_HOME`, so a mode block is loaded at session start and never inherited
from another run.

`Δ Tokens` is reply tokens only. `Δ Net` is the whole session, which is what the bill counts.

## Bench (`bun run bench`)

Byte counts are exact and reproduce. Timings drift with machine load: the same bench measured 6.7 ms
and 31.5 ms per `find` call across runs. Compare the reductions, ignore the milliseconds.

| Case | Bytes in | Bytes out | Δ% | Mean |
|---|---:|---:|---:|---:|
| `find` | 10,044 | 2,059 | 79.5% | 9.7 ms |
| `grep` | 22,432 | 20,073 | 10.5% | 8.2 ms |
| `rewrite`, 12 commands | — | — | — | 183 ms (15.3 ms per command) |

## Token protocol

### Prose

Every Caveman level and every Combo preset, against base. 15 runs per case, three prompts at five
runs each. Quality is the passing runs out of 15.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 361 | 0 | 0% | 8,708 | 0 | 7/15 |
| Control (`Answer concisely.`) | 238 | −123 | −34.1% | 8,590 | −118 | 0/15 |
| Caveman `lite` | 159 | −202 | −56.0% | 9,557 | +849 | 11/15 |
| Caveman `full` | 179 | −182 | −50.4% | 9,711 | +1,003 | 11/15 |
| Caveman `ultra` | 182 | −179 | −49.6% | 9,159 | +451 | 8/15 |
| Caveman `megacave-lite` | 330 | −31 | −8.6% | 9,462 | +754 | 3/15 |
| Caveman `megacave-full` | 290 | −71 | −19.7% | 9,389 | +681 | 0/15 |
| Caveman `megacave-ultra` | 255 | −106 | −29.4% | 9,326 | +618 | 2/15 |
| Combo `lite` | 309 | −52 | −14.4% | 14,310 | +5,602 | 8/15 |
| Combo `balanced` | 286 | −75 | −20.8% | 14,408 | +5,700 | 6/15 |
| Combo `max` | 241 | −120 | −33.2% | 13,822 | +5,114 | 3/15 |

No prose case publishes a saving. Every mode's Δ Net is positive, so the block costs more than the
reply it shortens on a one-turn question.

The level order is not monotonic. `lite` and `full` cut replies about half, `ultra` cuts less, and
the three `megacave` levels cut least, from 8.6% to 29.4%. The `megacave` bodies are smaller, 612 to
705 tokens against 1,177 for `full`, yet they save less reply. Their register keeps the structure
the gate rewards, so the reply stays long.

Quality moves against the reply saving. `lite` and `full` pass 11/15 where base passes 7/15, because
a shorter answer lands on three sentences more often. `megacave-full` passes 0/15 with replies
longer than base.

The Control row is the reference that keeps the Caveman result honest: a plain `Answer concisely.`
cuts 34.1% without Tersio at all, and passes 0/15. Caveman `lite` cuts 56.0% and passes 11/15, so
the gain is not just the instruction.

### Code

Every Ponytail level, against base. 15 runs per case.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 3,957 | 0 | 0% | 129,713 | 0 | 14/15 |
| Ponytail `lite` | 1,834 | −2,123 | −53.7% | 75,767 | −53,946 | 15/15 |
| Ponytail `full` | 2,187 | −1,770 | −44.7% | 100,054 | −29,659 | 14/15 |
| Ponytail `ultra` | 2,216 | −1,741 | −44.0% | 104,582 | −25,131 | 15/15 |

All three levels save, and `lite` saves most: 53,946 tokens per session against 29,659 for `full`
and 25,131 for `ultra`. The levels share one body, so the difference is the intensity line each
level adds, not the size of the rule.

### Agentic

The fixture is a copy of this repo with 333 tracked files, a green suite of 508 tests, and one
injected bug: `invoiceTotal` in `extensions/shared/invoice.ts` summed `line.price` and ignored
`line.qty`. The test asserting 35 was correct. The task was to run the suite, fix the failure, and
stop when it passes.

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 1,079 | 158,039 | 0 | 0% | 192 s | 5/5 |
| RTK `on` | 713 | 83,938 | −74,101 | −46.9% | 174 s | 5/5 |
| pstack `on` | 911 | 134,990 | −23,049 | −14.6% | 185 s | 5/5 |
| Combo `lite` | 644 | 119,278 | −38,761 | −24.5% | 172 s | 5/5 |
| Combo `balanced` | 700 | 137,842 | −20,197 | −12.8% | 188 s | 5/5 |
| Combo `max` | 612 | 109,380 | −48,659 | −30.8% | 181 s | 5/5 |

RTK is the largest single win anywhere in this file: 46.9% fewer session tokens, 18 seconds faster,
same pass rate. The agentic task is mostly shell output, so condensing it removes most of the
context.

Every run fixed the bug in the source and left the test file alone.

`Combo balanced` is the weakest preset here and the strongest on prose, which is the same
amortization effect seen from the other side: `lite` and `max` add more reply shaping and land
below it on total tokens.

## Command surface

Each row is one session: the command is issued first, then prompt P1. The reply is P1's answer, so
the numbers show what the command cost. The base row is the same prompt with no command at all.
Five runs per row.

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | 436 | 0 | 0% | 8,783 | 0 | 0/5 |
| `/caveman` | `lite` | slash | 173 | −263 | −60.3% | 9,571 | +788 | 3/5 |
| `/caveman` | `full` | slash | 227 | −209 | −47.9% | 9,759 | +976 | 1/5 |
| `/caveman` | `ultra` | slash | 222 | −214 | −49.1% | 9,199 | +416 | 0/5 |
| `/caveman` | `megacave-lite` | slash | 362 | −74 | −17.0% | 9,497 | +714 | 1/5 |
| `/caveman` | `megacave-full` | slash | 270 | −166 | −38.1% | 9,370 | +587 | 0/5 |
| `/caveman` | `megacave-ultra` | slash | 370 | −66 | −15.1% | 9,444 | +661 | 0/5 |
| `/ponytail` | `lite` | slash | 202 | −234 | −53.7% | 9,213 | +430 | 1/5 |
| `/ponytail` | `full` | slash | 465 | +29 | +6.7% | 9,463 | +680 | 0/5 |
| `/ponytail` | `ultra` | slash | 338 | −98 | −22.5% | 9,350 | +567 | 0/5 |
| `/pstack` | `on` | slash | 383 | −53 | −12.2% | 12,230 | +3,447 | 0/5 |
| `/combo` | `lite` | slash | 413 | −23 | −5.3% | 14,417 | +5,634 | 2/5 |
| `/combo` | `balanced` | slash | 348 | −88 | −20.2% | 14,473 | +5,690 | 0/5 |
| `/combo` | `max` | slash | 324 | −112 | −25.7% | 13,908 | +5,125 | 2/5 |

Every command costs more per session than base. The cost tracks the body size, not the turn count:
`/caveman lite` is 1,052 tokens and costs 788, `/caveman full` is 1,177 and costs 976, `/pstack` is
3,812 and costs 3,447, and the `/combo` presets are roughly 5,863 and cost 5,125 to 5,690.

The reply column and the quality column disagree on the same rows. `/caveman lite` cuts replies
60.3% and passes 3/5 where base passes 0/5, which is the best command result in the table.
`/ponytail full` grows replies 6.7% and passes 0/5, the worst.

No command publishes a saving, because every Δ Net is positive.

## What the numbers say

- RTK is the clearest win: 46.9% fewer agentic session tokens, no quality change, 18 seconds faster.
  Its cost is command output, and the bench confirms the byte reduction exactly.
- Ponytail saves on code at every level, and `lite` saves most.
- Caveman saves reply tokens at every level but never the session, on a one-turn question.
- A one-turn session is the worst case for every mode. The block is paid once and the reply it
  shortens is small.
- A multi-turn task amortizes the same blocks. `Combo max` saves 30.8% on the agentic surface and
  loses 5,114 tokens on prose.
- The level is not a dial toward more saving. `lite` beats `ultra` on both prose and code, and
  `megacave` levels save least.

## Gates

- Prose: no saving published for any case. Every Δ Net is positive.
- Code: saving published for `lite`, `full`, and `ultra`. Pass rate equal to or above base in every
  case.
- Agentic: saving published for RTK, pstack, and all three presets. Pass rate 5/5 in every case, and
  no test file was edited in any run.
- Command surface: no saving published for any command. Every Δ Net is positive.
- Control: the plain instruction is reported as a reference, not as a mode, and it passes 0/15.
- No bill-savings claim. These are token counts from one machine, one model, and one day.
