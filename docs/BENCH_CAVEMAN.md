# Tersio benchmark: Caveman

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Mode: Caveman, all six levels
- Tersio and Caveman: <versions>
- Caveman release: <version>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <15 per case on prose, 5 per case on commands>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Path: <saved default or slash command>

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Control (`Answer concisely.`) | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `full` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `ultra` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `megacave-lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `megacave-full` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `megacave-ultra` | ___ | ___ | ___% | ___ | ___ | ___/15 |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | ___ | 0 | 0% | ___ | 0 | ___/5 |
| `/caveman` | `lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `full` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `ultra` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `megacave-lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `megacave-full` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `megacave-ultra` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |

## Findings

- <findings>

## Gates

- Prose: three sentences and every required keyword.
- Command surface: the same quality gate as the same prompt without the command.
