# Tersio benchmark: OpenCode

- Agent: OpenCode 2.1.1
- Model: `magpie/auto/deepseek-v4.1-flash`, thinking level default, temperature not reported by the harness
- Tersio 2.25.9, RTK 1.0.1, Ponytail 5.3.2
- Caveman release 4.0.1 and pstack pin `a968159`: the upstream bodies this run measured
- Repository and commit: `tersio` at `72b6716`. Prose, code, and command sessions ran in an empty directory. The agentic surface ran in a copy with 328 tracked files and one injected failing test.
- Runs (N), date, surface: 15 per case on prose, 15 per case on code, 3 per case on agentic, 5 per case on the command surface, 2026-10-21
- Sessions: one per run, a fresh session for each turn. This run predates the guide's one-session-per-case rule.
- Path: saved defaults for the token protocol, slash commands for the command surface. The two are reported separately.

Measured with `opencode run`, which reports `usage` per turn. Every run was a fresh session with its own
`TERSIO_HOME` and its own empty working directory, so a mode block loaded at session start was never
inherited from another run. OpenCode takes its project directory from the `PWD` environment variable
rather than the process working directory, so the harness sets `PWD` as well.

`Δ Tokens` is reply tokens only. `Δ Net` is the whole session, which is what the bill counts.

This run deviates from the guide in three ways. The agentic surface ran 3 runs per case instead of 5,
because each run is a full suite run and the slowest base run took 17 minutes. The command surface
ran as a driven TUI session, because OpenCode does not resolve slash commands in `opencode run`, and
that session sends the mode header as a user turn, so its Δ Net is larger than the block alone. And
one base run failed the full suite for a reason unrelated to the injected bug, a port contention
timeout in `doctor.test.ts`; the injected test passed in that run.

## Bench (`bun run bench`)

Byte counts are exact and reproduce. Timings drift with machine load, so compare the reductions and
ignore the milliseconds.

| Case | Bytes in | Bytes out | Δ% | Mean |
|---|---:|---:|---:|---:|
| `find` | 10,044 | 2,059 | 79.5% | 5.9 ms |
| `grep` | 22,432 | 20,073 | 10.5% | 6.2 ms |
| `rewrite`, 12 commands | — | — | — | 142 ms (11.9 ms per command) |

## Token protocol

### Prose

Every Caveman level and every Combo preset, against base. 15 runs per case, three prompts at five
runs each. Quality is the passing runs out of 15.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 420 | 0 | 0% | 8,858 | 0 | 8/15 |
| Control (`Answer concisely.`) | 340 | −80 | −19.0% | 8,786 | −72 | 7/15 |
| Caveman `lite` | 249 | −171 | −40.7% | 9,748 | +890 | 10/15 |
| Caveman `full` | 192 | −228 | −54.3% | 9,821 | +963 | 12/15 |
| Caveman `ultra` | 195 | −225 | −53.6% | 9,273 | +415 | 6/15 |
| Caveman `megacave-lite` | 401 | −19 | −4.5% | 9,640 | +782 | 0/15 |
| Caveman `megacave-full` | 411 | −9 | −2.1% | 9,612 | +754 | 0/15 |
| Caveman `megacave-ultra` | 377 | −43 | −10.2% | 9,562 | +704 | 0/15 |
| Combo `lite` | 400 | −20 | −4.8% | 14,490 | +5,632 | 4/15 |
| Combo `balanced` | 357 | −63 | −15.0% | 14,566 | +5,708 | 7/15 |
| Combo `max` | 346 | −74 | −17.6% | 14,020 | +5,162 | 3/15 |

No prose case publishes a saving. Every mode's Δ Net is positive, so the block costs more than the
reply it shortens on a one-turn question.

The level order is not monotonic. `full` cuts replies 54.3% and `ultra` cuts 53.6%, while the three
`megacave` levels cut between 2.1% and 10.2%. The `megacave` bodies are smaller than `full`, 612 to
705 tokens against 1,177, yet they save less reply and pass 0/15.

The `megacave` levels answer in classical Chinese, and that is why they fail every gate: the keyword
check is English, so 15/15, 14/15, and 15/15 runs miss a required term, and the Chinese full stop
does not split into the three sentences the gate counts. The reply stays long because the register is
more verbose than `full`, not because the model ignored the request.

