# Tersio benchmark: Combo + Headroom + pstack

Protocol: [BENCHMARK.md](./BENCHMARK.md) and section 9.

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Stack: Combo `lite`, `balanced`, and `max`, with Headroom and pstack on.
- Tersio, RTK, Ponytail, Caveman, Headroom, and pstack pin: <versions>
- Repository and commit: <repo> at <commit>
- Runs (N), date: <15 per prose case, 5 per agentic case>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Headroom: token mode, JSONL path, and proxy upstream

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Combo `lite` + Headroom + pstack | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `balanced` + Headroom + pstack | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `max` + Headroom + pstack | ___ | ___ | ___% | ___ | ___ | ___/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| Combo `lite` + Headroom + pstack | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `balanced` + Headroom + pstack | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `max` + Headroom + pstack | ___ | ___ | ___ | ___% | ___ | ___/5 |

## Headroom compression

| Payload | Tokens before | Tokens after | Saved | Saved % | Transforms | Sentinel |
|---|---:|---:|---:|---:|---|---|
| Log | ___ | ___ | ___ | ___% | ___ | pass/fail |
| JSON | ___ | ___ | ___ | ___% | ___ | pass/fail |

## pstack quality

| Case | Pass | Review rounds | Wrong turns | Test files edited |
|---|---:|---:|---:|---:|
| Base (`off`) | ___/5 | ___ | ___ | ___ |
| Combo `lite` + Headroom + pstack | ___/5 | ___ | ___ | ___ |
| Combo `balanced` + Headroom + pstack | ___/5 | ___ | ___ | ___ |
| Combo `max` + Headroom + pstack | ___/5 | ___ | ___ | ___ |

## Findings

- <findings>

## Gates

- Combo gates from [BENCH_COMBO.md](./BENCH_COMBO.md).
- Headroom: `tokens_saved > 0`, non-empty transforms, and the sentinel survives.
- pstack: the suite passes, no test file was edited, and a green suite with a wrong turn is a failure.
