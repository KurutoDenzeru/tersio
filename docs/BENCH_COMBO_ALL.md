# Tersio benchmark: Combo + Headroom + pstack

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness
- Tersio, RTK, Ponytail, Caveman: Tersio 2.25.16, RTK 1.1.0, Ponytail 5.3.3, Caveman pin v4.0.1
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: prose 5 runs per prompt (15 per case), interleaved by round; agentic 1 per case (base 2), 2026-11-03
- Sessions: one process per turn, empty context; the fixture reset before each agentic run
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Stack: Combo `lite`, `balanced`, `max`, each with Headroom `on` and pstack `on`.
- Headroom: 0.42.0, `--mode token` on the live proxy at `http://127.0.0.1:8787/`, upstream `http://127.0.0.1:3425/v1`
- pstack pin: c742dd6
- Fixture: `tersio` at `43c5130` with one failing test injected in a source file; the suite reported exactly one failure before any run

The earlier pass on this file was invalid: the condition files carried per-mode keys beside `comboDefault`, and per-mode keys win over the preset, so no preset was ever applied. This pass writes only `hosts.pi.comboDefault` (plus `pstackDefault`/`headroomDefault` where the stack names them), and a probe confirmed the Caveman, Ponytail, and RTK blocks land in the system prompt. GLM does not report reasoning separately, so reply tokens are the full `output` figure.

**Verdict: the full stack costs 4,896 to 5,445 session tokens per prose case, and no prose saving survives. `max` + all is the only agentic arm below base (−16.6% tokens, shortest wall time, 125.2s) on one run each.**

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 119 | 0 | 0% | 1618 | 0 | 11/15 |
| Combo `lite` + all | 115 | -4 | -3.4% | 6952 | 5334 | 9/15 |
| Combo `balanced` + all | 103 | -16 | -13.4% | 7063 | 5445 | 8/15 |
| Combo `max` + all | 104 | -15 | -12.6% | 6514 | 4896 | 10/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 697 | 70784 | 0 | 0% | 150.3s | 2/2 |
| Combo `lite` + all | 428 | 85151 | 14367 | 20.3% | 136.4s | 1/1 |
| Combo `balanced` + all | 697 | 74823 | 4039 | 5.7% | 153.2s | 1/1 |
| Combo `max` + all | 526 | 59043 | -11741 | -16.6% | 125.2s | 1/1 |

No run edited a test file.

## Compression

| Payload | Tokens before | Tokens after | Saved | Saved % | Transforms | Sentinel |
|---|---:|---:|---:|---:|---|---|
| Log, `/v1/compress` | 7397 | 377 | 7020 | 94.9% | `router:log:0.05` | pass |
| Grep-style tool_result, proxy path | 13670 | 11282 | 2388 | 17.5% | `router:excluded:lossless_search` | pass in `request_messages` |

## pstack quality

| Case | Pass | Review rounds | Wrong turns | Test files edited |
|---|---:|---:|---:|---:|
| Combo `lite` + all | 1/1 | not measured | 0 | 0 |
| Combo `balanced` + all | 1/1 | not measured | 0 | 0 |
| Combo `max` + all | 1/1 | not measured | 0 | 0 |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | | 0 | 0% | | 0 | /5 |
| `/combo` | `lite` | slash | | | | | | /5 |
| `/combo` | `balanced` | slash | | | | | | /5 |
| `/combo` | `max` | slash | | | | | | /5 |

## Findings

- The full stack costs 4,896 to 5,445 session tokens per prose case over base. No prose saving survives the Δ Net column.
- On prose, `max` + all comes closest to base quality at 10/15, still below the guide's publish rule against base 11/15.
- On the agentic task, `max` + all is the only arm below base, at 16.6% fewer tokens and the shortest wall time, 125.2s.
- Every agentic run passes and leaves the test files alone.
- Compression is unchanged by the stack: the same proxy evidence as [BENCH_COMBO_HEADROOM.md](./BENCH_COMBO_HEADROOM.md).
- One run per preset cannot rank them, and review rounds were not instrumented.

## Gates

- Prose: three sentences and every required keyword.
- Agentic: the suite passes and no test file was edited.
- Headroom: `tokens_saved > 0`, a non-empty `transforms_applied`, the sentinel survives, and the agent endpoint points at the proxy.
- pstack: a green suite with a wrong turn is a failure.
