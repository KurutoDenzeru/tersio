# Running the Tersio Benchmark

This file is a protocol, not a result. Run it on your own machine. Publish the numbers you get.

Nothing here depends on the agent host. Replace `<host>` with your host binary.

Models change, so your numbers will differ.

## 1. What you measure

Three surfaces. Never average them together.

| Surface | Counts | Does not count |
|---|---|---|
| Reply | Tokens in the answer (`usage.output`, includes reasoning) | Prompt overhead, tool results |
| Prompt overhead | Tokens a mode adds to every turn | The answer |
| Command output | Tokens in shell output | Everything else |

Two axes per run.

| Axis | Source |
|---|---|
| Tokens | `usage.totalTokens`, summed over assistant turns |
| Time | Wall-clock around the process. Median of N |

Savings are eligible-only. A percentage applies to redundant output — repeated errors, a build log that repeats one warning, an oversized dump. Clean output saves near zero, and that is the mode working, not a misconfiguration. Report the fixture each number came from, so a clean-read session is not read as a broken install.

Rules:
- A mode can cut reply text and still lose, because its prompt cost is paid on every turn.

## 2. Setup

```bash
tersio doctor            # must pass
rtk --version
<host> --version
bun --version
export BENCH_TMP="$(mktemp -d)"   # all sessions, stdout, and results go here
```

### Protect the user settings

Session-start defaults change what every run measures. Force them off. Restore them on exit.

```js
const backup = `${settingsPath}.bak`;   // ~/.tersio/settings.json
copyFileSync(settingsPath, backup);
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  copyFileSync(backup, settingsPath);
  rmSync(backup, { force: true });
};
process.on("exit", restore);   // try/finally alone fails on interrupt
```

### Fixture

Do not run tools against the live repo. Its size changes between runs. Pin a fixture repo (fixed commit) that has:
- a passing test suite,
- one copy with exactly one failing test,
- at least 200 files for the `find` cases.

Keep results out of git. Write them to `$BENCH_TMP`, or to `benchmark/results/` only if that path is already ignored.

## 3. Modes and prompts

| Mode | Command | Levels |
|---|---|---|
| Caveman | `/caveman <level>` | `lite`, `full`, `ultra`, `megacave-lite`, `megacave-full`, `megacave-ultra` |
| Ponytail | `/ponytail <level>` | `lite`, `full`, `ultra` |
| Combo | `/combo <level>` | `medium` (caveman `lite` + rtk + ponytail `lite`), `balanced` (`full`/`on`/`full`), `max` (`ultra`/`on`/`ultra`) |
| RTK | `/rtk on` | `on` |

Also run each mode on the other surface. Caveman on code and Ponytail on prose show which part of a Combo gives the saving.

Each surface has its own base and its own prompts. Use at least three prompts per surface.

| Surface | Prompts |
|---|---|
| Prose | P1: Explain in three sentences how a database connection pool improves throughput under load.<br>P2: Explain in three sentences why an index speeds up a database query.<br>P3: Explain in three sentences how HTTP caching reduces server load. |
| Code | C1: Write a TypeScript function `chunk<T>(items: T[], size: number): T[][]` that splits an array into fixed-size chunks, and `chunkLazy` that yields chunks from an iterable without materializing the whole array.<br>C2: Write a TypeScript function `debounce` and a function `throttle`, both with the signature `(fn: (...args: T) => void, ms: number)`.<br>C3: Write a TypeScript function `groupBy<T, K extends PropertyKey>(items: T[], key: (item: T) => K): Record<K, T[]>` and `countBy` with the same inputs returning `Record<K, number>`. |
| Agentic (tools on) | A: In the fixture repo, run the test suite. Fix the failing test. Stop when all tests pass. |

## 4. Run procedure

Set the mode through saved defaults, not through a `/command` prefix. Ponytail and RTK inject at session start. A command prefix can leave the recorded prompt unchanged.

```bash
run() {  # run <caveman> <ponytail> <rtk> <combo> <prompt> <out>
  tersio settings --caveman-default "$1" --ponytail-default "$2" \
                  --rtk-default "$3" --combo-default "$4"
  /usr/bin/time -f '%e' -o "$6.time" \
    <host> -p --session-dir "$BENCH_TMP/$6" --no-tools \
      --model "<model>" "$5" > "$6.out"
}
run off off off off "$P1" base-p1      # base: all four off
run ultra off off off "$P1" cav-ultra-p1
```

Check that `tersio settings --help` accepts level values. If not, adapt the flags.

Rules:
- One process per sample. Never reuse a session. Hosts append to it.
- N = 5 samples per mode per prompt. Report median, min, and max.
- Fix the model, thinking level, and temperature. Record them. Free-tier models can ignore `--thinking`.
- Run modes in an interleaved order (base, A, B, base, A, B...). This spreads provider drift across modes.
- Discard nothing. Report cold-start outliers.

### Overhead check (gate)

For each mode, compare:
- tokenizer count of the injected block (`<host> toks "<block>" --json`, encoding `o200k_base`), and
- `contextSnapshot.nonMessageTokens` minus the base run.

They must match within 5%. If they do not, the mode did not load. Fix this before you trust any number.

Where the host does not record `nonMessageTokens`, use the tokenizer count only. Say so.

## 5. Reading the numbers

Define columns once:

- `Block` = tokens the mode adds to the prompt. The base is 0.
- `Token Δ` = median reply tokens − base median (same prompt, same surface). Negative is a saving.
- `Net Δ` = `Block` + `Token Δ`. This is the first-turn effect. Negative means the mode already wins.