The gate's binding constraint differs by case. The `caveman` levels and the control all hold three
sentences in 15 of 15 runs, so their pass rate is set by the keyword check alone: base misses a
required term in 7 of 15 runs, `full` in 3, `lite` in 5, and the control in 8. The `combo` rows lose
sentences instead, because Ponytail appends a `Skipped:` line and a `Risk:` line to the answer, so
`combo lite` holds three sentences in 7 of 15 runs and `combo max` in 4 of 15.

Quality moves against the reply saving. `full` passes 12/15 where base passes 8/15, because a
shorter answer keeps the required terms in. `ultra` cuts about as much as `full` and passes 6/15.

The Control row is the reference that keeps the Caveman result honest: a plain `Answer concisely.`
cuts 19.0% without Tersio at all, and passes 7/15 against base's 8/15. Caveman `full` cuts 54.3% and
passes 12/15, so the gain is not only the instruction.

### Code

Every Ponytail level, against base. 15 runs per case. Quality is the runs whose code type-checks
under `strict` and passes the fixed test file. The artifact is the source file the run wrote in its
own working directory, not the reply text, because the agent writes a file and answers with a
summary. The gate takes the file that exports the requested names, skips the test file the agent
wrote alongside it, and runs the fixed test file against that file.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 1,938 | 0 | 0% | 47,567 | 0 | 11/15 |
| Ponytail `lite` | 2,012 | +74 | +3.8% | 51,087 | +3,520 | 13/15 |
| Ponytail `full` | 2,523 | +585 | +30.2% | 61,902 | +14,335 | 13/15 |
| Ponytail `ultra` | 2,355 | +417 | +21.5% | 59,964 | +12,397 | 12/15 |

No code case publishes a saving. Every level grows both the reply and the whole session, so the
block costs more than the reply it returns. Quality holds: `lite` and `full` pass 13/15 against
base's 11/15, and `ultra` passes 12/15, so the pass rate is at or above base in every case. The
saving fails on tokens, not on correctness.

The Ponytail body asks for the smallest change and for a one-line mention of a smaller option, and
on this model that produces more commentary rather than less code. `full` is the worst at +30.2%
reply tokens and +14,335 session tokens. The levels share one body, so the difference between them
is the intensity line each adds.

### Agentic

The fixture is a copy of this repo with 328 tracked files, a green suite of 508 tests, and one
injected bug: `invoiceTotal` in `extensions/shared/invoice.ts` summed `line.price` and ignored
`line.qty`. The test asserting 35 was correct. The task was to run the suite, fix the failure, and
stop when it passes.

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | — | 489,977 | 0 | 0% | 532 s | 3/3 |
| RTK `on` | — | 264,901 | −225,076 | −45.9% | 199 s | 3/3 |
| pstack `on` | — | n/a | n/a | n/a | 201 s | 3/3 |
| Combo `lite` | — | 235,637 | −254,340 | −51.9% | 165 s | 3/3 |
| Combo `balanced` | — | 445,649 | −44,328 | −9.0% | 228 s | 3/3 |
| Combo `max` | — | 242,127 | −247,850 | −50.6% | 126 s | 3/3 |

The reply median was not recorded for this surface, so that column stays empty. pstack is scored on
quality, so its token columns stay empty too.

Every case fixes the bug in the source and leaves the test file alone: 0 test files edited in all 18
runs, and 3/3 passes in every case. The turn counts tell the rest. Base took a median of 21
assistant turns and 32 tool calls, RTK `on` took 14 and 13, `combo lite` 13 and 12, `combo max` 12
and 13, and pstack 12 and 16.

RTK is the largest single-mode win on this agent: 45.9% fewer session tokens and 333 seconds
faster at the same pass rate. The agentic task is mostly shell output, so condensing it removes
most of the context. `Combo lite` at 51.9% and `Combo max` at 50.6% cut more than RTK alone,
because each preset also turns pstack on, and pstack's own run shows the same pattern: 12 median
turns against base's 21.

`Combo balanced` is the weakest preset, at 9.0% below base, because its full Caveman and full
Ponytail bodies cost more context than the reply shaping returns on this task. Its runs also spread
wide, 174,368 to 694,528 tokens against base's 445,298 to 1,095,084, so the median sits inside the
base spread and the difference is not separable at this sample size.

pstack is scored on quality, and the quality holds: 3/3 passes with the median run taking 12
assistant turns against base's 21. It reaches the fix in fewer turns than base, and no run took a
wrong turn, so no pstack run is a green suite with a wrong turn.

## Command surface

