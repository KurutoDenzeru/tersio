# Tersio benchmark: Ponytail

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness. GLM reports no separate reasoning figure, so reply tokens are the full `output` figure.
- Mode: Ponytail, all three levels
- Tersio and Ponytail: Tersio 2.25.16, Ponytail 5.3.3
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: 5 runs per prompt, 15 per case, interleaved by round, 2026-11-03
- Sessions: one process per turn, fresh empty working directory per run
- Path: saved default, written per condition into a scratch `TERSIO_HOME`

**Verdict: token-neutral and size-neutral on this model and these prompts. Ponytail's goal is not shorter replies; it is YAGNI-first code — deletion over addition, stdlib over new deps, no scaffolding nobody asked for. Reply-token deltas are the wrong ruler for that claim, and the numbers below say only that the mode costs nothing here.**

Ponytail upstream frames its own gain as smaller code and fewer tokens downstream of it (5.3 release: -53% code, -45% tokens in its Claude Code benchmark). Measuring that needs tasks with an over-engineerable surface. The three fixed prompts each ask for one small function, so the minimal solution is also the only solution, and every arm has nothing to delete.

Code ran with tools enabled and a fresh empty directory per run: a reused directory made the agent answer "already implemented" instead of writing code. The gate requires the requested names and a clean `tsc --strict` over the reply's code plus every TypeScript file the run wrote.

## Code

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 320 | 0 | 0% | 6531 | 0 | 13/15 |
| Ponytail `lite` | 386 | 66 | 20.6% | 6461 | -70 | 13/15 |
| Ponytail `full` | 356 | 36 | 11.2% | 6719 | 188 | 12/15 |
| Ponytail `ultra` | 411 | 91 | 28.4% | 6833 | 302 | 12/15 |

Code size, from the same runs:

| Case | Code bytes (median) | Code lines (median) |
|---|---:|---:|
| Base (`off`) | 658 | 24.0 |
| Ponytail `lite` | 754 | 26.0 |
| Ponytail `full` | 731 | 24.0 |
| Ponytail `ultra` | 752 | 28.0 |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | | 0 | 0% | | 0 | /5 |
| `/ponytail` | `lite` | slash | | | | | | /5 |
| `/ponytail` | `full` | slash | | | | | | /5 |
| `/ponytail` | `ultra` | slash | | | | | | /5 |

The command surface was not run.

## Findings

- Token verdict: neutral. Δ Net spans −70 to +302, inside this sample's noise, and quality holds at base (13/15) or one sample below (12/15).
- Size verdict: neutral on these prompts. Median code bytes 658 (base) against 731-754 with the mode. The prompts are too small to over-engineer, so there was nothing for YAGNI to delete.
- The earlier DeepSeek pass measured −25% replies. That result belongs to a different model and task set and is not comparable.
- What this surface cannot measure: whether Ponytail reduces over-engineering on a real task. That needs fixtures with room to over-build — services, abstractions, speculative options — and a scoring rule for unnecessary scaffolding. The guide's reply-token table stays, but it is not the claim Ponytail makes.
- Cost verdict: the mode is free on this model. That is the actionable result: turning Ponytail on costs nothing here, and its benefit, where a task has room for it, is code quality rather than tokens.

## Gates

- Code: strict type check, requested names present, and every run's code compiles.
- Command surface: the same quality gate as the same prompt without the command.
