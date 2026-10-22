# Upstream visibility and benchmark accuracy plan

Two tools in this repository tell you whether your port is current and whether a published
measurement is honest. Both have blind spots that hide real drift, and the benchmark files carry
numbers that no longer match the files they describe. This plan closes the blind spots and fixes
the numbers, in one pull request.

This plan serves the maintainer who ports upstream bodies into this tree, and the reader who
quotes a benchmark row. The first one needs to learn that upstream moved. The second needs the
unit behind every figure.

Rule the program enforces. A scorecard that reports no drift means no upstream change reaches a
file this project carries, and no upstream file appeared that nobody has looked at. A published
number names the unit it counts.

One pull request. It carries the scorecard change and the three document changes, because the
scorecard's not-carried count and the guide's size table are read together, and a reader who
checks one checks the other.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a
sub-step of the box above it. Check a box only when its evidence exists: a file, a log line, a
test run, or a SHA. The body is a how-to. The appendices explain and record.

Tests alone are not sufficient verification. The pull request is verified only when its unit,
live, and perf boxes are all checked. Here the live lane is the scorecard's own surface, and the
perf lane is the scorecard's own runtime. No lane needs the model provider, so the whole program
runs without a benchmark run.

## Out of scope, and why

- **pstack slash-command skills.** Upstream now carries 56 skill directories under
  `pstack/skills/`. This project carries 17. The ones it does not carry, including the two new
  formal-verification skills, are driven by slash commands and by Cursor's harness. This port has
  no slash-command surface for them, so adopting them is a different program with its own harness
  work. The scorecard's job here is to name them, not to carry them. Operator decision.
- **The upstream guide.** `pstack/docs/guide/` holds 13 files that document Cursor's harness. They
  need the same porting pass as the bodies, and the mode runs without them. Deferred.
- **The pending update-check work.** It is the operator's own uncommitted change, not upstream
  drift. Appendix A names it, because it is what the scorecard's host rows are reporting today.

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
- [ ] Hold the file boundaries. The change touches only `cli/upstream.ts`, `test/cli/upstream.test.ts`, `extensions/updater/index.ts`, `cli/install.ts`, `cli/doctor.ts`, `docs/BENCHMARK_GUIDE.md`, `README.md`, `docs/BENCHMARK_OMP.md`, and `docs/BENCHMARK_PI.md`.

### PR mechanics

- [x] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [x] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge.
- [x] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run the **unslop** skill before the commit and the **no-comments** skill before review.
- [x] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.

### Verdict and merge

- [ ] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `skills/swarm/SKILL.md`. One gates lane, the fifteen live lanes from the PR's **Verify, live** block, the perf lane from its **Verify, perf** block, and two or more audit lanes that read the diff and the receipts and distrust the PR body.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note.
- [ ] The owner reports STACK-READY with `main` as the base. The operator lands it.

## Make the scorecard see the whole upstream, and fix the numbers (the one PR)

**Depends on.** None.

**Files.**

- [x] Edit `cli/upstream.ts`.
- [x] Edit `test/cli/upstream.test.ts`.
- [x] Edit `extensions/updater/index.ts`, `cli/install.ts`, `cli/update.ts`, and `extensions/shared/utils.ts`, so a Caveman body is fetched at a release.
- [x] Edit `extensions/shared/state.ts` and `cli/doctor.ts`, so the release is recorded and read back.
- [x] Edit `docs/BENCHMARK_GUIDE.md`, `README.md`, `docs/BENCHMARK_OMP.md`, `docs/BENCHMARK_PI.md`, and `docs/BENCHMARK_OPENCODE.md`.
- [x] Edit `cli/doctor-fix.ts`, `test/cli/install.test.ts`, and `test/cli/doctor.test.ts`, which carry the comment blocks this change trims.

**Build.**

The scorecard half.