Use `usage.input`, `usage.output`, `usage.cacheRead`, `usage.cacheWrite`. In the sample record, `totalTokens` = `input + output + cacheRead`. So do not add `reasoning` again. Confirm this on your host.

## 6. Quality gates

A saving is valid only if the answer is still right. A mode that drops edge cases is not a saving.

**Code (C1–C3).** Save each reply's code. Then:
1. `tsc --strict --noEmit` passes.
2. A fixed test file passes. For C1: empty array, size larger than length, remainder chunk, `size <= 0` throws, and `chunkLazy` gives the same chunks as `chunk`.
3. Both requested functions exist.

**Prose (P1–P3).**
1. Exactly three sentences. Caveman fragments count as sentences only if you decide so before the run. Write the rule down.
2. A fixed keyword list per prompt is present (for P1: reuse, connection, overhead/cost, concurrency/wait).
3. For `megacave-*` modes, score by keyword meaning, not by string match.

**Agentic (A).** Pass = the suite is green and no test file was edited. Run it for base, `rtk on`, `ponytail ultra`, and `combo medium`, N = 5. Report pass rate with every token and time number. A failed run is reported. It is not dropped.

Report `Quality` (pass count out of N) beside every saving. Do not publish a saving for a mode that fails more often than base.

## 7. RTK command set

RTK saving depends on how noisy the command is. Measure all groups. Put each command in the group its output belongs to.

Run each command plain, then through RTK. N = 5, median. Record tokens and time.

**Compressible (large raw output)**

```bash
bun run test                  # rtk test bun run test
find . -name '*.test.ts'      # rtk find . -name '*.test.ts'
ls -la .                      # rtk ls -la .
git status                    # rtk git status
```

**Small (expect little or no gain)**

```bash
bun run build
find extensions -name '*.ts'
rtk deps
git diff --stat HEAD
git status --short
```

**Exact (output must be byte-identical)**

```bash
cat extensions/shared/rtk-gain.ts      # rtk read ...
grep -rn normalizeMode extensions      # rtk grep ...
git log --oneline -n 30
```

**Fidelity (new, required).** Savings on a passing suite prove little. Run these on the failing-test fixture:
1. `bun run test` plain and through RTK. The failing test name, the assertion message, and the file and line must survive. Use the runner-native filter when one exists (`rtk bun test` for bun; the generic `rtk test <cmd>` wrapper truncates to a tail and fails this check).
2. The exit code is the same in both.
3. `stderr` content is kept.
4. `tsc --noEmit` on a file with one type error. The error must survive.
5. `tsc --noEmit` on a clean file. Report any added tokens.

If a fidelity check fails, report a bug. Do not publish the saving.

**End to end.** Run the agentic task (section 6) with `rtk` off and on. Command-output savings that cause extra steps or a failed task are not savings.

### Why the transcript shows no `rtk_run`

`rtk.ts` rewrites the `command` field of `bash` calls in a `tool_call` hook. The host writes the transcript before the hook runs. The file shows `ls -la`. RTK ran `rtk ls -la`.

To prove RTK ran, look for `... (N earlier lines, ctrl+o to expand)` in the output.

## 8. Traps

- **Saved defaults.** Set all four to `off` before the base run.
- **Prompt on one surface only.** Code replies are longer than prose replies. Use a separate base per surface.
- **Combo without tools.** With `--no-tools`, the RTK part of a Combo does nothing, but its block still costs tokens. Combo results from `--no-tools` runs measure only Caveman + Ponytail. Label them so.
- **Combo sums.** Check that the Combo `Block` equals the sum of its parts. If it does not, find the extra tokens (wrapper text?) and report them.
- **Synthetic base prompt.** A 14-token base prompt hides the host's own overhead (about 13.8k tokens in the sample record). Say which base you used. Report `Block` as a share of the real `nonMessageTokens`.
- **Cache.** `Tokens` includes `cacheRead`. A cached run and an uncached run are not comparable.
- **One model.** Run the full sweep on one more model. Mode savings often differ by model.
- **Model availability.** A 403 is a provider limit, not a broken mode. Record which host and model produced which number.

## 9. Reporting

Put the summary table first. A reader who reads one screen must get the ranking.

```markdown
| Mode | Surface | Block | Token Δ | Net Δ | Quality | Tokens | Time |
|---|---|---:|---:|---:|---:|---:|---:|
| `off` (base) | prose | 0 | 0 | 0 | 5/5 | … | 0:52 |
```

Then one table per mode family, one verdict line under each. Use the same column names as above. For RTK use: `Tool call | Base | After | Δ | Δ% | Δ time | Fidelity`.

Verdict rules: name the failure cases too. Write "strongest in this sample", never "saves 63%".

End with the environment line:

```markdown
Rerun on YYYY-MM-DD using Bun X, host Y, model Z (thinking T, temperature K), Tersio A, RTK B, Ponytail C, tokenizer o200k_base, N = 5.
```

Add your run newest first. Do not overwrite old numbers. If you change the protocol, say which numbers are no longer comparable.

## 10. Done checklist

- [ ] `doctor` passed; overhead check within 5% for every mode
- [ ] Base for prose, code, and agentic
- [ ] Every mode and level in section 3, on both surfaces
- [ ] N = 5, median with min and max, three prompts per surface
- [ ] Quality score beside every saving
- [ ] RTK: three groups, fidelity checks, end-to-end run
- [ ] Token and time reported
- [ ] Environment line complete
- [ ] Working tree unchanged; `~/.tersio/settings.json` restored; sessions only in `$BENCH_TMP`
