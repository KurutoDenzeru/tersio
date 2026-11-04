# Tersio benchmark: Combo + pstack

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness
- Tersio, RTK, Ponytail, Caveman: Tersio 2.25.16, RTK 1.1.0, Ponytail 5.3.3, Caveman pin v4.0.1
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: prose 5 runs per prompt (15 per case), interleaved by round; agentic 1 per case (base 2), 2026-11-03
- Sessions: one process per turn, empty context; the fixture reset before each agentic run
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Stack: Combo `lite`, `balanced`, `max`, each with pstack `on`. pstack pin: c742dd6
- Fixture: `tersio` at `43c5130` with one failing test injected in a source file; the suite reported exactly one failure before any run

The earlier pass on this file was invalid: the condition files carried per-mode keys beside `comboDefault`, and per-mode keys win over the preset, so no preset was ever applied. This pass writes only `hosts.pi.comboDefault` (plus `pstackDefault`/`headroomDefault` where the stack names them), and a probe confirmed the Caveman, Ponytail, and RTK blocks land in the system prompt. GLM does not report reasoning separately, so reply tokens are the full `output` figure.

**Verdict: pstack's body costs 3,600 to 5,400 session tokens per prose case on top of the preset. Every preset still fixes the bug with no test edits. `lite` stays within 1.9% of base tokens on the agentic task; `balanced` spends 45.1% more on its single run.**

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 119 | 0 | 0% | 1618 | 0 | 11/15 |
| Combo `lite` + pstack | 118 | -1 | -0.8% | 6955 | 5337 | 9/15 |
| Combo `balanced` + pstack | 110 | -9 | -7.6% | 7070 | 5452 | 6/15 |
| Combo `max` + pstack | 120 | 1 | 0.8% | 6527 | 4909 | 9/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 697 | 70784 | 0 | 0% | 150.3s | 2/2 |
| Combo `lite` + pstack | 460 | 72115 | 1331 | 1.9% | 123.1s | 1/1 |
| Combo `balanced` + pstack | 676 | 102681 | 31897 | 45.1% | 157.0s | 1/1 |
| Combo `max` + pstack | 416 | 81555 | 10771 | 15.2% | 128.3s | 1/1 |

No run edited a test file.

## pstack quality

| Case | Pass | Review rounds | Wrong turns | Test files edited |
|---|---:|---:|---:|---:|
| Combo `lite` + pstack | 1/1 | not measured | 0 | 0 |
| Combo `balanced` + pstack | 1/1 | not measured | 0 | 0 |
| Combo `max` + pstack | 1/1 | not measured | 0 | 0 |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | | 0 | 0% | | 0 | /5 |
| `/combo` | `lite` | slash | | | | | | /5 |
| `/combo` | `balanced` | slash | | | | | | /5 |
| `/combo` | `max` | slash | | | | | | /5 |

## Findings

- The pstack body costs about 3,600 to 5,400 session tokens on prose, on top of the preset blocks.
- On the agentic task, `balanced` spends 45.1% more tokens than base on its single run, taking 8 turns. `lite` stays within 1.9% of base.
- Every preset fixes the failing test and leaves the test files alone.
- The prose pass rate sits below base for every preset with pstack, so no prose saving is published.
- One run per preset cannot rank them. Review rounds were not instrumented, so that column stays unmeasured rather than guessed.

## Gates

- Prose: three sentences and every required keyword.
- Agentic: the suite passes and no test file was edited.
- pstack: a green suite with a wrong turn is a failure.
