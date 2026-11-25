# Tersio benchmark: 🕸️ CodeGraph

Protocol: [BENCHMARK.md](./BENCHMARK.md), section 3 (Agentic) and section 6 (quality gates).

- Agent: <name and version>
- Model: `<provider/model>`, thinking effort `<level>`, temperature not reported by the harness
- Mode or stack: CodeGraph `on` against Base (`off`); every other mode off
- CodeGraph index: bundle `<version>`, sync mode `<live|5m|15m|1h|manual>`, built from the fixture commit
- Tersio: <version>
- Repository and commit: <repo> at <commit>
- Runs (N), date: 5 per case, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Path: saved default, written per condition into a scratch `TERSIO_HOME`

## Agentic

The map changes which files the agent opens, not what the prompt says, so its columns are session
tokens, wall time, and pass rate. Record the files the agent opened in the note under the table: that
count is the effect a reader is looking for.

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| CodeGraph `on` | ___ | ___ | ___ | ___% | ___ | ___/5 |

Files opened, base: ___ · CodeGraph: ___

## Verdict

<One sentence naming the token and wall-time delta, the pass rate, and the file count. Say whether
the saving held on every run, and name the fixture commit.>
