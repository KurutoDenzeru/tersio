# Tersio benchmark: Ponytail

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Mode: Ponytail, all three levels
- Tersio and Ponytail: <versions>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <15 per case on code, 5 per case on commands>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Path: <saved default or slash command>

## Code

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Ponytail `lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Ponytail `full` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Ponytail `ultra` | ___ | ___ | ___% | ___ | ___ | ___/15 |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | ___ | 0 | 0% | ___ | 0 | ___/5 |
| `/ponytail` | `lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/ponytail` | `full` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/ponytail` | `ultra` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |

## Findings

- <findings>

## Gates

- Code: strict type check, fixed behavioral test, and every requested function.
- Command surface: the same quality gate as the same prompt without the command.
