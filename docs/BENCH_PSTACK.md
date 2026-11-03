# Tersio benchmark: pstack

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Mode: pstack on
- Tersio and pstack pin: <versions>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <5 per case>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs

## Agentic quality

pstack is scored on quality and review rounds. The token columns stay out of this file.

| Case | Pass | Review rounds | Wrong turns | Test files edited |
|---|---:|---:|---:|---:|
| Base (`off`) | ___/5 | ___ | ___ | ___ |
| pstack `on` | ___/5 | ___ | ___ | ___ |

## Findings

- <findings>

## Gates

- The suite passes.
- No test file was edited.
- A green suite with a wrong turn is a failure.