Each row is one session: the command is issued first, then prompt P1. The reply is P1's answer, so
the numbers show what the command cost. The base row is the same prompt with no command at all.
Five runs per row.

OpenCode resolves slash commands in the interactive TUI only, so each row is a driven TUI session:
the command is typed, the palette completes it, the argument follows, then P1 is typed. Every row
records the mode header the plugin wrote, and a row whose header did not name the expected level
was re-run rather than measured.

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|
| (none) | — | — | 373 | 0 | 0% | 0 | 2/5 |
| `/caveman` | `lite` | slash | 128 | −245 | −65.7% | +10,082 | 2/5 |
| `/caveman` | `full` | slash | 79 | −294 | −78.8% | +10,333 | 0/5 |
| `/caveman` | `ultra` | slash | 99 | −274 | −73.5% | +9,424 | 1/5 |
| `/caveman` | `megacave-lite` | slash | 337 | −36 | −9.7% | +27,904 | 0/5 |
| `/caveman` | `megacave-full` | slash | 94 | −279 | −74.8% | +9,604 | 0/5 |
| `/caveman` | `megacave-ultra` | slash | 230 | −143 | −38.3% | +9,445 | 0/5 |
| `/ponytail` | `lite` | slash | 117 | −256 | −68.6% | +9,367 | 1/5 |
| `/ponytail` | `full` | slash | 272 | −101 | −27.1% | +9,826 | 0/5 |
| `/ponytail` | `ultra` | slash | 156 | −217 | −58.2% | +27,416 | 0/5 |
| `/pstack` | `on` | slash | 334 | −39 | −10.5% | +15,267 | 1/5 |
| `/combo` | `lite` | slash | 123 | −250 | −67.0% | +47,169 | 1/5 |
| `/combo` | `balanced` | slash | 148 | −225 | −60.3% | +19,641 | 0/5 |
| `/combo` | `max` | slash | 158 | −215 | −57.6% | +18,478 | 1/5 |

This surface recorded reply tokens and Δ Net, but not the absolute session medians the other
tables carry, so this one omits that column rather than showing a wall of dashes. Δ Net is measured
against the base row, which is the same comparison.

The command rows' reply medians range from 79 to 337 tokens, and the individual runs inside a row
reach 42 and 747, so the run-to-run spread is wider than the difference between the rows.

Every command costs more per session than base. The cost tracks the mode block plus the turn that
answers the mode header, which OpenCode sends as a user turn, so the command pays for one extra
model turn on top of the block. That is why the growth here, 9,367 to 47,169 tokens, is larger than
the block sizes the guide lists.

The reply column and the quality column disagree on the same rows. `/caveman full` cuts replies
78.8% and passes 0/5, and `/caveman lite` cuts 65.7% and passes 2/5, the same as base.

No command publishes a saving, because every Δ Net is positive.

## What the numbers say

- RTK is the clearest win: 45.9% fewer agentic session tokens, no quality change, 333 seconds
  faster. Its cost is command output, and the bench confirms the byte reduction exactly.
- pstack reaches the fix in fewer turns than base, 12 against 21, at the same pass rate and with
  no wrong turn. It is scored on quality and review rounds, so its token columns stay empty.
- Caveman saves reply tokens at every level but never the session, on a one-turn question. `full`
  and `ultra` save about half the reply; the `megacave` levels save almost nothing, answer in
  classical Chinese, and fail every quality gate.
- Ponytail does not save on this model. Every level costs more tokens, and the cost rises with
  the level. The pass rate stays at or above base, so the code is still correct.
- A one-turn session is the worst case for every mode. The block is paid once and the reply it
  shortens is small.
- A multi-turn task amortizes the same blocks. `Combo lite` saves 51.9% on the agentic surface and
  costs 5,632 tokens on prose.

## Gates

- Prose: no saving published for any case. Every Δ Net is positive.
- Code: no saving published for any case. Every Δ Net is positive. The pass rate is at or above
  base in every case, so the gate on quality is met and the saving is refused on tokens alone.
- Agentic: saving published for RTK, `Combo lite`, and `Combo max`. Pass rate 3/3 in every case, and
  no test file was edited in any run. pstack is scored on quality alone, so it publishes no token
  saving. `Combo balanced` is not published, because its median Δ Net sits inside the base run's
  spread.
- Command surface: no saving published for any command. Every Δ Net is positive.
- Control: the plain instruction is reported as a reference, not as a mode, and it passes 7/15
  against base's 8/15.
- No bill-savings claim. These are token counts from one machine, one model, and one day.
