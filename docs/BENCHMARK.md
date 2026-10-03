# Tersio Benchmark Guide

**Document type:** Reference procedure for AI agents
**Applies to:** `@krtclcdy/tersio` (Caveman, RTK, Ponytail, `/combo` presets)
**Agent scope:** Agent neutral. Any agent that runs Tersio can run this guide.
**Model scope:** Model neutral. Any model can run this guide. Record the model that you use.
**Status:** Draft v1.1

---

## 1. Purpose

This guide tells an AI agent how to measure the effect of Tersio on token use.

Use this guide to:

- Measure tokens **before** and **after** each Tersio mode is turned on.
- Produce results that another person or agent can repeat.
- Report results in one fixed format.

This guide does **not** measure provider billing. It measures token counts on three separate surfaces. Do not add the surfaces together. See Section 12.

---

## 2. Rules for the Agent

Read these rules before you start. They are mandatory.

1. **Measure. Do not guess.** Report only numbers that you measured. Mark every estimate as `estimated`.
2. **Do not change the fixtures.** Use the prompts and commands in Appendix A exactly as written. If you must change one, record the change.
3. **Always measure a before.** Every result needs a **before** run with all modes off. Use the same model, prompt, and settings for the **after** run.
4. **Use a fresh session for each run.** Do not carry context from one run to the next.
5. **Confirm mode state before each run.** Run `/tersio status`. Do not start until the output matches the intended mode.
6. **Do not run `tersio reset`** unless the user approves. It clears the usage ledger. Use timestamps to isolate your runs instead (see Section 6.3).
7. **Use a scratch copy** of the fixture repository. Do not run benchmark commands in the user's working repository.
8. **Report failures.** If a step fails or you skip it, write `not run` and give the reason. Do not fill the cell with a guess.
9. **Do not compare models as equal.** Caveman and Ponytail compliance changes from model to model. Report one table per model.
10. **Do not claim bill savings.** Say "reply text", "code output", or "command output". Never say "total savings" unless Section 11 supports it.

---

## 3. Definitions

| Term | Meaning |
| --- | --- |
| **Before** | A run with `/combo off`, which sets Caveman, RTK, and Ponytail to off. |
| **After** | A run with one mode or preset turned on. |
| **Surface** | The part of the output that you count: reply text, code reply, or command output. |
| **Sample** | One complete run of one fixture, in one fresh session. |
| **p50** | The median of the samples for one cell. |
| **Δ%** | `(after − before) / before × 100`. A negative value means a reduction. |
| **Prompt overhead** | The extra input tokens that a mode adds to the prompt. |
| **Break-even** | The number of tasks after which total savings are larger than prompt overhead. |
| **Compliance** | How well the model follows the active mode rules. |

---

## 4. Test Matrix

Run every row that applies. Run the **required** rows first.

### 4.1 Modes and levels

| Mode | Command | Levels | Required |
| --- | --- | --- | --- |
| Before | `/combo off` | — | Yes |
| Caveman | `/caveman <level>` | `lite`, `full`, `ultra` | Yes |
| Caveman (Wenyan) | `/caveman <level>` | `wenyan-lite`, `wenyan-full`, `wenyan-ultra` | No |
| Ponytail | `/ponytail <level>` | `lite`, `full`, `ultra` | Yes |
| RTK | `/rtk on` | `on` | Yes |
| Combo | `/combo <preset>` | `medium`, `balanced`, `max` | Yes |

### 4.2 Combo preset map

| Preset | Caveman | RTK | Ponytail |
| --- | --- | --- | --- |
| `medium` | `lite` | `on` | `lite` |
| `balanced` | `full` | `on` | `full` |
| `max` | `ultra` | `on` | `ultra` |

If you change one mode after you set a preset, the preset becomes `custom`. Do not change single modes inside a combo run.

### 4.3 Suites

| Suite | Surface | Applies to | Fixtures |
| --- | --- | --- | --- |
| **R** | Reply text | Caveman | Appendix A.1 |
| **C** | Code reply | Ponytail, Combo | Appendix A.2 |
| **S** | Command output | RTK | Appendix A.3 |
| **O** | Prompt overhead | All modes | Section 10 |
| **Q** | Quality gate | All modes | Section 9 |

---

## 5. Prerequisites

### 5.1 Environment

| Item | Requirement |
| --- | --- |
| Agent | Any agent that supports Tersio |
| Runtime | Node.js 20.12 or newer, with npm |
| Tersio | Installed and healthy. `tersio version` returns a version. |
| RTK | Installed. `rtk --version` returns a version. |
| Tokenizer | `o200k_base` (see Appendix B) |
| Fixture repo | A scratch copy at a fixed commit |

