# Tersio Benchmark Guide

How to measure Tersio on any agent. Report the agent, the model, and the versions you used.

The method follows how the upstream projects test their own tools:

- **Caveman**: compare replies on fixed prompts, with a control prompt `Answer concisely.` so the gain is not just a short-answer instruction. Count prompt overhead separately, and report losses.
- **Ponytail**: run the same tasks with and without the mode, five times each, and check quality with tests and injected bugs.
- **RTK**: measure command output only. Check that failure details survive. Report percentages, not bill savings.

## Quick run

A first pass on your own repo, in about ten minutes. It answers "does this save me tokens" without the full protocol below.

1. Run `tersio install`, then `tersio doctor`. Both must pass.
2. Set one mode in the dashboard's General pane. Start with `Combo balanced`.
3. Open a fresh session and ask one question you ask often. Save the reply.
4. Turn every mode `off` in the same pane. Open another fresh session and ask the same question.
5. Compare the reply tokens and read Δ Net, not Δ Tokens alone.

The full protocol below turns that first pass into a number two people can reproduce.

## 1. Modes and levels

Base means every mode is off, and every result is compared to base. This is the complete matrix. A
result file that skips a row is incomplete, so two people running this guide produce the same tables.

| Mode | Every level | What it changes |
|---|---|---|
| Base | `off` | Nothing. The baseline. |
| Control | the prompt `Answer concisely.` | A plain instruction, used only as a reference. |
| Caveman | `lite`, `full`, `ultra`, `megacave-lite`, `megacave-full`, `megacave-ultra` | Shorter replies. Six levels. |
| Ponytail | `lite`, `full`, `ultra` | Smaller code changes. Three levels. |
| pstack | `on` | Design and verification rules. Scored on quality only. |
| RTK | `on` | Shorter shell command output. Measured by the bench, not by a session. |
| Combo | `lite`, `balanced`, `max` | Presets. `lite` is lite/lite, `balanced` is full/full, `max` is ultra/ultra, and all three turn RTK and pstack on. |

There are two ways to turn a mode on, and they are measured separately:

- **Saved default.** The mode is set before the session starts. Its block is in the system prompt from turn one.
- **Slash command.** The command is issued mid-session. The block is appended when it runs, after context has already grown.

Both paths inject the same text. They differ in *when* it is paid for. Do not mix the two paths in
one comparison. Pick one, state it in the result file, and keep it for every run of that case. One
session for the whole benchmark can hold only one saved default, so a benchmark that runs in one
session uses the slash command path throughout.

### The level bodies

Each level injects its own body, so each level is its own measurement. Static sizes, so a reader can
sanity-check the growth against them:

| Caveman level | File | Bytes | Characters |
|---|---|---:|---:|
| `lite` | `extensions/caveman/rule-lite.md` | 4,210 | 4,206 |
| `full` | `extensions/caveman/rule.md` | 4,708 | 4,708 |
| `ultra` | `extensions/caveman/rule-ultra.md` | 2,513 | 2,513 |
| `megacave-lite` | `extensions/caveman/rule-megacave-lite.md` | 3,122 | 2,822 |
| `megacave-full` | `extensions/caveman/rule-megacave.md` | 2,858 | 2,448 |
| `megacave-ultra` | `extensions/caveman/rule-megacave-ultra.md` | 2,931 | 2,761 |

The two columns differ where a body carries multi-byte characters, so check with the one you have:
`wc -c` gives the bytes, a character count gives the other. The token figures quoted in the result
files are estimates that divide a body size by four, not a tokenizer count. The megacave bodies
give 705, 612 and 690 from their characters and 780, 714 and 733 from their bytes, so a figure taken
from a byte count reads a little higher than the same body counted in characters.

Ponytail ships one body for all three levels and states the level in its header, so the three levels
differ by that line rather than by size.

### Command surface

Run this surface when the question is "what does the command cost", not "what does the mode cost".
One row per command **and level**, so `/caveman` alone is six rows.

| Command | Every level to measure |
|---|---|
| `/caveman` | `lite`, `full`, `ultra`, `megacave-lite`, `megacave-full`, `megacave-ultra` |
| `/ponytail` | `lite`, `full`, `ultra` |
| `/pstack` | `on` |
| `/combo` | `lite`, `balanced`, `max` |

