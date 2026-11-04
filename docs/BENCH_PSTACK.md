# Tersio benchmark: 🥔 pstack

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness. GLM reports no separate reasoning figure, so reply tokens are the full `output` figure.
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: 5 runs per prompt, 15 per case, interleaved by round, 2026-11-03
- Sessions: one process per turn, empty context
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Mode: pstack on
- Tersio and pstack pin: Tersio 2.25.16, pstack pin c742dd6
- Fixture: `tersio` at `43c5130`, cloned to `/tmp/bench-fixture`, one failing test injected in a source file; the suite reported exactly one failure before any run
- Runs (N), date: 5 per case, 2026-11-03
- Sessions: one process per run, working tree reset with `git checkout -- .` and `git clean -fd` before each

**Verdict: pstack passes 5/5 with zero wrong turns and no test edits, the same as base. It costs +17.9% tokens and saves 4.3s of wall time on a fixture whose bug is a one-line fix, so quality cannot separate the arms here. Read it as: the rigor mode is safe and carries a small overhead on easy tasks.**

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 511 | 40176 | 0 | 0% | 135.5s | 5/5 |
| pstack `on` | 563 | 47356 | 7180 | 17.9% | 131.2s | 5/5 |

Turns: base 5-7, pstack 5-8.

## Findings

- Both arms pass 5 of 5, with no wrong turns and no test-file edits. The agentic gate holds everywhere, so quality cannot separate the arms on this fixture.
- pstack costs 17.9% more total tokens in this sample and saves 4.3 seconds of wall time. With base token spread of 33,348 to 47,299, the Δ Net cell (+7,180) sits at the edge of the base's own range. Verdict: a real prompt cost, no measured quality gain, a small wall-time gain.
- Turns overlap (base 5-7, pstack 5-8), so pstack adds no review rounds on this task.
- The fixture's bug is a one-line source fix. A task that needed design review would exercise pstack harder; this fixture can only measure overhead on an easy task.

## Gates

- The suite passes.
- No test file was edited.
- A green suite with a wrong turn is a failure.
