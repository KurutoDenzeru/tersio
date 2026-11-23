# Tersio benchmark: 🧩 Combo + 🍃 Headroom + 🥔 pstack + 🕸️ CodeGraph

Protocol: [BENCHMARK.md](./BENCHMARK.md). This is the full stack: every mode Tersio ships, on.

- Agent: <name and version>
- Model: `<provider/model>`, thinking effort `<level>`, temperature not reported by the harness
- Mode or stack: Combo `lite`, `balanced`, `max`, each with Headroom `on`, pstack `on`, and CodeGraph `on`
- CodeGraph index: bundle `<version>`, sync mode `<mode>`, built from the fixture commit
- Tersio, RTK, Ponytail, Caveman: <versions>
- Caveman release <version> and pstack pin <commit>: the upstream bodies this run measured
- Repository and commit: <repo> at <commit>
- Runs (N), date: prose 5 runs per prompt (15 per case); agentic 5 per case, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Headroom: <proxy mode>, JSONL path `<path>`, upstream `<url>`

## Prose

Caveman shapes the reply and the other three cost prompt or transport overhead, so this table shows
whether the short replies still pay for the stack.

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Combo `lite` + all | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `balanced` + all | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `max` + all | ___ | ___ | ___% | ___ | ___ | ___/15 |

## Agentic

The gate is the suite: pass, and no test file edited. The CodeGraph file count rides in the note.

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| Combo `lite` + all | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `balanced` + all | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `max` + all | ___ | ___ | ___ | ___% | ___ | ___/5 |

Files opened, base: ___ · full stack: ___

## Compression

Headroom's own record, from section 9 of the protocol.

| Measure | Value |
|---|---|
| `tokens_before` | ___ |
| `tokens_after` | ___ |
| `tokens_saved` | ___ |
| Saved share | ___% |
| `transforms_applied` | ___ |
| Sentinel survived | ___ (pass or fail) |
| `request_id` | ___ |

## Verdict

<One sentence for prose and one for the agentic surface: the deltas, the pass rate, the file count,
and the one condition that decided it. Name the fixture commit and the Headroom `request_id`.>