Procedure for one command case:

1. Use the benchmark's one session, with every mode `off`.
2. In that session, issue the command, then ask prompt P1.
3. Record P1's reply and the turn's totals.
4. Clear the context and repeat for the case's runs.
5. The difference against a base turn that asked P1 with no command is the command's cost.

A command and its prompt go in one turn, so the command's block lands on the turn that answers
the prompt. Most harnesses accept a command and a prompt together in one non-interactive call, so
this surface needs no interactive session. If your harness does not, use its interactive mode and
read the totals from the session record.

The block is injected once, so the command costs its body and not its body times the turns. Expect
the session growth to land near the static size of the body.

`/combo` is the expensive case by construction: it injects four blocks at once. Measure it, but
report it separately from the single-mode commands, because it is a preset and not a mode.

## 2. Setup

1. Install Tersio for your agent, then run the health check and confirm it passes.
2. Run `tersio upstream` and read the source rows. It names the upstream release each vendored body
   comes from, so a run on a body that upstream has moved measures the wrong thing.
3. Record the agent version, the model, the thinking level, and the temperature. Keep them fixed.
4. Write benchmark output to a separate folder, and leave your live settings alone.
5. Use a fixed repository with a passing test suite and at least 200 files, pinned to one commit.
6. Copy it and inject exactly one failing test. Use that copy for the agentic runs.

### The fixture repo

Step 6 takes five minutes, and the copy is the fixture. The three result files in this folder all
used the same shape: a copy of the repository under test at a pinned commit, with one failing test
injected into a source file and every test file left alone. The three runs used this repository at
`72b6716`, and each result file names the commit it measured.

Put the bug in the source, not in the test. The test states the correct expectation, the source
disagrees, and the agent fixes the source. A bug inside the test file forces the agent to edit a
test to go green, which is exactly what the agentic gate forbids, so the gate stops meaning
anything.

```bash
# A copy of the repository under test, with its own history.
git clone --quiet --local /path/to/repo /tmp/bench-fixture
cd /tmp/bench-fixture
bun install --frozen-lockfile
bun run build
bun run test          # green before the bug goes in
```

Then add the bug and the test that catches it, as two files:

```ts
// extensions/shared/invoice.ts
export function invoiceTotal(invoice: Invoice): number {
  return invoice.lines.reduce((sum, line) => sum + line.price, 0); // ignores qty
}
```

```ts
// test/shared/invoice.test.ts
test("the invoice total multiplies price by quantity", () => {
  expect(invoiceTotal({ lines: [{ price: 10, qty: 2 }, { price: 5, qty: 3 }] })).toBe(35);
});
```

Check the state before you measure: the suite must report exactly one failure, and the rest must
pass. Then commit both files, so every run starts from the same injected bug. Reset between runs
with `git checkout -- .`.

Keep the copy out of your working repository. An agent that can see your project will read it, and
on a code surface it will find functions that already exist and decline to write anything.

### Isolating the run

Do not edit your live settings for a benchmark. Point the extension tree at a scratch home, so the
mode state is per-condition and your real `~/.tersio` never changes:

```bash
export TERSIO_HOME=/tmp/bench-home/base      # a folder holding settings.json
```

Write one `settings.json` per condition, with the four keys the session reads. This is how a
condition is set without touching the dashboard:

```json
{ "comboDefault": "off", "cavemanDefault": "off", "rtkDefault": false, "ponytailDefault": "off", "pstackDefault": "off" }
```

For `Combo balanced`, use `"comboDefault": "balanced"` with caveman `full`, rtk `true`, ponytail
`full`, and pstack `on`. For a single mode, set `comboDefault` to `custom` and set only that mode.

### One session for the whole benchmark

A fresh session per run fills the agent's session list, and a full benchmark makes hundreds of
entries there. Use one session for the whole benchmark instead, and clear the context between the
runs:

1. Open the session once, before the first case.
2. Run the case's first turn.
3. Clear the session's context, reset the fixture with `git checkout -- .`, and run the next turn.
4. Repeat until every case has its runs.

Each turn then starts from the same empty context, so the numbers read like a fresh session's, and
the session list holds one entry instead of one per run. A harness with no clear command starts a
new session for each turn instead, and its session list grows with the run count.