If you use Windows with WSL, run all commands in the same environment where the agent runs.

### 5.2 Preflight checklist

Complete every step. Stop if one step fails.

1. Run `tersio version`. Record the output.
2. Run `tersio doctor`. Every row must be `ok`. If a row fails, run `tersio doctor --fix`, then run `tersio doctor` again.
3. Run `rtk --version`. Record the output.
4. Create the scratch copy and record its commit hash.
5. Run the fixture repo's install and build once, so that caches are warm and the state is stable.
6. Confirm that no other process loads the machine during the run.

---

## 6. Methodology

### 6.1 Run design

| Setting | Value |
| --- | --- |
| Samples per cell | 3 minimum. 5 or more for published results. |
| Statistic | p50. Also report min and max. |
| Session | One fresh session per sample |
| Order | Alternate before and after runs (B, A, B, A, …). This reduces drift. |
| Settings | Same model, temperature, reasoning effort, and tool access for before and after |
| Context | Empty before each run. No memory, no prior turns. |

If the agent does not let you set temperature or reasoning effort, record the default values that it uses.

### 6.2 Standard run procedure

For each sample:

1. Start a fresh session in the scratch repo.
2. Set the mode. For a before run, run `/combo off`.
3. Run `/tersio status`. Confirm that the status matches.
4. Send the fixture prompt. Send nothing else.
5. Wait for the final reply.
6. Save the final assistant message to a text file (`raw/<suite>-<fixture>-<before|after>-<mode>-<n>.txt`).
7. Record the timestamp of the run.
8. For Suite C, run the acceptance test. Record pass or fail.
9. Close the session.

### 6.3 Isolating your runs in the ledger

Tersio stores usage rows in `~/.tersio/usage.db`. Do not clear this file.

- Record the start time and end time of the full benchmark.
- When you read `tersio usage` or the dashboard, use only rows inside that time window.
- If you cannot filter by time, say so in the report and treat ledger numbers as `estimated`.

### 6.4 Invalid runs

Discard a sample and run it again if any of these is true:

- `/tersio status` did not match the intended mode.
- The session contained earlier turns.
- The model used tools in Suite R or Suite C (these suites are reply-only).
- The run ended with an error or a cut-off reply.
- The model asked a question instead of answering.
- The run was affected by a context compaction.

Record every discarded sample and the reason.

---

## 7. Suite R — Caveman (reply text)

**Goal:** Measure the reply-length reduction, in tokens before and after.

**Steps:**

1. Use the fixtures in Appendix A.1.
2. For each fixture, run a before sample and an after sample for each Caveman level in the matrix.
3. Count tokens in each saved reply. Use `o200k_base`.
4. Calculate p50 per cell. Calculate Δ%.

**Report per cell:**

| Mode | Fixture | Before (tokens) | After (tokens) | Δ% |
| --- | --- | --- | --- | --- |

**Notes:**

- Tools must be off or unused. This suite measures prose only.
- Run the quality gate (Section 9) on each reply.

---

## 8. Suite C and Suite S

### 8.1 Suite C — Ponytail and Combo (code reply)

**Goal:** Measure the reduction in the full assistant reply to a coding task.

**Steps:**

1. Use the fixtures in Appendix A.2.
2. Run a before sample, then after samples for `/ponytail lite|full|ultra` and `/combo medium|balanced|max`.
3. Count tokens in the full assistant reply, including code and prose.
4. Run the acceptance test for each fixture (Section 9).
5. Calculate p50 per cell. Calculate Δ%.

**Rule:** Count savings only from samples that **pass** the acceptance test. Report the pass rate next to every Δ%.

### 8.2 Suite S — RTK (command output)

**Goal:** Measure the reduction in the output that the model receives from shell commands.

**Steps:**

1. Use the commands in Appendix A.3.
2. **Before:** run `/rtk off`. Send the command through the agent's shell tool. Save the tool result exactly as the model receives it.
3. **After:** run `/rtk on`. Send the same command through the agent's shell tool. Save the tool result exactly as the model receives it.
4. Count tokens in each saved tool result.
5. Calculate p50 per command. Calculate Δ%.
6. Cross-check against the dashboard **Command tools** view.

**Notes:**

- Reset the repo state before each run (`git stash -u` or a clean copy). Command output depends on repo state.
- Exact bytes bypass RTK. If a command is a byte-exact request, RTK does not change it. Do not count that as a failure.
- Only shell tool calls pass through RTK. Other tool calls (for example, file read and file edit) are not metered.
- Run the commands in the same order every time.

