# Upstream visibility and benchmark accuracy plan

What is left. The build and the verification of this program are done, and their evidence is in
Appendix A. This file carries only the open work now, so a reader sees what remains and nothing
else.

The program closed two blind spots. The upstream scorecard now sees every upstream file, including
a skill directory that appeared after the pin, and it names the direction a stale install is stale
in. The published measurements now carry the unit behind every number.

Rule the program enforces. A scorecard that reports no drift means no upstream change reaches a
file this project carries, and no upstream file appeared that nobody has looked at. A published
number names the unit it counts.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its
evidence exists: a file, a log line, a test run, or a SHA. The body is a how-to. The appendices
explain and record.

## Out of scope, and why

- **pstack slash-command skills.** Upstream carries 54 skill directories under `pstack/skills/`. This
  project carries 18 skill directories, 24 principle leaves, 23 playbooks and the mode body.
  The upstream directories it does not carry are driven by slash commands and by Cursor's harness.
  They need a command surface or Cursor's own tools that this port has no equivalent for. The one
  that does not, `typescript-best-practices`, is carried. The scorecard's job with the rest is to
  name them, not to carry them. Operator decision.
- **The upstream guide.** `pstack/docs/guide/` holds 13 files that document Cursor's harness. They
  need the same porting pass as the bodies, and the mode runs without them. Deferred.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:extensions/pstack/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:extensions/pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:extensions/pstack/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:extensions/pstack/skills/technical-writing/SKILL.md`
- [ ] On the operator's go, arm the audit tick as an hourly loop with the tick prompt the execution playbook names. Never leave the cadence to memory.
- [ ] On the operator's hold or stand-down, send the owner a zero-writes order at once.

### Spawn the owner

- [ ] Spawn one owner for the pull request with the full lifecycle the execution playbook names. The pull request branches from `main`.
- [ ] Hold the file boundaries, or amend the plan's list. The change touched 39 files, not the nine the plan named, because the Caveman delivery, the update check and the dashboard moved with it.

### PR mechanics

- [x] Run the **unslop** skill before the commit and the **no-comments** skill before review. The unslop pass covered the prose this branch adds: no em dash, no AI vocabulary, no colon as a mid-sentence connector, and no forced rule of three. The no-comments pass read every comment the branch adds and found none dead, contradictory, or narrating the code beside it.

### Verdict and merge

- [x] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `skills/swarm/SKILL.md`. One gates lane, the fifteen live lanes and the perf lane recorded in Appendix A, and two or more audit lanes that read the diff and the receipts and distrust the PR body. Four workers ran: the gates lane, a carry audit, a pull request body audit, and a comment review. The carry audit found two defects, an asset mismatch that did not fail the gate and a provenance note naming the wrong commit, and both are fixed. The body audit found the stale numbers the body carried and the two claims the page did not implement, and both are fixed.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note.
- [ ] The owner reports STACK-READY with `main` as the base. The operator lands it.

## The one pull request

### The Caveman asset comparison

- [x] Compare the bundled body against the release asset at the pinned release, the way the Ponytail row compares against its package, so one check covers both ports. The row reads the `caveman.skill` asset of the pinned release, unzips it, and compares `caveman/SKILL.md` with the bundled body after the same adaptation the port keeps. An unreachable asset reads as unmeasured, the way the risk row asks.

## Merge

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner reports STACK-READY.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Verification record

Measured on 2026-10-22, on the branch `feat/upstream-visibility-and-benchmark-accuracy`. This is the
evidence for the boxes that were removed from this file when the work landed.

The unit lane.

- `bun run test`: 17 files, 523 tests. `bun run build`: built. `bun run check`: clean.
- The three new cases are in `test/cli/upstream.test.ts`: a new upstream skill directory is reported,
  a stale host row names the command that repairs it, and a vendored body that differs from the
  package it declares is a gap.
- The document check: the six caveman bodies against the guide's table, bytes by `wc -c` and
  characters by a character count. Zero mismatches, both columns, all six rows.

The live lane, fifteen lanes, one agent.

- Lane 1. `bun dist/tersio.js upstream` in a throwaway home with `GITHUB_TOKEN` set. The pstack row
  reads 93/93, drift 0, and names `pstack/skills/create-formal-verification-skill/SKILL.md` and
  `pstack/skills/maintain-formal-verification-skill/SKILL.md` under the not-carried count. The
  Caveman row reads 26 (2) and the pstack row 13 (4), after the TypeScript skill landed. The
  Caveman row also reads the `caveman.skill` asset of the pinned release and finds the bundled body
  in it, so the row covers the shipped archive and not only the repository at the tag.
- Lane 2. The same command in the real home, where the installed package is behind this build: the
  host rows read `run: tersio install --host omp` and `run: tersio install --host opencode`. Pi is
  not installed on this machine, so no pi row appears.
- Lane 3. The same command in a throwaway home whose installed plugin package reads 99.0.0: the
  host row reads `run: tersio update`.
- Lane 4. The same command with `--strict`: exit 0. Upstream movement alone is not a failure.
- Lane 5. `~/.tersio/upstream/scorecard.md`: both new pstack skill lines are in it, and the gap list
  for the carried files is unchanged.
- Lane 6. The Ponytail row reads 11/11 by bytes, the vendored copy against the package it declares.
- Lane 7. The guide's section 1 table against the six bodies on disk: zero mismatches.
- Lane 8. Section 2's fixture paragraph names the copy, the pinned commit and the injected failure,
  and the setup steps name `tersio upstream`.
- Lane 9. The OMP and PI headers read 5 per prompt and 15 per case, and both name `a968159`.
- Lane 10. The OMP body-size sentence reads 612 to 705 tokens against 1,177 for `full`, the character
  count over four. No measured row changed.
- Lane 11. `bun run bench`: three fidelity assertions hold, and the byte reductions are 79.5% for
  `find` (10,044 in, 2,059 out) and 10.5% for `grep` (22,432 in, 20,073 out). No file changed.
- Lane 12. The README names `/ponytail off|lite|full|ultra|status` and says the review runs as its
  own skill. No command the README names is unregistered.
- Lane 13. `/ponytail` with off, lite, full and ultra: each accepted, and the status line names the
  level. `review` is refused with `Unknown Ponytail level: review. Use: off | lite | full | ultra`.
- Lane 14. The Caveman update in a throwaway home: the report names `release v4.0.1` for each body,
  and the state records `cavemanUpstream.tag` as `v4.0.1`.
- Lane 15. The doctor and the scorecard against a home whose Caveman body came from `v9.9.9`: both
  read it as upstream movement, name the release, and point at the pin.

One change came from the operator after the lanes: the guide asked for a fresh session per run, and a
full benchmark filled the agent's session list with hundreds of entries. The whole benchmark now
runs in one session, with the context cleared between turns, so each turn starts from the same empty
context and the list holds one entry. One session means one mode setting, so every case sets its
mode with a slash command, and the saved-default path takes a session of its own. The base case has
to be measured the same way, and the three result files say how their own runs were run.

What the audit lanes found, and what they changed.

- The carry audit found that a body differing from the release asset only added a gap and left the row
  measured, so the gate passed. The comparison now marks the body unmatched, and the gate fails.
- The carry audit found that the pstack provenance note named the mode body's commit, `09d06eb`, for
  every leaf, while the TypeScript skill came from the pinned commit `a968159`. The note says so now.
- The body audit found stale numbers in the pull request body, the eligible head count, the prompt's
  size, the pstack match count, the not-carried counts, and the runtime. They are corrected.
- The body audit found that the page's "upstream state" and "proof behind each match" were claims
  without a surface. The Ports table now carries the upstream head beside the pin, and the matched
  cell names the rule that proves the match.

The perf lane.

- The head median is 1.98s over three runs (2.48s, 1.98s, 1.80s), against the trunk median of 1.18s
  and a ceiling of 2s. A second batch read 2.00s, 1.94s and 1.85s, and a third read 1.98s, 1.78s
  and 2.42s, so the median moves with the machine's load and the margin under the ceiling is thin.
  The release-asset comparison added one release read and one archive fetch to the run, which is the
  growth the risk row names.

The boxes that were removed for the file boundaries and the program protocol, and why.

- The program protocol: the audit tick, the owner, the swarm verdict, and the merge. That work did
  the build and the verification, not the program around them.
- The file boundaries: the change touched more files than the plan named, because the Caveman
  delivery, the update check and the dashboard moved with it.

## Appendix B. Risks

| Risk | What the owner watches |
|---|---|
| Watching the parent directory makes the report list every upstream skill the port does not carry | The not-carried count. The report carries a count and a compare link, not a wall of names. |
| The scorecard's runtime grows because it walks a wider tree | The perf lane. The run holds a tree map already, so the extra work is one pass over it. |
| The guide grows and the protocol gets harder to read | Nothing measures it today. The change adds prose, not steps. |
| A future upstream change moves a carried file and the pin is not reviewed | The upstream scorecard. It must read no drift for the carried files, and the not-carried count must be read at every release. |
| The package file server is unreachable, so the Ponytail row cannot measure | The Ponytail row's own status. An unreachable source reads as unmeasured, the way the RTK row does, and never as clean. |
| The result files drift from the guide again | The shape lanes. Every result file is checked against the section 9 template. |
| The README keeps naming a Ponytail command that no host of this port registers | Lane 12. The README must name the host matrix, so the promise follows what the port does. |
| A host stops surfacing a vendored skill, and the port says nothing | The doctor row for the Ponytail copy. The scorecard's Ponytail row must read the vendored copy against the package, and the host's own copy against the vendored one. |
| The Caveman body is fetched from a moving target, so the release it came from is unknown | The new release stamp. A body with no stamp reads as fetched from a moving target, never as current. |
| The Caveman release asset and the repository at that tag ever disagree | The Caveman row's own status. The row compares against the asset, and an unreachable asset reads as unmeasured, never as clean. |

## Appendix C. Links and reading list

- `docs/BENCHMARK_GUIDE.md`. The protocol. Sections 1, 2, 4, and 9 are the parts the pull request
  touched.
- `docs/BENCHMARK_OMP.md` and `docs/BENCHMARK_PI.md`. The two result files the pull request touched.
  The OpenCode file is the reference for a correct run-count header.
- `cli/upstream.ts`. The scorecard. `driftOf` holds the watch rule the pull request widened, `gapsOf`
  holds the gap kinds, and `PSTACK.files` holds the tracked upstream paths.
- `test/cli/upstream.test.ts`. The scorecard's tests. The case names every gap with whose move it
  was, and the new cases follow that shape.
- `extensions/updater/index.ts`. `updateCaveman` overwrites the tracked bodies, and
  `adaptCavemanFull` is the one local line the updater keeps.
- `extensions/ponytail/`. The vendored copy, 11 files, byte-identical to the package it declares. The
  scorecard's Ponytail row reads it, and the new check reads the package against it.
- `extensions/ponytail/hooks/ponytail-instructions.js`. `getPonytailInstructions` and
  `filterSkillBodyForMode` are where the level turns one body into three.
- `bench/rtk.bench.ts`. The bench lane 11 runs.
- `extensions/pstack/skills/show-me-your-work/SKILL.md`. The decision trail lives here.
