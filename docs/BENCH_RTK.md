# Tersio benchmark: RTK

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Mode: RTK on
- Tersio and RTK: <versions>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <bench plus 5 agentic cases>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs

## Command output

| Case | Bytes in | Bytes out | Δ% | Mean |
|---|---:|---:|---:|---:|
| `find` | ___ | ___ | ___% | ___ ms |
| `grep` | ___ | ___ | ___% | ___ ms |
| `rewrite`, 12 commands | — | — | — | ___ ms |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| RTK `on` | ___ | ___ | ___ | ___% | ___ | ___/5 |

## Findings

- <findings>

## Gates

- Command output: failing test name, assertion, file, and line survive, and the exit code matches.
- Agentic: the suite passes and no test file was edited.