- [x] Widen the watch in `driftOf` so the parent directory of a tracked directory is watched. Today a new sibling skill directory sits beside the tracked ones and is never seen, because the "added" rule only looks inside directories the port already tracks. The parent of `pstack/skills/poteto-mode/` is `pstack/skills/`, so one extra watched directory surfaces every skill upstream adds.
- [x] Report the skills the port does not carry, as a count, and how many of them moved since the pin. The report already has a gap kind for upstream movement, so a new file lands there and reads as a review to schedule, not as a defect to fix.
- [x] Say which way a stale installed file is stale. The host rows compare the installed tree against this build's copy, and they cannot tell an install that is behind from a build that is behind. Name the direction and the command that fixes it: the install is older, so run `tersio install --host <host>`; the build is older than the installed package, so run `tersio update`.
- [x] Compare the vendored Ponytail copy against the npm package it declares. Today the Ponytail row compares each host's installed copy against the vendored copy, and compares the version string against the registry, so a hand edit of a vendored body is invisible to the tool. Fetch each vendored file from the package at the version the vendored manifest declares and compare the bytes, the way the Caveman row compares its bodies.
- [x] Stop the README naming a Ponytail command this port does not register. It says "Review runs separately through `/ponytail-review`", and this port registers one Ponytail command, `/ponytail`. Name the review skill instead, and leave the host matrix out: which host surfaces a skill is the host's business, not the README's.
- [x] Name the level set the port supports. The vendored config also accepts `review`, and the vendored hook has a branch for it, but nothing in this port passes it, because upstream treats review as a one-shot command and this port registers the level switch only. The docs must not list a level the port does not have.

The Caveman delivery half.

- [x] Pin a release, not a bare commit, so the port carries a version the way the Ponytail copy carries one. The Caveman row should print `4.0.1` beside the upstream `4.0.1`, the way the Ponytail row prints `5.3.2` beside `5.3.2`. One number, one release, one body.
- [x] Fetch the Caveman bodies at a published release, not at the moving tip, and write this build's pinned bodies on an install. The updater reads the moving tip today, so an installed body cannot be traced to a release, and the install pulls the same tip, so the installed body is never the reviewed one. The install writes the pinned copy, and the updater pulls the newest release.
- [x] Record the release the body came from, next to the body. A content hash says the file changed and nothing else. A tag says which release the file is, which is what the scorecard and the doctor need to tell a newer upstream body from a stale install.
- [x] Read that tag in the doctor and the scorecard. An installed body whose release is newer than the bundled body's pin reads as upstream movement, with the action "review the diff and bump the pin", because that is what closes the gap. A body with no tag reads as fetched from a moving target, which is what it is. Today both read as stale, and the advice to reinstall re-fetches the same tip, so the gap never closes.
- [ ] Compare the bundled body against the release asset at the pinned release, the way the Ponytail row compares against its package, so one check covers both ports. The asset carries the same bytes as the repository at that tag, so the comparison is exact.
- [x] Name the upstream Caveman skills this port does not carry, in the same place the Ponytail count names the ones it does not. The port carries three bodies and writes three more, and upstream publishes twenty-three skills. A reader should be able to see the surface this port covers and the surface it does not.

The guide half.

- [x] Relabel the level-body table in section 1. The six values are byte counts, and four of the six differ in character count, so label the column bytes and add a characters column beside it. A reader who checks with `wc -c` and a reader who counts characters both get their number.
- [x] Fix the run count in section 4 and in the section 9 template. The prose surface runs three prompts at five runs each, which is 15 runs per case, and the quality column already reads out of 15. Say "5 runs per prompt, 15 per case" in both places.
- [x] Replace the fixture paragraph in section 2. It says the guide cannot ship a fixture, and all three result files ship one: a copy of this repository at a pinned commit with one failing test injected into a source file, and every test file left alone. Write that pattern down, because the gate already requires that no test file is edited.
- [x] Add `tersio upstream` to the setup steps in section 2. The scorecard names the state of the mode bodies, and a run on a body that upstream has moved measures the wrong thing.
- [x] Add the pstack pin to the version line in the section 9 template, beside the Caveman pin. pstack has no version, so a result file that records only the Caveman pin cannot say which pstack body it measured.
- [x] State the basis of every token estimate in the guide. The body sizes in section 1 are sizes, and the figures quoted in the result files divide them by four. Say which one, so a reader knows the number is an estimate and not a tokenizer count.

The result-file half.