One session for everything means one mode setting for everything, so every case sets its mode with
a slash command. The saved-default path needs a session of its own, because that path fixes the
mode before the first turn. Pick one path for the whole benchmark, as section 1 sets out.

Measure the base case the same way. A base case measured with one session per run beside a mode case
measured in the shared session is two different experiments, and the deltas between them mean
nothing.

Read the per-turn usage. Every turn reports its own reply and total tokens, so the medians in
section 8 come from the turns, not from the session's last line.

The agentic surface needs the reset as much as the others: the agent has to meet the injected bug
again, so the context and the working tree both go back to their starting state before each turn.

## 3. Surfaces

Run every mode and level on every surface that applies to it, and never mix results across
surfaces. The matrix below is the full scope.

| Surface | Applies to | Task | Counted |
|---|---|---|---|
| Prose | Caveman (6 levels), Control, Combo (3) | 3 prompts, each asking for a three-sentence explanation. | Reply tokens |
| Code | Ponytail (3 levels) | 3 prompts, each asking for TypeScript functions. | Reply tokens |
| Agentic | Combo (3), pstack, RTK | Run the suite. Fix the failing test. Stop when it passes. | Total tokens, time, pass rate |
| Command output | RTK | Run `bun run bench` over the committed fixtures. | Output bytes, time, fidelity |
| Command surface | Every command and level | Issue one slash command, then ask P1. | Reply tokens, total tokens, quality |

The prompt overhead of a mode is inside the Total median column, because a mode's block lands in the
system prompt of every turn. Read it as the difference between the two columns, and read the static
body sizes in section 1 to check it.

RTK has no session-level row of its own on the prose or code surfaces. Its effect is command
output, and the bench measures it exactly. On the agentic surface it does have a row, because the
task runs shell commands, and there the RTK row answers a different question: whether condensing
the suite output changes how the agent fixes the bug.

## 4. Procedure

1. Set every mode to `off` and run the base case.
2. Open one session for the whole benchmark, and run every case's runs as turns in it, clearing the
   context between turns as section 2 sets out. Run each case **5 times**. The prose and code
   surfaces run three prompts each, so a case there is 15 runs, and its quality column reads out of 15.
3. Keep every result. Do not drop slow or failed runs.
4. Interleave the cases: base, A, B, base, A, B.
5. Run the control prompt on the prose surface.
6. Run every level listed in section 1. A skipped level is a hole in the result file.

## 5. Metrics

| Symbol | Name | Formula |
|---|---|---|
| **Reply median** | Median reply | Median reply tokens of the case. Base is the reference. |
| **Δ Tokens** | Reply change | Median reply tokens − base median. Negative is a saving. |
| **Δ%** | Relative change | Δ ÷ base median × 100. |
| **Total median** | Session cost | Median tokens of the whole session, prompt and reply. |
| **Δ Net** | Session change | Median total session tokens − base median. Negative is a saving. |
| **Δ Time** | Time change | Median time − base median. |
| **Quality** | Pass rate | Passing runs out of N. |

Reply tokens are the assistant's generated text. A harness that reports thinking tokens as a
separate number counts them out, and the result file says which it counted.

Read Δ Net next to Δ Tokens. A mode can cut reply tokens and still cost more overall, because Δ Net
carries the mode's block on every turn of the session.

## 6. Quality gates

A saving counts only when the output stays correct.

- **Code**: passes a strict type check and a fixed test file, and contains every requested function.
- **Prose**: exactly three sentences, with every required keyword.
- **Agentic**: the suite passes, and no test file was edited.
- **Command output**: the failing test name, its assertion, its file, and its line remain, and the exit code matches.
- **Command surface**: the reply after the command passes the same gate as the same prompt without it, and the session records which path was used.
- **pstack**: score the agentic pass rate, the review rounds, and the wrong turns. A green suite with a wrong turn is a failure.

Do not publish a saving for any mode whose pass rate is below base.

## 7. Fixed prompts

Two people running this guide must measure the same thing. The keyword test is lexical: a group matches when the reply contains any of its terms as a substring, so `quer` covers `query` and `queries`.

