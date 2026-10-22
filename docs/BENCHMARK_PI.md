# Tersio benchmark: pi

- Agent: pi 1.3.0
- Model: `magpie/workbuddy-ai/deepseek-v4.1-flash`, thinking effort high, temperature not reported by the harness
- Tersio 2.25.9, RTK 1.0.1, Ponytail 5.3.2
- Caveman release 4.0.1 and pstack pin `a968159`: the upstream bodies this run measured
- Repository and commit: `tersio` at `72b6716`. Prose, code, and command sessions ran in an empty directory. The agentic surface ran in a copy with 328 tracked files and one injected failing test.
- Runs (N), date, surface: 5 per prompt on prose and code, 5 per case on the command surface, 4 on agentic, 2026-10-20
- Sessions: one per run, a fresh session for each turn. This run predates the guide's one-session-per-case rule.
- Path: saved defaults for the token protocol, slash commands for the command surface. The two are reported separately.

Measured with `pi -p --no-session --mode json`, which reports `usage` per turn. Each run is a fresh
session with its own `TERSIO_HOME`, so a mode block is loaded at session start and never inherited
from another run. The command surface used `pi --mode rpc`, because `-p` drops an extension command
sent in the same call.

`Δ Tokens` is reply tokens only, and it counts the visible reply without the thinking tokens pi
reports beside it. `Δ Net` is the whole session, which is what the bill counts.

This run breaks three rules of the guide. The provider returned a 429 partway through the agentic
surface, so that surface has 4 runs per case and not 5. The cases were not interleaved, and the
agentic runs of one group shared one machine, so the agentic medians carry that noise. The code
prompts were reworded to `Write TypeScript code only, no files:` because the agent read the guide's
exact prompt as an instruction to write files, so the code rows do not compare with another agent's
code rows.

## Bench (`bun run bench`)

Byte counts are exact and reproduce. Timings drift with machine load, so compare the reductions and
ignore the milliseconds.

| Case | Bytes in | Bytes out | Δ% | Mean |
|---|---:|---:|---:|---:|
| `find` | 10,044 | 2,059 | 79.5% | 5.4 ms |
| `grep` | 22,432 | 20,073 | 10.5% | 5.5 ms |
| `rewrite`, 12 commands | — | — | — | 134 ms (11.2 ms per command) |

## Token protocol

### Prose

Every Caveman level and every Combo preset, against base. 15 runs per case, three prompts at five
runs each. Quality is the passing runs out of 15.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 195 | 0 | 0% | 14,625 | 0 | 9/15 |
| Control (`Answer concisely.`) | 164 | −31 | −15.9% | 14,600 | −25 | 10/15 |
| Caveman `lite` | 151 | −44 | −22.6% | 15,641 | +1,016 | 9/15 |
| Caveman `full` | 136 | −59 | −30.3% | 15,760 | +1,135 | 11/15 |
| Caveman `ultra` | 101 | −94 | −48.2% | 15,169 | +544 | 6/15 |
| Caveman `megacave-lite` | 244 | +49 | +25.1% | 15,471 | +846 | 0/15 |
| Caveman `megacave-full` | 247 | +52 | +26.7% | 15,439 | +814 | 0/15 |
| Caveman `megacave-ultra` | 213 | +18 | +9.2% | 15,379 | +754 | 1/15 |
| Combo `lite` | 268 | +73 | +37.4% | 20,378 | +5,753 | 3/15 |
| Combo `balanced` | 230 | +35 | +17.9% | 20,460 | +5,835 | 7/15 |
| Combo `max` | 96 | −99 | −50.8% | 19,785 | +5,160 | 8/15 |

No prose case publishes a saving. Every mode's Δ Net is positive, so the block costs more than the
reply it shortens on a one-turn question.

The level order is not monotonic, and `ultra` is the tightest here: 48.2% fewer reply tokens, and
the smallest block of the six Caveman levels at 639 tokens against 1,060 for `lite`. The three
`megacave` levels answer in classical Chinese, so their replies come out longer than base, from
9.2% to 26.7%, and the guide's English keyword gate cannot score a Chinese reply. They are the only
levels that lose on both axes.

