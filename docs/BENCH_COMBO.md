# Tersio benchmark: 🧩 Combo

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness
- Tersio, RTK, Ponytail, Caveman: Tersio 2.25.16, RTK 1.1.0, Ponytail 5.3.3, Caveman pin v4.0.1
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: prose 5 runs per prompt (15 per case), interleaved by round; agentic 1 per case (base 2), 2026-11-03
- Sessions: one process per turn, empty context; the fixture reset before each agentic run
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Stack: Combo `lite`, `balanced`, and `max`. Caveman, RTK, and Ponytail only. pstack and Headroom are off.

The earlier pass on this file was invalid: the condition files carried per-mode keys beside `comboDefault`, and per-mode keys win over the preset, so no preset was ever applied. This pass writes only `hosts.pi.comboDefault` (plus `pstackDefault`/`headroomDefault` where the stack names them), and a probe confirmed the Caveman, Ponytail, and RTK blocks land in the system prompt. GLM does not report reasoning separately, so reply tokens are the full `output` figure.

**Verdict: no prose saving — every preset pays its blocks on every turn (Δ Net +1,343 to +1,882). On the agentic task, `max` cut total tokens 31.5% and `lite` 27.8% by finishing in fewer turns; one run each, so a smoke test, not a rate. Prose savings are withheld for presets below base quality.**

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 119 | 0 | 0% | 1618 | 0 | 11/15 |
| Control (`Answer concisely.`) | 121 | 2 | 1.7% | 1626 | 8 | 11/15 |
| Combo `lite` | 100 | -19 | -16.0% | 3361 | 1743 | 5/15 |
| Combo `balanced` | 118 | -1 | -0.8% | 3500 | 1882 | 10/15 |
| Combo `max` | 127 | 8 | 6.7% | 2961 | 1343 | 8/15 |

## Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 697 | 70784 | 0 | 0% | 150.3s | 2/2 |
| Combo `lite` | 309 | 51099 | -19685 | -27.8% | 131.5s | 1/1 |
| Combo `balanced` | 423 | 68591 | -2193 | -3.1% | 196.4s | 1/1 |
| Combo `max` | 294 | 48474 | -22310 | -31.5% | 131.1s | 1/1 |

No run edited a test file.

## Findings

- On prose, no preset saves session tokens. Every preset pays its block on every turn, so Δ Net runs from +1,343 to +1,882.
- On the agentic task, `max` and `lite` cut total tokens by 31.5% and 27.8%, chiefly by finishing in 6 turns against the base's 8 to 9.
- The prose pass rate falls below base for `lite` (5/15), `max` (8/15), and `balanced` (10/15). By the guide's rule, no prose saving is published for a mode below base quality.
- GLM's prose often runs past three sentences at every condition, base included, so the keyword gate drives most failures.
- One agentic run per preset is a smoke test, not a rate. The base arm's 26% token spread bounds what a single run can claim.

## Gates

- Prose: three sentences and every required keyword.
- Agentic: the suite passes and no test file was edited.
