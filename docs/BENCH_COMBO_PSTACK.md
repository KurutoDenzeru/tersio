# Tersio benchmark: Combo + pstack

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Stack: Combo `lite`, `balanced`, and `max`, with pstack on. Headroom is off.
- Tersio, RTK, Ponytail, Caveman, and pstack pin: <versions>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <15 per prose case, 5 per agentic case>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Combo `lite` + pstack | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `balanced` + pstack | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `max` + pstack | ___ | ___ | ___% | ___ | ___ | ___/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| Combo `lite` + pstack | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `balanced` + pstack | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `max` + pstack | ___ | ___ | ___ | ___% | ___ | ___/5 |

## pstack quality

| Case | Pass | Review rounds | Wrong turns | Test files edited |
|---|---:|---:|---:|---:|
| Base (`off`) | ___/5 | ___ | ___ | ___ |
| Combo `lite` + pstack | ___/5 | ___ | ___ | ___ |
| Combo `balanced` + pstack | ___/5 | ___ | ___ | ___ |
| Combo `max` + pstack | ___/5 | ___ | ___ | ___ |

## Findings

- <findings>

## Gates

- Combo gates from [BENCH_COMBO.md](./BENCH_COMBO.md).
- pstack: the suite passes, no test file was edited, and a green suite with a wrong turn is a failure.