Quality moves against the reply saving. `full` passes 11/15 where base passes 9/15, because a
shorter answer lands on three sentences more often. `combo-lite` grows replies 37.4% and passes
3/15.

The Control row is the reference that keeps the Caveman result honest: a plain `Answer concisely.`
cuts 15.9% without Tersio at all, and passes 10/15. Caveman `ultra` cuts 48.2%, so the gain is not
just the instruction.

### Code

Every Ponytail level, against base. 15 runs per case. Quality is a strict type check, a fixed
behavioral test per prompt, and every requested function present.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 772 | 0 | 0% | 15,246 | 0 | 15/15 |
| Ponytail `lite` | 649 | −123 | −15.9% | 15,781 | +535 | 15/15 |
| Ponytail `full` | 858 | +86 | +11.1% | 15,991 | +745 | 14/15 |
| Ponytail `ultra` | 654 | −118 | −15.3% | 15,801 | +555 | 15/15 |

`lite` and `ultra` save 15.9% and 15.3% of reply tokens with quality equal to base. `full` grows
the reply 11.1%, which is the reverse of the order the levels suggest.

Δ Net stays positive by 535 to 745 tokens, so no code case publishes a saving either. The block is
paid once and the reply saving is smaller than it. A session that writes more than one file
amortizes the same block, and that is where Ponytail should pay off.

One `full` run failed the quality gate. Its `chunkLazy` self-check builds
`[...chunkLazy(infinite(), 3)]`, so the reply hangs when it runs. The requested functions and the
type check both passed.

Ponytail reaches pi through `PONYTAIL_DEFAULT_MODE`, because pi's own ponytail package owns the
`/ponytail` command and the injector, and Tersio defers to it. Both paths add the same block.

### Agentic

The fixture is a copy of this repo with 328 tracked files, a green suite of 509 tests, and one
injected bug: `invoiceTotal` in `extensions/shared/invoice.ts` summed `line.price` and ignored
`line.qty`. The test asserting 35 was correct. The task was to run the suite, fix the failure, and
stop when it passes.

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 1,373 | 206,228 | 0 | 0% | 427 s | 4/4 |
| RTK `on` | 1,963 | 345,130 | +138,902 | +67.4% | 442 s | 4/4 |
| pstack `on` | 1,902 | n/a | n/a | n/a | 292 s | 4/4 |
| Combo `lite` | 9,020 | 909,858 | +703,630 | +341.2% | 593 s | 4/4 |
| Combo `balanced` | 14,692 | 1,381,782 | +1,175,553 | +570.0% | 799 s | 4/4 |
| Combo `max` | 2,503 | 343,458 | +137,229 | +66.5% | 308 s | 4/4 |

pstack is scored on quality and review rounds only, so its session columns stay empty. Its measured
totals are 289,281 tokens and a 292 s median wall time.

Every run of every case fixed the bug in the source and left every test file alone. The gate that
did not hold is the pass rate in the sense the guide means it: a wrong turn turns a green suite into
a failure.

Base ranges from 130,269 to 2,466,623 tokens across its four runs. That spread is 19× and it is
larger than every effect in the table, so no agentic saving is published. The wander is always the
same: the agent opens `extensions/shared/usage-store.ts` and `extensions/shared/snapshots.ts`, edits
them, and re-runs the full suite several times. A run that fixes the bug in two turns costs about
130k tokens. A run that wanders costs 2.4M. Every case shows at least one such run, base included.

RTK is the one row with a mechanism worth naming. Its condensed suite output is the same facts in
fewer bytes, and the bench confirms the byte ratio exactly. Here it did not lower the median session
because one run still wandered to 2.76M tokens.

## Command surface