---

## 9. Suite Q — Quality Gate

A token reduction has no value if the answer is wrong. Apply this gate to every sample.

### 9.1 Code (Suite C)

Each fixture has acceptance tests (see Appendix A.2).

| Check | Pass condition |
| --- | --- |
| Compiles | The code compiles or parses with no error |
| Tests | All acceptance tests pass |
| Safety | The code does not remove input checks that the task asks for |
| Scope | The code solves the task. It does not solve a different task. |

Record `pass` or `fail` for each sample. Report the pass rate per mode.

### 9.2 Reply text (Suite R)

Check each reply against the **fact list** for the fixture (Appendix A.1).

| Check | Pass condition |
| --- | --- |
| Facts | Every required fact is present |
| Errors | No fact is wrong |
| Meaning | A reader can understand the answer without the before reply |

Mark `pass`, `partial`, or `fail`. Use `partial` if one required fact is missing.

### 9.3 Command output (Suite S)

| Check | Pass condition |
| --- | --- |
| Exit status | The same as the before run |
| Signal | Errors, failing test names, and warnings in the before output also appear in the after output |

If RTK removes a failure message that the before output had, mark the sample `fail`.

---

## 10. Suite O — Prompt Overhead and Break-even

Each mode adds text to the prompt. This text costs input tokens on every request. Measure it.

### 10.1 Measure overhead

1. Start a fresh session with all modes **off**. Send the fixed message `Reply with the word OK.`
2. Record the **input token count** of the first request. Use the provider's usage field or the `tersio usage` ledger. This is `input_before`.
3. Repeat with the mode **on**. This is `input_after`.
4. Overhead = `input_after − input_before`.
5. Repeat 3 times. Use p50.

Record cache read and cache write tokens if the provider reports them. Overhead may be cached after the first request.

### 10.2 Calculate break-even

Use the p50 saving per task from Suites R, C, or S.

```
saving_per_task = before_tokens − after_tokens
break_even_tasks = overhead_tokens / saving_per_task
```

If `saving_per_task` is zero or negative, write `never`.

### 10.3 Cost-weighted break-even (optional)

Input and output tokens have different prices. If you know the prices, use this form:

```
net_per_task = (saving_per_task × price_out) − (overhead_tokens × price_in / tasks_per_session)
```

Record the prices and the date that you read them. Mark the result `estimated`.

---

## 11. Cross-check with Tersio Reports

Use Tersio's own reports to check your numbers. Do not use them as your only source.

| Tool | Command | What it shows |
| --- | --- | --- |
| Usage report | `tersio usage` | Ledger-backed usage and savings for this machine |
| Dashboard | `tersio dashboard --open` | Token throughput, cost, savings, top models, command tools |
| Dashboard export | `tersio dashboard --export <file>` | A saved copy of the dashboard |
| Health | `tersio doctor` | Extension, Ponytail, and RTK status |

Notes:

- The dashboard serves on `127.0.0.1` only. Use `--port <n>` if the default port is busy.
- The dashboard reports weighted RTK command-output savings. It does **not** estimate provider billing.
- If your count and the ledger differ by more than 10%, report both numbers and the likely cause.

---

## 12. Interpreting Results

### 12.1 Surfaces are separate

| Surface | What it covers | What it does not cover |
| --- | --- | --- |
| Reply text | The prose in assistant replies | Code, tool output, input tokens |
| Code reply | The full reply to a coding task | Tool output, input tokens |
| Command output | The text that a shell tool returns | Replies, input tokens |

Do not add percentages from different surfaces. Do not call any one of them "total token savings".

### 12.2 Known limits

- Caveman and Ponytail results depend on the model. A model may follow the rules well or poorly.
- RTK estimates command-output tokens. It does not estimate bill savings.
- Small sample sizes give wide ranges. Report min and max.
- Results from one machine and one fixture repo may not match results from another.
- Reasoning tokens (hidden thinking) are not in the reply text. Record them separately if the provider reports them.

### 12.3 Language to use

| Use | Do not use |
| --- | --- |
| "Reply text went from 124 to 107 tokens (−13.7%, p50, n=3)." | "Tersio saves 13.7% on tokens." |
| "Command output went from 4,003 to 54 tokens for `bun run test`." | "Tersio cuts your bill by 98.7%." |
| "Break-even is about 7 code tasks." | "Ponytail always pays back." |

---

## 13. Reference Values

The Tersio README reports the values below. They are **reference points only**. They come from one model and one setup. Your values will differ. Do not copy them into your report.