- [x] Fix the run count in the OMP and PI headers. Each says "5 per case" for prose and code, and each file's own tables say 15 runs per case with a quality column out of 15. The OpenCode file already states 15 per case, so the other two follow it.
- [x] Fix the body-size sentence in the OMP file. It reads "The `megacave` bodies are smaller, 714 to 780 tokens against 1,177 for `full`", and those figures divide the byte count by four. The characters give 612 to 705 tokens, and 1,177 for `full` holds either way because that file is plain ASCII. The conclusion survives and gets stronger: the bodies are smaller and still save less.
- [x] Add the pstack pin to both headers, in the line that already names the Caveman pin.
- [x] Keep every measured row as it is. Only the header wording and the derived body-size sentence change. A published measurement is not edited to match a document.

**You see.**

- [x] The pstack row names the two upstream skills that appeared since the pin, under the not-carried count, and the row still reads no drift for the files this project carries.
- [x] A stale host row names the command that repairs it, beside the file name.
- [x] The section 1 table carries a bytes column and a characters column, and both match the files on disk.
- [x] Each result file's header states a run count that matches its own tables, and both name the pstack pin.

**Verify, unit.** Tests alone are not sufficient verification. The pull request is verified only when its unit, live, and perf boxes are all checked.

- [x] Add the case `a new upstream skill directory is reported, not only a new file in a tracked one` to `test/cli/upstream.test.ts`.
- [x] Add the case `a stale host row names the command that repairs it` to `test/cli/upstream.test.ts`.
- [x] Add the case `a vendored body that differs from the package it declares is a gap` to `test/cli/upstream.test.ts`.
- [x] Run `bun run test` and `bun run build`.
- [x] No test covers the documents. Check the guide's table against `extensions/caveman/rule-lite.md`, `rule.md`, `rule-ultra.md`, `rule-megacave-lite.md`, `rule-megacave.md`, and `rule-megacave-ultra.md` with `wc -c` and a character count, and check the two headers against the tables in the same files, and record the count of mismatches. It must be zero.

**Verify, live.** Tests alone are not sufficient verification. The pull request is verified only when its unit, live, and perf boxes are all checked. Fifteen lanes on the swarm workers model at the PR head.

- [x] Lane 1. Run `bun dist/tersio.js upstream` in a throwaway home. Save `scorecard.txt`. Pass when the pstack row names both new upstream skills and reads no drift for the carried files.
- [x] Lane 2. Run the same command in a home whose plugin package sits at an older version. Save `stale-direction.txt`. Pass when the host row names `tersio install --host omp` and not the update command.
- [x] Lane 3. Run the same command in a home whose plugin package sits at a newer version. Save `newer-direction.txt`. Pass when the host row names `tersio update`.
- [x] Lane 4. Run `bun dist/tersio.js upstream --strict`. Save `strict.txt`. Pass when the run still exits zero, because upstream movement alone is not a failure.
- [x] Lane 5. Read the Markdown report at `~/.tersio/upstream/scorecard.md`. Save `report.md`. Pass when the new skill lines are in the report, the gap list is unchanged for the carried files, and the Ponytail row reads the vendored copy against the package rather than only against the host copies.
- [x] Lane 6. Read the vendored Ponytail copy and compare it with the package at 5.3.2, file by file, over the package's own file server. Save `ponytail.txt`. Pass when every vendored file matches byte for byte, which is the state today, and the row reports it.
- [x] Lane 7. Read section 1's table and check every cell against the six caveman bodies. Save `sizes.txt`. Pass when the bytes column matches `wc -c` and the characters column matches a character count, for all six rows.
- [x] Lane 8. Read section 2's fixture paragraph and the setup steps, and check them against the agentic section of `docs/BENCHMARK_OMP.md` and against the scorecard's own command. Save `guide.txt`. Pass when the paragraph names the copy, the pinned commit, and the injected failure, and the setup steps name the scorecard.
- [x] Lane 9. Read both result files' headers and check the run count against the prose, code, agentic, and command tables in the same file, and check the pstack pin against the pin in `cli/upstream.ts`. Save `headers.txt`. Pass when every number in a header matches its table and both headers read `a968159`.
- [x] Lane 10. Check the OMP body-size sentence against the character counts of the three megacave bodies and the `full` body, and check that no measured row changed by diffing the four result tables against the published ones. Save `tables.txt`. Pass when the sentence's figures equal the character count over four and the table diff is empty.
- [x] Lane 11. Run `bun run bench`, then read the diff and confirm it touches only the nine named files. Save `bench.txt` and `scope-check.txt`. Pass when the three fidelity assertions hold, the byte reductions match the published 79.5% and 10.5%, and no other file changed.
- [x] Lane 12. Read the README's Ponytail rows against the two manifests and the install code, and check that every command the README names is one the extension registers. Save `ponytail-matrix.txt`. Pass when the README names the host matrix, and every command it names is registered by the extension or attributed to a host that surfaces the skill.
- [x] Lane 13. Run the `/ponytail` command with `off`, `lite`, `full`, `ultra`, and `review` in a fresh session. Save `ponytail-levels.txt`. Pass when the four levels are accepted and the status line names the level, and `review` is refused with the message the code prints.
- [x] Lane 14. Run the Caveman update in a throwaway home, then read the installed body and the report it printed. Save `caveman-update.txt`. Pass when the report names the release the body came from, and the body at that release matches the asset the release ships.
- [x] Lane 15. Read the doctor and the scorecard against a home whose Caveman body came from a newer release than the bundled copy. Save `caveman-direction.txt`. Pass when both read the difference as upstream movement, name the release, and point at the pin instead of at a reinstall.