Each row is one session: the command is issued first, then prompt P1. The reply is P1's answer, so
the numbers show what the command cost. The base row is the same prompt with no command at all.
Five runs per row.

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | 299 | 0 | 0% | 14,759 | 0 | 1/5 |
| `/caveman` | `lite` | slash | 249 | −50 | −16.7% | 15,769 | +1,010 | 1/5 |
| `/caveman` | `full` | slash | 121 | −178 | −59.5% | 15,775 | +1,016 | 3/5 |
| `/caveman` | `ultra` | slash | 138 | −161 | −53.8% | 15,237 | +478 | 0/5 |
| `/caveman` | `megacave-lite` | slash | 246 | −53 | −17.7% | 15,503 | +744 | 0/5 |
| `/caveman` | `megacave-full` | slash | 293 | −6 | −2.0% | 15,515 | +756 | 0/5 |
| `/caveman` | `megacave-ultra` | slash | 259 | −40 | −13.4% | 15,455 | +696 | 0/5 |
| `/ponytail` | `lite` | slash | 232 | −67 | −22.4% | 15,365 | +606 | 0/5 |
| `/ponytail` | `full` | slash | 234 | −65 | −21.7% | 15,354 | +595 | 0/5 |
| `/ponytail` | `ultra` | slash | 358 | +59 | +19.7% | 15,492 | +733 | 0/5 |
| `/pstack` | `on` | slash | 289 | −10 | −3.3% | 18,245 | +3,486 | 0/5 |
| `/combo` | `lite` | slash | 339 | +40 | +13.4% | 19,805 | +5,046 | 4/5 |
| `/combo` | `balanced` | slash | 138 | −161 | −53.8% | 19,738 | +4,979 | 1/5 |
| `/combo` | `max` | slash | 259 | −40 | −13.4% | 19,304 | +4,545 | 1/5 |

Every command costs more per session than base. The cost tracks the body size, not the turn count:
`/caveman ultra` is 2,573 characters and costs 478 tokens, `/pstack` is 15,459 and costs 3,486, and
the `/combo` presets inject four blocks each and cost 4,545 to 5,046.

The reply column and the quality column disagree on the same rows. `/caveman full` cuts replies
59.5% and passes 3/5 where base passes 1/5, which is the best command result in the table.
`/ponytail ultra` grows replies 19.7% and passes 0/5, the worst.

No command publishes a saving, because every Δ Net is positive.

## What the numbers say

- Every mode shortens its own target: Caveman cuts prose replies, Ponytail cuts code replies on two
  of three levels, and RTK cuts command bytes by 10.5% and 79.5%.
- No mode pays for itself on a one-turn question. Every Δ Net on prose, code, and the command
  surface is positive, from +478 to +5,835.
- A one-turn session is the worst case for every mode. The block is paid once and the reply it
  shortens is small.
- The level is not a dial toward more saving. `ultra` beats `lite` on prose, `lite` beats `full` on
  code, and the `megacave` levels save least.
- The largest lever on the agentic surface is not a mode. It is whether the agent wanders into a
  file it was not asked to touch, which costs 2.4M tokens instead of 130k and happens in every case
  including base.
- pi caches the system prompt, so a block added at session start is paid mostly as cached input
  and the totals do not reflect a real bill.

## Gates

- Prose: no saving published for any case. Every Δ Net is positive.
- Code: no saving published for any case. Pass rate equal to base for `lite` and `ultra`. `full` is
  one run below base at 14/15, and the cause is a hang in the reply's own self-check. The prompt
  differs from the guide's, so these rows do not compare with another agent's code rows.
- Agentic: no saving published. The within-case spread of 19× is larger than every effect, and
  every case contains a wrong turn, so no row is a clean pass by the guide's rule.
- pstack: scored on quality and review rounds only. Pass rate 4/4 and one wrong turn, so its green
  suite carries one failure.
- Command surface: no saving published. Every Δ Net is positive.
- Control: the plain instruction is reported as a reference, not as a mode.
- No bill-savings claim. These are token counts from one machine, one model, and one quota window.