| Mode | Surface | Before → After (tokens) | Δ |
| --- | --- | --- | --- |
| `/caveman full` | Reply text | 124 → 107 | −13.7% |
| `/caveman ultra` | Reply text | 124 → 109 | −12.1% |
| `/ponytail lite` | Code reply | 306 → 177 | −42.2% |
| `/ponytail full` | Code reply | 306 → 208 | −32.0% |
| `/ponytail ultra` | Code reply | 306 → 112 | −63.4% |
| `/combo medium` | Code reply | 306 → 132 | −56.9% |
| `/rtk on` — `bun run test` | Command output | 4,003 → 54 | −98.7% |
| `/rtk on` — `find . -name '*.test.ts'` | Command output | 10,908 → 248 | −97.7% |
| `/rtk on` — `ls -la .` | Command output | 983 → 275 | −72.0% |
| `/rtk on` — `git status` | Command output | 72 → 18 | −75.0% |
| `/rtk on` — `bun run build` | Command output | 140 → 114 | −18.6% |

Use them to find a gross error. For example, if your RTK result for `bun run test` shows a 5% reduction, run `tersio doctor` and check the RTK status.

---

## 14. Report Format

Save the report as `benchmark-report-<model>-<YYYY-MM-DD>.md`. Use this template.

### 14.1 Environment block

```yaml
date: YYYY-MM-DD
agent: <name and version>
tersio_version: <output of `tersio version`>
rtk_version: <output of `rtk --version`>
model: <provider/model-id>
settings:
  temperature: <value or default>
  reasoning_effort: <value or default>
tokenizer: o200k_base
os: <name and version>
fixture_repo_commit: <hash>
samples_per_cell: <n>
window_start: <ISO time>
window_end: <ISO time>
```

### 14.2 Results tables

Use one table per suite. Show tokens before and after in every row.

```markdown
| Mode | Fixture | Before p50 | After p50 | Min–Max (after) | Δ% | Quality | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
```

### 14.3 Overhead table

```markdown
| Mode | Overhead (input tokens) | Saving per task | Break-even (tasks) | Cache read | Cache write |
| --- | --- | --- | --- | --- | --- |
```

### 14.4 Run log

List every sample, including discarded samples.

```markdown
| Run ID | Suite | Fixture | Mode | Phase (before/after) | Sample | Status | Reason (if discarded) |
| --- | --- | --- | --- | --- | --- | --- | --- |
```

### 14.5 Machine-readable output (optional)

```json
{
  "environment": {},
  "results": [
    {
      "suite": "R",
      "fixture": "R1",
      "mode": "caveman-full",
      "before_p50": 0,
      "after_p50": 0,
      "min_after": 0,
      "max_after": 0,
      "delta_pct": 0.0,
      "quality": "pass",
      "estimated": false
    }
  ],
  "overhead": [],
  "discarded": []
}
```

### 14.6 Summary section

End the report with:

1. **Findings:** three to five short sentences. Give the before and after token counts. Use the language in Section 12.3.
2. **Deviations:** every change from this guide.
3. **Limits:** the model, sample size, and surface limits that apply.
4. **Anomalies:** any value that differs from Section 13 by a large amount, with a likely cause.

---

## 15. Agent Checklist

Copy this list. Mark each item when it is done.

- [ ] Read Sections 2 and 6.
- [ ] Complete the preflight (Section 5.2).
- [ ] Record the environment block.
- [ ] Save the current `/tersio status` output.
- [ ] Record the window start time.
- [ ] Run Suite R (before, then after for each Caveman level).
- [ ] Run Suite C (before, then after for each Ponytail level and Combo preset).
- [ ] Run Suite S (RTK off, then on).
- [ ] Run the quality gate on every sample.
- [ ] Run Suite O (overhead and break-even).
- [ ] Record the window end time.
- [ ] Cross-check with `tersio usage` and the dashboard.
- [ ] Write the report (Section 14).
- [ ] Remove the scratch repo if the user asks.
- [ ] Restore the user's original mode settings (Section 16).

---

## 16. Cleanup

The benchmark changes mode state. Restore it when you finish.

1. Before you start, run `/tersio status`. Save the output.
2. When you finish, set the saved modes again with `/combo`, `/caveman`, `/ponytail`, and `/rtk`.
3. Run `/tersio status` and confirm that it matches the saved output.
4. Do not change Tersio default settings.

---

## Appendix A — Fixtures

Freeze these fixtures. Copy them to the repo and do not edit them during a benchmark.

### A.1 Suite R — Reply text fixtures

Send each prompt as the only message in a fresh session. Tools must be off or unused.