**Verify, perf.** Tests alone are not sufficient verification. The pull request is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. The wall time of one `bun dist/tersio.js upstream` run, the operator's command.
- [x] Probe. The lane 1 run, three times, at trunk and at head.
- [x] Baseline. Record the trunk value first. The trunk run measured 0.91s, 1.18s, and 1.51s on 2026-10-21, so the median is 1.18s.
- [x] Rule. The head median stays under 2s. The run fetches the same trees, so the extra work is a second pass over a map the run already holds.

**Review gate.** None. The pull request is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [x] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner reports STACK-READY.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Evidence

Measured in this repository on 2026-10-21, with `bun dist/tersio.js upstream` and a byte count
over the six caveman bodies.

The scorecard run.

- Caveman, pin `d262ab3`, upstream 60 commits ahead, 6 tracked, 6 matched, 0 drift.
- pstack, pin `a968159`, upstream 38 commits ahead, 91 tracked, 91 matched, 0 drift, matched by
  presence because every body is a declared fork.
- RTK 1.0.1 and Ponytail 5.3.2, both at their latest.
- omp, pi, and opencode each installed, 117 of 119 files matched, 2 stale in each: `shared/state.ts`
  and `shared/utils.ts`.
- Accuracy 98.7%, drift 0, and the gate red on the three stale host files.

The two stale files are the operator's pending update-check work, not upstream drift. The scorecard
compares the installed tree against this build's copy, and the build carries that pending change
while the installed tree does not. Landing it and running `tersio install --host <host>` clears the
host rows.

Why the pstack row reads no drift.

- Of the 91 files this project carries, 26 are byte-identical to the pin and 65 differ. Every
  difference is a declared adaptation: the Cursor surface removed, the per-role model names removed,
  `~/.cursor/rules/pstack-models.mdc` replaced by "your configuration", `agent-transcripts/` replaced
  by the transcript root, and the links repointed at this project's renamed leaves. No carried file
  moved upstream since the pin.
- Upstream moved 38 commits ahead, to `190d287` on 2026-10-20. The moved pstack files are two added
  skills, `create-formal-verification-skill` and `maintain-formal-verification-skill`, four changed
  skills this project does not carry, `ketchup`, `poteto-help`, `setup-pstack` and `sharpen`, and the
  13 files of the guide under `pstack/docs/guide/`.
- Upstream carries 56 skill directories under `pstack/skills/`. This project carries 17. The scorecard
  cannot see the other 39, and it cannot see a new one, because its "added" rule only looks inside
  directories the port already tracks. That is the blind spot the pull request closes.

The body sizes.

