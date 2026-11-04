# Tersio benchmark: 🪨 Caveman

Protocol: [BENCHMARK.md](./BENCHMARK.md).

- Agent: Pi (Pi-Bolt) 1.5.0
- Model: `zcode/GLM-5.3-Flash` (GLM-5.3-Flash · ZCode), thinking effort `max`, temperature not reported by the harness. GLM reports no separate reasoning figure, so reply tokens are the full `output` figure.
- Repository and commit: `tersio` at `43c5130`
- Runs (N), date: 5 runs per prompt, 15 per case, interleaved by round, 2026-11-03
- Sessions: one process per turn, empty context
- Path: saved default, written per condition into a scratch `TERSIO_HOME`
- Mode: Caveman, all six levels
- Tersio and Caveman: Tersio 2.25.16, Caveman pin v4.0.1

**Verdict: `ultra` is the only level that both saves reply tokens (−15.1%) and raises quality (12/15); its session cost is the lowest of the six (+612). `lite` and `full` match base quality but cost more per turn than they save. All three `megacave` levels fail the prose gate, so they publish no saving.**

A probe confirmed each level's body lands in the system prompt before any measured run. Prose ran with `--no-tools`, and pi's `packages` list was emptied for the run, so the standalone Ponytail package could not leak into the base case. The base case itself misses the `reus` group on P1 and the `scan` group on P2, so per the guide those gate misses measure the gate, not the mode.

## Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | 119 | 0 | 0% | 1616 | 0 | 8/15 |
| Control (`Answer concisely.`) | 109 | -10 | -8.4% | 1613 | -3 | 7/15 |
| Caveman `lite` | 106 | -13 | -10.9% | 2660 | 1044 | 8/15 |
| Caveman `full` | 109 | -10 | -8.4% | 2798 | 1182 | 8/15 |
| Caveman `ultra` | 101 | -18 | -15.1% | 2228 | 612 | 12/15 |
| Caveman `megacave-lite` | 129 | 10 | 8.4% | 2433 | 817 | 2/15 |
| Caveman `megacave-full` | 188 | 69 | 58.0% | 2460 | 844 | 0/15 |
| Caveman `megacave-ultra` | 174 | 55 | 46.2% | 2405 | 789 | 4/15 |

## Findings

- `ultra` is the strongest case: reply tokens −15.1%, quality 12/15, the only level above base quality, and Δ Net +612 is the smallest session cost of the six levels. Verdict: a small reply saving at a modest fixed prompt cost.
- `lite` and `full` match base quality exactly (8/15) and cut reply tokens 10.9% and 8.4%, but their bodies cost more per turn than the replies save. Verdict: no session saving.
- Per-prompt comparison: `ultra` fixes P2 (5/5 against base 3/5) while holding P3 at 5/5, so its quality gain is on P2, not noise spread evenly.
- All three `megacave` levels fall below base quality (2, 0, and 4 of 15). Per the guide's rule, no saving is published for them: `megacave-full` also raises reply tokens 58%.
- The control prompt saves 8.4% on its own. Caveman `lite` and `full` beat it by only a few points on replies, so most of their raw delta is the short-answer instruction, not the mode.
- Every level's Δ Net is positive: the rule body rides in every turn's prompt. Caveman changes replies, not session cost, on a model that answers briefly already.

## Gates

- Prose: three sentences and every required keyword.
