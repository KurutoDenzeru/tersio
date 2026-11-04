# Tersio benchmark: 🧩 Combo + 🍃 Headroom

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness
- Tersio, RTK, Ponytail, Caveman: Tersio 2.25.16, RTK 1.1.0, Ponytail 5.3.3, Caveman pin v4.0.1
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: prose 5 runs per prompt (15 per case), interleaved by round; agentic 1 per case (base 2), 2026-11-03
- Sessions: one process per turn, empty context; the fixture reset before each agentic run
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Stack: Combo `lite`, `balanced`, `max`, each with Headroom `on`.
- Headroom: 0.42.0, `--mode token` on the live proxy at `http://127.0.0.1:8787/`, upstream `http://127.0.0.1:3425/v1`

The earlier pass on this file was invalid: the condition files carried per-mode keys beside `comboDefault`, and per-mode keys win over the preset, so no preset was ever applied. This pass writes only `hosts.pi.comboDefault` (plus `pstackDefault`/`headroomDefault` where the stack names them), and a probe confirmed the Caveman, Ponytail, and RTK blocks land in the system prompt. GLM does not report reasoning separately, so reply tokens are the full `output` figure.

**Verdict: Headroom adds nothing to the per-turn prompt beyond its instruction, so prose Δ Net matches plain Combo. `max` + Headroom is the only prose stack at base quality or above (12/15). Agentic: `balanced` −27.6% and `max` −20.0% total tokens on single runs; compression itself measured 94.9% on the log block with the sentinel intact.**

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 119 | 0 | 0% | 1618 | 0 | 11/15 |
| Combo `lite` + Headroom | 103 | -16 | -13.4% | 3362 | 1744 | 9/15 |
| Combo `balanced` + Headroom | 110 | -9 | -7.6% | 3492 | 1874 | 9/15 |
| Combo `max` + Headroom | 120 | 1 | 0.8% | 2951 | 1333 | 12/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 697 | 70784 | 0 | 0% | 150.3s | 2/2 |
| Combo `lite` + Headroom | 821 | 78270 | 7486 | 10.6% | 254.0s | 1/1 |
| Combo `balanced` + Headroom | 376 | 51262 | -19522 | -27.6% | 138.1s | 1/1 |
| Combo `max` + Headroom | 527 | 56644 | -14140 | -20.0% | 129.4s | 1/1 |

No run edited a test file.

## Compression

| Payload | Tokens before | Tokens after | Saved | Saved % | Transforms | Sentinel |
|---|---:|---:|---:|---:|---|---|
| Log, `/v1/compress` | 7397 | 377 | 7020 | 94.9% | `router:log:0.05` | pass |
| Grep-style tool_result, proxy path | 13670 | 11282 | 2388 | 17.5% | `router:excluded:lossless_search` | pass in `request_messages` |

Request IDs `hr_1793705048_000001` and `hr_1793705186_000001`, measured once on a disposable proxy and independent of the preset. The agent's endpoint is `http://127.0.0.1:8787/v1` and the proxy upstream is `http://127.0.0.1:3425/v1`, so agent traffic reaches Headroom before the gateway.

## Findings

- Headroom adds no per-turn block beyond its instruction, so its prose Δ Net matches plain Combo within rounding.
- On prose, `max` + Headroom is the only stack at or above base quality (12/15), and its reply median is flat against base.
- On the agentic task, `balanced` and `max` cut total tokens 27.6% and 20.0%; `lite` costs 10.6% more on its single run.
- Prose turns are not the payload Headroom compresses. The compression rows come from tool output and a log block.
- The prose pass rate sits below base for `lite` and `balanced`, so no prose saving is published for them.

## Gates

- Prose: three sentences and every required keyword.
- Headroom: `tokens_saved > 0`, a non-empty `transforms_applied`, the sentinel survives, and the agent endpoint points at the proxy.