| ID | Prompt | Required facts |
| --- | --- | --- |
| R1 | `Explain the difference between a process and a thread.` | A process has its own memory space; threads share memory inside a process; threads are cheaper to create; a crash in a thread can affect the whole process. |
| R2 | `Explain what a database index does and when it can hurt.` | An index speeds up reads; it uses extra storage; it slows writes; too many indexes cost more than they save. |
| R3 | `Explain the difference between HTTP GET and POST.` | GET reads data; POST sends data to change state; GET is safe and can be cached; POST is not idempotent by default. |
| R4 | `Explain what a race condition is and give one way to prevent it.` | Two tasks access shared state with an unsafe order; the result depends on timing; prevention such as a lock, atomic operation, or immutable data. |
| R5 | `Explain what Docker image layers are.` | An image is built from read-only layers; each instruction can add a layer; layers are cached and shared; a container adds a writable layer on top. |

Use at least R1, R2, and R3. Use all five for published results.

### A.2 Suite C — Code fixtures

Add this line to each prompt: `Reply with the solution only. Use TypeScript.`

| ID | Task | Acceptance tests (minimum) |
| --- | --- | --- |
| C1 | `Write a debounce(fn, ms) function.` | Calls `fn` once after the wait; resets the timer on repeat calls; passes the latest arguments; keeps `this`. |
| C2 | `Write parseCsvLine(line) that returns string[]. Handle quoted fields and escaped quotes.` | Plain fields; quoted comma; doubled quote (`""`); empty field; trailing comma. |
| C3 | `Write an LRU cache class with get, set, and a max size.` | `get` refreshes use; `set` evicts the least recently used item at capacity; missing key returns `undefined`; size never exceeds max. |
| C4 | `Write deepMerge(a, b) for plain objects.` | Nested objects merge; `b` wins on conflict; arrays are replaced; inputs are not mutated. |
| C5 | `Write retry(fn, attempts, baseMs) with exponential backoff.` | Returns on first success; retries on failure; waits grow by a factor of two; throws the last error after the final attempt. |

Write the acceptance tests before the first run. Keep them in the fixture repo. Use the same tests for every mode.

### A.3 Suite S — Command fixtures

Run each command from the root of the fixture repo. Use a repo that has a `bun` toolchain and `*.test.ts` files (the Tersio repo itself works).

| ID | Command |
| --- | --- |
| S1 | `bun run test` |
| S2 | `find . -name '*.test.ts'` |
| S3 | `ls -la .` |
| S4 | `git status` |
| S5 | `bun run build` |

For S4, make the working tree the same before every run. Use a fixed set of modified and untracked files.

---

## Appendix B — Token Counting

Use `o200k_base` for all counts. Count the saved text files, not the chat display.

```python
# count.py
import sys
import tiktoken

enc = tiktoken.get_encoding("o200k_base")
print(len(enc.encode(sys.stdin.read())))
```

Usage:

```bash
pip install tiktoken
python count.py < raw/R-R1-before-caveman-full-1.txt
python count.py < raw/R-R1-after-caveman-full-1.txt
```

Rules:

- Count exactly the saved text. Do not trim or reformat it.
- Count the full final assistant message for Suites R and C.
- Count the full tool result for Suite S.
- Also record the provider-reported output tokens if they are available. Report both. Do not mix them in one column.

---

## Appendix C — Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `/combo`, `/caveman`, or `/ponytail` not found | Tersio not loaded | Run `tersio doctor`. Run `tersio reinstall`. Restart the agent. Run `tersio doctor` again. |
| RTK result shows almost no reduction | RTK not active | Run `/rtk status`. Run `tersio doctor` and fix any failing RTK row. Restart the agent. |
| RTK binary missing or not executable | Install problem | Run `tersio reinstall`. On Linux and macOS, run `chmod +x ~/.bun/bin/rtk`. |
| RTK runs missing from the dashboard | RTK not connected to the shell tool | Run `tersio doctor --fix`. Restart the agent. Only shell tool calls are metered. |
| Mode does not change reply length | Low model compliance | Record the result. Do not retry until it looks better. |
| Mode status resets between sessions | Session defaults override | Persisted `/combo`, `/caveman`, and `/rtk` values win over session-start defaults. Set the mode again and confirm with `/tersio status`. |
| Ledger numbers do not match your counts | Different token boundary | Compare surfaces (Section 12.1). Report both numbers. |

---

## Appendix D — Change Log

| Version | Date | Change |
| --- | --- | --- |
| 1.1 | — | Removed agent-specific references. Replaced "base" wording with before and after token counts. |
| 1.0 | — | First version of the agent-neutral benchmark guide |