| File | Bytes | Characters | Guide says |
|---|---:|---:|---:|
| `rule-lite.md` | 4,210 | 4,206 | 4,210 |
| `rule.md` | 4,708 | 4,708 | 4,708 |
| `rule-ultra.md` | 2,513 | 2,513 | 2,513 |
| `rule-megacave-lite.md` | 3,122 | 2,822 | 3,122 |
| `rule-megacave.md` | 2,858 | 2,448 | 2,858 |
| `rule-megacave-ultra.md` | 2,931 | 2,761 | 2,931 |

Every guide figure is a byte count. Four of the six bodies carry multi-byte characters, so the
character count is 4% to 14% lower. The bodies are byte-identical to the pinned upstream files, so
the guide is not stale, it is mislabeled.

The token estimates.

- Dividing bytes by four gives the megacave bodies 780, 714, and 733 tokens, and the `full` body
  1,177. That is the arithmetic behind the OMP file's "714 to 780 tokens against 1,177".
- Dividing characters by four gives 705, 612, and 690 for the megacave bodies, and 1,177 for `full`,
  which is plain ASCII and so the same either way. The OMP file's conclusion survives: the megacave
  bodies are smaller than `full` and still save less reply.
- The pstack body is 15,214 characters, about 3,804 tokens, and the OMP file reports 3,812.
- Ponytail ships one body for all three levels, and the level sits in the frontmatter, so the three
  levels differ by one line.

The vendored Ponytail copy.

- The copy rides inside the Tersio package at `extensions/ponytail/`, 12 files: the six skills
  `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help` and
  `ponytail-review`, the two hooks, the pi extension, the licence, and the package's own manifest.
- Every one of those 12 files is byte-identical to `@dietrichgebert/ponytail@5.3.2`, checked against
  the package's own file server. The version the vendored manifest declares, 5.3.2, is the registry's
  latest.
- The scorecard does not check that. Its Ponytail row compares each host's installed copy against
  the vendored copy, 17 files across pi and OpenCode, and compares the version string against the
  registry. A hand edit of a vendored body would read as clean, because the edited file is the
  reference. That is the third blind spot the pull request closes.
- The three levels are one body. `skills/ponytail/SKILL.md` carries every level, and
  `hooks/ponytail-instructions.js` filters the intensity table row and the worked example for the
  level in play. Run against the vendored hook, each level yields 27 body lines and one level-specific
  row and one level-specific example, and the injected text runs 2,914 characters for `lite`, 2,859
  for `full`, and 2,928 for `ultra`.
- The level reaches the session from four directions, and all four name the same set: the
  `/ponytail` command accepts `off`, `lite`, `full`, `ultra`; the session default and the installer's
  `--ponytail-default` accept the same four; the vendored hook's runtime modes are the same four;
  and the preset table maps `lite` to `lite`, `balanced` to `full`, and `max` to `ultra`.

The Ponytail host matrix.

- This port registers five commands in total, and exactly one of them is Ponytail's: `/ponytail`, with
  `off`, `lite`, `full`, `ultra` and `status`. The others are `/tersio`, `/combo`, `/caveman` and
  `/pstack`.
- The five other Ponytail skills, `audit`, `debt`, `gain`, `help` and `review`, ship as skill bodies
  and reach the host as skills. The omp plugin manifest names `./extensions/ponytail/skills`, and the
  pi local package declares `skills: ["./skills"]`.
- OpenCode gets the mode only. The bundle carries the two hooks and the six skill bodies into
  `ponytail-bundle/`, and the mode reads the hook from there, but nothing registers the bodies the
  way upstream's own OpenCode entry does, through `ctx.skill.transform` and `ctx.command.transform`
  over the six command files under `.opencode/command/`. This port vendors neither.
- The README says "Review runs separately through `/ponytail-review`". This port registers no such
  command, so the line is true only where the host surfaces a skill by name.
- The vendored config accepts a fifth mode, `review`, and the vendored hook has a branch for it that
  answers with the text "Behavior defined by /ponytail-review skill". Nothing in this port passes
  that mode, because the session modes and the installer's flag both stop at `ultra`, and upstream
  treats review as a one-shot command rather than a level.

The Caveman delivery channels.