| Prompt | Text | Keyword groups, all required |
|---|---|---|
| P1 | Explain in three sentences how a database connection pool improves throughput under load. | `reus` · `connection` · `overhead`/`cost` · `concurren`/`wait` |
| P2 | Explain in three sentences why an index speeds up a database query. | `index` · `quer` · `scan`/`search`/`tree`/`lookup` · `rows`/`table`/`data`/`disk` |
| P3 | Explain in three sentences how HTTP caching reduces server load. | `cach` · `server`/`origin`/`backend` · `load`/`bandwidth`/`request`/`traffic` |

| Code prompt | Text | Required names |
|---|---|---|
| C1 | Write a TypeScript function `chunk<T>(items: T[], size: number): T[][]` that splits an array into fixed-size chunks, and `chunkLazy` that yields chunks from an iterable without materializing the whole array. | `chunk`, `chunkLazy` |
| C2 | Write a TypeScript `debounce` and a `throttle`, both with the signature `(fn: (...args: T) => void, ms: number)`. | `debounce`, `throttle` |
| C3 | Write a TypeScript `groupBy<T, K extends PropertyKey>(items: T[], key: (item: T) => K): Record<K, T[]>` and `countBy` with the same inputs returning `Record<K, number>`. | `groupBy`, `countBy` |

Agentic task: in the fixture repo, run the suite, fix the failing test, and stop when all tests pass. The
fixture is the one from section 2, and the failure is in the source, so a correct run edits a source
file and leaves every test file alone.

Read a miss before you record it, and compare each mode against base on the same prompt: a keyword the base model also misses measures the gate, not the mode.

## 8. Results

The result file has one table per surface, in the order below, and every table has exactly the
columns given. Leave a cell blank until it is measured. Keep every row, including the levels that
measured nothing useful, because a skipped row is a hole in the file.

Reply median and Total median are the two numbers a reader compares across agents. Δ Tokens and
Δ Net are the two deltas against base. pstack is scored on quality and review rounds only, so its
session columns stay `n/a`.

### Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Control (`Answer concisely.`) | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `full` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `ultra` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `megacave-lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `megacave-full` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Caveman `megacave-ultra` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `balanced` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Combo `max` | ___ | ___ | ___% | ___ | ___ | ___/15 |

### Code

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | 0 | 0% | ___ | 0 | ___/15 |
| Ponytail `lite` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Ponytail `full` | ___ | ___ | ___% | ___ | ___ | ___/15 |
| Ponytail `ultra` | ___ | ___ | ___% | ___ | ___ | ___/15 |

### Agentic

The Agentic rows count the whole session: total tokens, wall time, and the pass rate. A row also
records whether any test file was edited, in the text under the table, because the gate forbids it.

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |
|---|---:|---:|---:|---:|---:|---:|
| Base (`off`) | ___ | ___ | 0 | 0% | ___ | ___/5 |
| RTK `on` | ___ | ___ | ___ | ___% | ___ | ___/5 |
| pstack `on` | ___ | n/a | n/a | n/a | ___ | ___/5 |
| Combo `lite` | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `balanced` | ___ | ___ | ___ | ___% | ___ | ___/5 |
| Combo `max` | ___ | ___ | ___ | ___% | ___ | ___/5 |

The base row's wall time is the baseline every other row subtracts from.

### Command surface

One row per command **and level**. Keep the path column filled in, because a saved default and a
slash command are not comparable.

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |
|---|---|---|---:|---:|---:|---:|---:|---:|
| (none) | — | — | ___ | 0 | 0% | ___ | 0 | ___/5 |
| `/caveman` | `lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `full` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `ultra` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `megacave-lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `megacave-full` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/caveman` | `megacave-ultra` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/ponytail` | `lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/ponytail` | `full` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/ponytail` | `ultra` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/pstack` | `on` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/combo` | `lite` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/combo` | `balanced` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |
| `/combo` | `max` | slash | ___ | ___ | ___% | ___ | ___ | ___/5 |

Report `/combo` rows separately from the single-mode commands. A preset injects every block at
once, so its Δ Net is not comparable to one mode's.

### Command output

Tersio routes three things through rtk: `grep` tool output, `find`/`glob` tool output, and one `rtk rewrite` lookup before every Bash call. Nothing else goes through a filter, so nothing else belongs in this table.

Run the bench instead of timing commands by hand:

```bash
bun run bench
```

