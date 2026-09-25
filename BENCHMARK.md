# Tersio Token Benchmark

Rerun on 2026-09-25 using Bun 1.4.2, OMP 18.3.1, Tersio 2.23.0, RTK 0.50.0, and Ponytail 4.10.0. Every published mode is measured against a base run with all modes off.

## Method

| Setting | Value |
|---|---|
| Base | All modes off: no Caveman, no Ponytail, no RTK guidance |
| Tokenizer | `o200k_base` via `omp toks` |
| Model | `stealth/space-bunny-alpha` |
| Model samples | 3 live samples per mode |
| RTK samples | 3 Bun-spawn runs per command |
| Token scope | Visible output only |

`Base` is the plain run. `Δ = after − base`. Negative means savings. `Net Δ` adds prompt overhead.

### Prompt base

Every run starts from the same base system prompt, then adds one mode block. Base prompt: 14 tokens.

```text
You are a helpful assistant. Answer directly. Do not use tools.
```

The `Prompt` column above is that base plus the exact mode block the extension injects. A mode block is the only variable. For example, `/combo medium` stacks three blocks:

```text
[base prompt]                      14 tokens
+ caveman lite block               +32
+ ponytail lite block           +1,246
+ rtk guidance block               +35
= combo medium prompt           1,355 tokens
```

RTK prompt (`/rtk on`) is 49 tokens, so 35 tokens over base:

```text
RTK guidance active. RTK automatically rewrites eligible Bash calls through the installed rtk hook. Prefer rtk for noisy shell output, but use exact raw output for state changes, checksums, patches, and diagnostics that need full bytes.
```

Caveman mode blocks are one instruction line plus rules. `full` is the full upstream `rule.md`, which is why it costs 1,659 tokens. `ultra` is one condensed line at 78 tokens. Combo presets concatenate Caveman, Ponytail, and RTK blocks, so their cost is the sum of the parts.

## Caveman: `off | lite | full | ultra | wenyan-lite | wenyan-full | wenyan-ultra`

Prose samples, median of 3. Base median: 124 tokens.

| Mode | Prompt | Base | After | Δ | Δ% | Net Δ |
|---|---:|---:|---:|---:|---:|---:|
| `off` (base) | 14 | 124 | 124 | 0 | 0% | 0 |
| `lite` | 46 | 124 | 158 | +34 | +27.4% | +66 |
| `full` | 1,659 | 124 | 107 | **−17** | **−13.7%** | +1,628 |
| `ultra` | 78 | 124 | 109 | **−15** | **−12.1%** | +49 |
| `wenyan-lite` | 56 | 124 | 149 | +25 | +20.2% | +67 |
| `wenyan-full` | 70 | 124 | 124 | 0 | 0% | +56 |
| `wenyan-ultra` | 61 | 124 | 141 | +17 | +13.7% | +64 |

Caveman `full` and `ultra` cut prose, but every mode still costs more than base once prompt overhead is included. `ultra` needs about 5 turns to repay. `full` needs about 97 turns.

**Result:** Caveman compresses style, not token count, in this sample. Keep it for consistency, not savings.

## Ponytail: `off | lite | full | ultra`

Code samples, median of 3. Base median: 306 tokens.

| Mode | Prompt | Base | After | Δ | Δ% | Break-even |
|---|---:|---:|---:|---:|---:|---:|
| `off` (base) | 14 | 306 | 306 | 0 | 0% | — |
| `lite` | 1,260 | 306 | 177 | **−129** | **−42.2%** | 10 tasks |
| `full` | 1,264 | 306 | 208 | **−98** | **−32.0%** | 13 tasks |
| `ultra` | 1,275 | 306 | 112 | **−194** | **−63.4%** | 7 tasks |

All three Ponytail levels cut code output. `ultra` performed best here and repaid its prompt fastest.

**Result:** Use Ponytail for sustained coding. `ultra` is the strongest code mode in this sample.

## Combo: `off | medium | balanced | max`

Code samples, median of 3. Base median: 306 tokens.

| Mode | Prompt | Base | After | Δ | Δ% | Break-even |
|---|---:|---:|---:|---:|---:|---:|
| `off` (base) | 14 | 306 | 306 | 0 | 0% | — |
| `medium` | 1,355 | 306 | 132 | **−174** | **−56.9%** | 8 tasks |
| `balanced` | 2,972 | 306 | 251 | **−55** | **−18.0%** | 54 tasks |
| `max` | 1,402 | 306 | 260 | **−46** | **−15.0%** | 31 tasks |

`medium` outperformed both heavier presets in this sample. `balanced` carries the most prompt cost for the least code saving.

**Result:** Use `medium` for code plus noisy commands. Avoid `balanced` unless you need its full upstream rules.

## RTK: `off | on`

Real Bun commands, median of 3 runs each. `off` is the plain command; `on` is the same command through RTK.

| Tool call | Base | After | Δ | Δ% | Δ time |
|---|---:|---:|---:|---:|---:|
| `rtk test bun run test` | 4,003 | 54 | **−3,949** | **−98.7%** | −35 ms |
| `rtk find . -name '*.test.ts'` | 10,908 | 248 | **−10,660** | **−97.7%** | −175 ms |
| `rtk ls -la .` | 983 | 275 | **−708** | **−72.0%** | +9 ms |
| `rtk git status` | 72 | 18 | **−54** | **−75.0%** | +15 ms |
| `rtk test bun run build` | 140 | 114 | **−26** | **−18.6%** | +153 ms |
| `rtk deps` | 99 | 82 | **−17** | **−17.2%** | +4 ms |
| `rtk find extensions -name '*.ts'` | 100 | 76 | **−24** | **−24.0%** | +7 ms |

RTK returned byte-identical output for commands it does not compress. It is not a lossy filter by default.

| Tool call | Base | After | Δ |
|---|---:|---:|---:|
| `rtk read extensions/shared/rtk-gain.ts` | 1,201 | 1,201 | 0 |
| `rtk grep -rn normalizeMode extensions` | 692 | 692 | 0 |
| `rtk git log --oneline -n 30` | 410 | 410 | 0 |
| `rtk git diff --stat HEAD` | 29 | 29 | 0 |
| `rtk git status --short` | 12 | 12 | 0 |
| `rtk tsc --noEmit` | 0 | 7 | +7 |

`rtk tsc` is the only measured case where RTK added tokens. It replaces silent success with `TypeScript: No errors found`.

**Result:** RTK compresses noisy output and leaves already-small or code-exact output alone. Highest wins come from test suites and recursive finds.

## Optimized choice

| Workload | Recommended mode | Measured result |
|---|---|---|
| Short conversation | `off` | Lowest prompt cost |
| Terse discussion | `/caveman ultra` | −12.1% prose, repays in ~5 turns |
| Sustained coding | `/ponytail ultra` | −63.4% code, repays in ~7 tasks |
| Coding plus noisy commands | `/combo medium` | −56.9% code, repays in ~8 tasks |
| Build or test run | `/rtk on` | up to −98.7% command output |

## Bottom line

Compression works where the output is large. RTK is the strongest immediate win. Ponytail and Combo halve code output and repay their prompts within 7 to 13 tasks. Caveman gives consistent terse style but no net token win in this sample.

Live health remained correct: `tersio doctor` passed 16/16 checks, and all six Caveman modes loaded.