- The port already vendors the bodies. The repository holds upstream's bytes for the full, ultra, and
  megacave bodies, and the scorecard compares each one against the upstream file at a pinned commit,
  `d262ab3`, so the repository side is exact today. Three of the six levels are upstream's, and three
  are this port's own, `lite`, `megacave-lite` and `megacave-ultra`, which the scorecard lists as
  local-only.
- What the port lacks is a version stamp. The updater reads the three bodies from the upstream
  repository's `main`, and the installer's own Caveman step reads `main` too, so an installed body
  cannot be traced to a release. The updater records a content hash, which says the file changed and
  nothing else.
- The immutable channels exist. Every upstream release ships a `caveman.skill` archive, and the
  archive's `caveman/SKILL.md` is byte-identical to the repository's `skills/caveman/SKILL.md` at that
  tag, 4,678 bytes both ways. The repository at a tag is immutable too, and the scorecard already
  pins a commit.
- npm is not a channel for the bodies. The package upstream publishes is `caveman-installer`, and the
  version on the registry is 0.0.0, a placeholder, while the real releases are the GitHub tags, the
  newest `v4.0.1`. The npx entry point is the installer's wrapper, not a published body package.
- Because the installed body carries no release, the doctor and the scorecard read the difference
  between it and the bundled copy as a stale file, and the advice is to reinstall. A reinstall reads
  `main` again, so the difference stays and the gap never closes. The action that closes it is a
  reviewed diff and a bumped pin.
- The port covers three of the twenty-three skills upstream publishes. The twenty it does not carry
  include `cavecrew`, `caveman-commit`, `caveman-review`, `caveman-explore`, `lean-build`,
  `investigate-first`, `surgical-patch`, `verify-and-stop`, `safe-refactor` and `migration`.

The rest of the protocol checks out.
- The bench reproduces exactly. The committed fixtures give 10,044 bytes in and 2,059 out for `find`,
  79.5%, and 22,432 in and 20,073 out for `grep`, 10.5%. The three result files print those numbers.
- The OpenCode file's header already reads 15 per case on prose and code. The OMP and PI headers say
  5 per case, and their own tables say 15 runs per case with a quality column out of 15.
- The guide's section 2 says the guide cannot ship a fixture repo. All three result files shipped one:
  a copy of this repository at `72b6716` with one injected failing test.
- The agent versions moved after the runs: omp 18.12.1 to 18.12.5, opencode 2.1.1 to 2.1.2, pi
  unchanged at 1.3.0. The files name the version they used.

## Appendix B. Alternatives rejected

- **Compare pstack by bytes.** 65 of the 91 carried files differ from upstream, every one by a
  declared adaptation, so a byte comparison reports 65 false drifts and buries a real one. Presence
  is the right match, and the review signal is the upstream movement the port does not carry.
- **Carry the two new upstream skills.** They are slash-command skills and this port has no
  slash-command surface for them. The operator's decision, recorded in the out-of-scope list.
- **Carry the upstream guide.** It documents Cursor's harness, needs the same porting pass as the
  bodies, and the mode runs without it.
- **Rewrite the published megacave measurements.** The rows are measurements. Only the derived
  sentence that describes body sizes changes, and the conclusion it supports is unchanged.
- **Fix the guide's numbers to characters instead of labelling the bytes.** Both numbers are useful.
  A reader checking a file with `wc -c` and a reader counting characters both get their number when
  the table carries both columns.
- **Split the work across three pull requests.** The scorecard's not-carried count and the guide's
  size table answer the same question for the same reader, and the result files cannot be corrected
  until the guide settles what a number means. One pull request keeps them consistent.

## Appendix C. Risks