It reads the committed fixtures in `bench/fixtures/`, pipes each through `rtk pipe -f <filter>`, and prints ops/sec and percentiles. It also asserts fidelity, so a filter that starts dropping matches fails the run.

| Case | Fixture | What fidelity means |
|---|---|---|
| `find` condense | 260 paths, 46 dirs | the header counts every file and dir, and no printed name is invented |
| `grep` condense | 240 matches | every match line survives with its `file:line` |
| `rewrite` | 12 commands | every command gets an answer or a clean "no equivalent" |

Fill this table from your own `bun run bench` output:

| Case | Bytes in | Bytes out | Δ% | Mean |
|---|---:|---:|---:|---:|
| `find` | ___ | ___ | ___% | ___ ms |
| `grep` | ___ | ___ | ___% | ___ ms |
| `rewrite`, 12 commands | — | — | — | ___ ms |

The reduction is a byte ratio, so it reproduces across machines. The timings do not: a slow machine shifts every number, so compare percentages and ignore the milliseconds.

Two numbers explain the design. The `find` filter folds a directory after a few children, so it saves most of its bytes. The `grep` filter keeps every match line, so a dense result saves little. The rewrite lookup runs before every Bash call, which is why `MIN_FILTER_BYTES` is 1200: below that, the spawn costs more than the filter saves.

The bench does not measure Caveman, Ponytail, or pstack. Those change prompt text, and only a live session produces the reply tokens to compare. The protocol above is the only way to measure them.

## 9. Reporting

Write each run to its own file, named for the agent: `BENCHMARK_OMP.md`, `BENCHMARK_PI.md`, `BENCHMARK_OPENCODE.md`, `BENCHMARK_CLAUDECODE.md`, `BENCHMARK_CODEX.md`, and so on. Use the uppercase agent name with no spaces. Keep the file beside the guide, so a reader can compare agents without mixing their numbers.

Start each file with this header, then paste the results tables from section 8 with the blanks
filled in. Keep every row, including the levels that measured nothing useful, and keep the path
column: a saved default and a slash command are different measurements.

The file has these sections, in this order, and no others:

```md
# Tersio benchmark: <agent>

- Agent: <name and version>
- Model: <provider/model>, thinking effort <level>, temperature <not reported by the harness>
- Tersio, RTK, Ponytail, Caveman: <versions>
- Caveman release <version> and pstack pin <commit>: the upstream bodies this run measured
- Repository and commit: <repo> at <commit>. <where each surface ran>
- Runs (N), date, surface: <N per prompt on the prose and code surfaces, 5 per case on the others>, <date>
- Sessions: one for the whole benchmark, the context cleared between runs
- Path: <the path every case used: saved default or slash command>

<one paragraph: how it was measured, and the harness it ran under>

<one paragraph: what Δ Tokens and Δ Net count, and any limit on this run>

## Bench (`bun run bench`)

| Case | Bytes in | Bytes out | Δ% | Mean |

## Token protocol

### Prose

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |

### Code

| Case | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |

### Agentic

| Case | Reply median | Total median | Δ Net | Δ% | Wall median | Pass |

## Command surface

| Command | Level | Path | Reply median | Δ Tokens | Δ% | Total median | Δ Net | Quality |

## What the numbers say

- <findings>

## Gates

- <gates>
```

`BENCHMARK_OMP.md` is the reference file for this shape.

Include with every result:

- The agent name and version.
- The model, the thinking level, and the temperature.
- The Tersio, RTK, Ponytail, and Caveman versions.
- The Caveman release and the pstack pin, so a reader knows which upstream bodies were measured.
- The test repository and commit.
- The number of runs (N), the date, and the surface.
- How the sessions were run: one for the whole benchmark with the context cleared between runs, or one per run.

A run that breaks a rule of this guide says so in the file, in the paragraph under the header. A
short run, a skipped level, a reworded prompt, and a harness limitation each get one sentence.

Show the median for each value, and state the min and the max in the text when the spread matters,
because a median alone hides a bimodal sample. Write verdicts with their limits: "Lower reply
tokens in this sample. Quality unchanged on 5 of 5 runs."

Do not claim total bill savings. These tests measure reply tokens, prompt overhead, or command output. Rerun after any change to the agent, the model, or the Tersio version, and do not compare results across different setups.
