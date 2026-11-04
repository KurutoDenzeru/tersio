# Tersio benchmark: 🗜️ RTK

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness
- Mode: RTK on
- Tersio and RTK: Tersio 2.25.16, RTK 1.1.0
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: command output 15 timed runs per fixture, 12 rewrite commands, agentic 2 runs, 2026-11-03
- Sessions: none for command output; one process per agentic run

The command-output surface runs at the rtk binary layer and does not depend on the chat model, so its numbers reproduce across machines. The agentic surface is short of the guide's 5 runs per case: RTK `on` has 2 runs.

**Verdict: solid, reproducible savings at the rtk layer — `find` −79.5%, `grep` −10.5%, fidelity green on every run. The agentic surface shows no saving on this fixture (2 runs, straddling 58K-145K tokens); RTK pays off when the agent's commands produce dense output, and this suite's output is short.**

## Command output

| Case | Bytes in | Bytes out | Δ% | Mean |
|---|---:|---:|---:|---:|
| `find` | 10044 | 2059 | 79.5% | 5.6 ms |
| `grep` | 22432 | 20073 | 10.5% | 5.6 ms |
| `rewrite`, 12 commands | — | — | — | 10.8 ms |

`bun run bench` reported 3 of 3 tests green, with fidelity asserted inside the run. `find` prints the true file and dir counts and invents no name. `grep` keeps every match line with its `file:line`. `rewrite` answers 11 of 12 commands and returns a clean "no equivalent" for the twelfth.

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 511 | 40176 | 0 | 0% | 135.5s | 5/5 |
| RTK `on` | 1238 | 101372 | 61196 | 152.3% | 244.0s | 2/2 |

## Findings

- Command output: `find` drops 79.5%, `grep` 10.5%, with fidelity green. Verdict: solid, reproducible savings on the two paths Tersio actually filters.
- `find` saves most of its bytes because the filter folds directories; `grep` saves little because it keeps every match line, as designed.
- Agentic: no saving is visible. The RTK arm's two runs straddle 57,844 and 144,901 tokens (12 turns against base's 5-7), so its median is an outlier, not a rate. Verdict: unproven on this task; more runs are needed before any claim either way.
- RTK changes what the model sees, not what it says. A task whose suite output is already short gives the filter nothing to condense.
- The rewrite lookup costs 10.8 ms per Bash call, which is why `MIN_FILTER_BYTES` is 1200: below that, the spawn costs more than the filter saves.

## Gates

- Command output: failing test name, assertion, file, and line survive, and the exit code matches.
- Agentic: the suite passes and no test file was edited.