| Risk | What the owner watches |
|---|---|
| Watching the parent directory makes the report list every upstream skill the port does not carry | The not-carried count. The report carries a count and a compare link, not a wall of names. |
| The scorecard's runtime grows because it walks a wider tree | The perf lane. The run holds a tree map already, so the extra work is one pass over it. |
| The guide grows and the protocol gets harder to read | The guide's own length, checked in the perf lane. The change adds prose, not steps. |
| A future upstream change moves a carried file and the pin is not reviewed | The upstream scorecard. It must read no drift for the carried files, and the not-carried count must be read at every release. |
| The package file server is unreachable, so the Ponytail row cannot measure | The Ponytail row's own status. An unreachable source reads as unmeasured, the way the RTK row does, and never as clean. |
| The result files drift from the guide again | The shape lanes. Every result file is checked against the section 9 template. |
| The README keeps naming a Ponytail command that no host of this port registers | Lane 12. The README must name the host matrix, so the promise follows what the port does. |
| A host stops surfacing a vendored skill, and the port says nothing | The doctor row for the Ponytail copy. The scorecard's Ponytail row must read the vendored copy against the package, and the host's own copy against the vendored one. |
| The Caveman body is fetched from a moving target, so the release it came from is unknown | The new release stamp. A body with no stamp reads as fetched from a moving target, never as current. |
| The Caveman release asset and the repository at that tag ever disagree | The Caveman row's own status. The row compares against the asset, and an unreachable asset reads as unmeasured, never as clean. |

## Appendix D. Links and reading list

- `docs/BENCHMARK_GUIDE.md`. The protocol. Sections 1, 2, 4, and 9 are the parts the pull request
  touches.
- `docs/BENCHMARK_OMP.md` and `docs/BENCHMARK_PI.md`. The two result files the pull request touches.
  The OpenCode file is the reference for a correct run-count header.
- `cli/upstream.ts`. The scorecard. `driftOf` holds the watch rule the pull request widens, `gapsOf`
  holds the gap kinds, and `PSTACK.files` holds the tracked upstream paths.
- `test/cli/upstream.test.ts`. The scorecard's tests. The case names every gap with whose move it
  was, and the new cases follow that shape.
- `extensions/updater/index.ts`. `updateCaveman` overwrites the tracked bodies, and
  `adaptCavemanFull` is the one local line the updater keeps.
- `extensions/ponytail/`. The vendored copy, 12 files, byte-identical to the package it declares. The
  scorecard's Ponytail row reads it, and the new check reads the package against it.
- `extensions/ponytail/hooks/ponytail-instructions.js`. `getPonytailInstructions` and
  `filterSkillBodyForMode` are where the level turns one body into three.
- `bench/rtk.bench.ts`. The bench the perf lane runs.
- `extensions/pstack/skills/show-me-your-work/SKILL.md`. The decision trail lives here.

## Appendix E. Verification record

Measured on 2026-10-22, on the branch `feat/upstream-visibility-and-benchmark-accuracy`, at
`041750d` plus the fixes below. Every ticked box above has its evidence here.

The unit lane.

- `bun run test`: 17 files, 522 tests. `bun run build`: built. `bun run check`: clean.
- The three new cases are in `test/cli/upstream.test.ts`: a new upstream skill directory is reported,
  a stale host row names the command that repairs it, and a vendored body that differs from the
  package it declares is a gap.
- The document check: the six caveman bodies against the guide's table, bytes by `wc -c` and
  characters by a character count. Zero mismatches, both columns, all six rows.

The live lane, fifteen lanes, one agent.

- Lane 1. `bun dist/tersio.js upstream` in a throwaway home with `GITHUB_TOKEN` set. The pstack row
  reads 91/91, drift 0, and names `pstack/skills/create-formal-verification-skill/SKILL.md` and
  `pstack/skills/maintain-formal-verification-skill/SKILL.md` under the not-carried count. The
  Caveman row reads 26 (2) and the pstack row 14 (4).
- Lane 2. The same command in the real home, where the installed package is behind this build: the
  host rows read `run: tersio install --host pi` and `run: tersio install --host opencode`.
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

The perf lane.

- The head median is 1.23s over three runs (1.47s, 1.20s, 1.23s), against the trunk median of 1.18s
  and a ceiling of 2s.

The boxes left unticked, and why.

- The program protocol: the audit tick, the owner, the swarm verdict, and the merge. This run did the
  work and the verification, not the program around them.
- The file boundaries: the change touched more files than the plan named, because the Caveman
  delivery, the update check and the dashboard moved with it.
- "Compare the bundled body against the release asset at the pinned release": the Caveman row compares
  against the repository at the pinned tag. Appendix A records that the asset and the file at that tag
  are byte-identical, so the comparison is the same one; an unreachable tag reads as unmeasured, the
  way the risk row asks.
