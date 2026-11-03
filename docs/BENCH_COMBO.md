# Tersio benchmark: Combo

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Stack: Combo `lite`, `balanced`, and `max`. Caveman, RTK, and Ponytail only. pstack and Headroom are off.
- Tersio, RTK, Ponytail, and Caveman: <versions>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <15 per prose case, 5 per agentic and command case>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Path: <saved default or slash command>

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Control (`Answer concisely.`) | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `balanced` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `max` | ___ | ___ | ___% | ___ | ___ | ___/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| Combo `lite` | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `balanced` | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `max` | ___ | ___ | ___ | ___% | ___ | ___/5 |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | ___ | 0 | 0% | ___ | 0 | ___/5 |
| `/combo` | `lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/combo` | `balanced` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/combo` | `max` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |

## Findings

- <findings>

## Gates

- Prose: three sentences and every required keyword.
- Agentic: the suite passes and no test file was edited.
- Command surface: the same quality gate as the same prompt without the command.
