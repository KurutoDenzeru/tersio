## Unreleased

### Added
- **Codex slash commands.** `tersio install --host codex` now writes `/combo`, `/caveman`, `/rtk`, `/ponytail`, `/pstack`, and `/tersio` to `~/.codex/prompts/`. Each one sets its mode from the level you type after it, and `/caveman status` reports one value. The installer also adds a plugin-scoped MCP approval policy, so `tersio_modes` works in a session that cannot prompt for approval. A new `tersio modes <mode> <level>` command reads or writes the same defaults.
- **Full Codex command parity.** `/combo help`, `/rtk enable|disable|true|false`, every legacy `wenyan` caveman spelling, `/tersio help`, `/tersio upstream [--offline]`, and `/tersio update <target> [--dry-run]` now work in Codex. The dashboard Quick start lists all six commands, the restart step, and the `/hooks` trust step.
- **`rtk_run` MCP tool.** Codex can run an explicit command through rtk when RTK mode is on, and run it plainly when RTK mode is off.
- **Codex stop phrases.** `stop caveman`, `stop ponytail`, and `normal mode` now clear the stored defaults, so the next prompt block does not keep a stopped mode active.
- **Codex install checks.** `tersio doctor` reports missing slash commands and a missing MCP approval policy. `tersio update --host codex` rewrites both, and uninstall removes only Tersio's approval table.
 - A **`tersio mcp`** command. It starts a small server that any MCP-capable app can talk to, so an agent can answer "what did my sessions cost", read what Tersio changed, and switch modes, without opening the dashboard: a Combo preset in one call, or any single mode (caveman, rtk, ponytail, pstack) overriding its piece of the preset. Connect it by adding the `tersio` entry under `mcpServers` in the client's MCP settings; there is no port, token, or process to keep alive.
 - **Codex is a fourth host.** `tersio install --host codex` adds the Tersio repo marketplace and installs `tersio@tersio`. If that source is unavailable, it writes a self-contained plugin at `~/.tersio/codex-plugin/` and registers it through `~/.agents/plugins/marketplace.json`. The plugin has the Tersio MCP server, one `UserPromptSubmit` hook that keeps the stored modes active, and slash commands under `~/.codex/prompts/`.
 - Codex joins install, update, doctor, and uninstall. `tersio update --host codex` follows the installed layout, `tersio doctor --fix codex` repairs or enables the plugin, and the dashboard counts Codex sessions and labels them as Codex.
 - **Codex RTK hook.** A `PreToolUse` hook rewrites eligible shell calls through `rtk` before they run. It skips calls that already carry the `rtk` prefix, honours `RTK_DISABLED`, and only rewrites commands whose exit stays inside rtk's allow rules, so an uncovered command passes through untouched.
- **Codex on the Upstream page.** The Agents table now has a Codex row. It compares the installed plugin's bodies with this build's file set, so a missing file or a stale rule shows beside the other agents instead of leaving Codex out of the scorecard.
- **Install methods on Quick start.** A new card names each agent's own install command, including Codex's `codex plugin marketplace add` and `codex plugin add`, and the `/hooks` trust step.
 - The repository marketplace is at `.agents/plugins/marketplace.json`. The shipped plugin is at `plugins/tersio/`.

### Fixed
- Invoking a Codex slash command no longer pastes a wall of text. Each prompt body is now one command line plus a short read of `status` and `help`; the CLI owns the alias mapping, so the body passes `$1` through unchanged.
- The Codex plugin ships one icon and no skills. The picker shows only the six slash prompts, so the skill rows that duplicated them are gone; the manifest points `composerIcon` and `logo` at the single scissors `assets/icon.png`. The plugin presents the GitHub project description and three starter prompts.
- The README and the dashboard Quick start offer each host's own install method for Codex: `codex plugin marketplace add KurutoDenzeru/tersio` then `codex plugin add tersio@tersio`, with Ponytail's plugin named for the workflow skills.
- The Codex personal marketplace registers as `tersio` instead of `tersio-personal`. An existing registration under the old name migrates on the next install or update, which removes the stale `tersio@tersio-personal` plugin entry.
- `normal mode` now turns pstack off in Codex, matching the pstack rule text and the omp host. Only caveman and ponytail reacted before.
- `tersio doctor` warns when a marketplace-layout Codex plugin has no `tersio` CLI on PATH. That layout's hooks and MCP server exec the CLI, so a missing binary silently disabled both.
- The doctor and upstream checks now verify every pstack leaf (`principles/`, `playbooks/`, `skills/`, `references/`) the bundled Codex plugin copies, instead of only `rule.md`.
- The OMP warning `Extension does not export a valid factory function` for `extensions/updater/index.ts` is gone. Removing the dead `/ai-addons` command left the updater without a default factory while the manifest still declared the file as an extension entry, and that entry also failed a fresh `omp plugin install`'s factory validation.
- `tersio modes <mode>` now reads the current state instead of failing with "needs a level". The Codex slash commands use that form for `/combo status`, `/caveman status`, and the other status values.
- `tersio doctor` now names rtk's standalone `rtk init -g --codex` hook. That hook bypasses `/rtk off`, so Tersio reports the duplicate and keeps its own mode-aware plugin hook.
- A Codex mode switch no longer fails with "MCP tool call requires approval" when approvals are off. The slash commands run the CLI, and the installer pre-approves only Tersio's own MCP server.
- A Codex row reads its model's own author. `codex/openai/zcode/glm-5.3-flash` shows "Z.ai - GLM-5.3-Flash" with the Z.ai mark; it used to borrow OpenAI's name and mark from the host prefix.
- The dashboard draws Codex's own mark in its provider tiles and on the Upstream page. The tile showed a "C" monogram, which read as a different product from the Codex logo on Quick start.
 - A plugin hook block appears once per Codex turn. One `UserPromptSubmit` hook owns the mode context, so startup and resume do not add a second block.
 - The dashboard now fills Codex rows with tool calls, elapsed time, and first-token latency. It read the Codex transcript's token rows only, so tool pages showed no calls and request rows read `d: null`.
 - The update check probes the Codex plugin tree when no OMP package exists, so a Codex-only install no longer reports "Caveman rule: unknown" or "Ponytail: missing → bundled reinstall".
 - `tersio doctor` reads a missing price cache as a warning with the fallback table in place, not a missing feed. It no longer shows the stale "no installed host exposes an exec API" warning on a Codex-only install, because Codex calls `rtk` from bash through the hook.
 - The update check now names the Caveman rule's release version on both sides of a jump, the one installed and the one offered, instead of a code fingerprint. It reads the same record the doctor and the dashboard use.
 - The update check no longer reports the bundled Ponytail as missing. It looked for the separate package an older install carried, so every update claimed to reinstall it and listed it as a change even when nothing changed.

## v2.25.14

### Added
 - A **Logs** page in the dashboard's Developer group. It records what Tersio changes on this machine, newest first: mode and preset switches, installs, updates, and removals with their exit state, every file the installer rewrites, and doctor checks and repairs. The CLI and the dashboard write the same `~/.tersio/activity.jsonl`, so a terminal install shows up there too; the file keeps the last 4000 entries and the page rereads it while open.
- A **Quick start** page in the dashboard, first in the rail. It draws the pipeline as one canvas: the three agents loading the same extensions, the four prompt blocks in injection order, then one output node for the whole turn. Each agent node opens its own menu with Update, Install, and Uninstall, and a dashed slot under the agents offers only the agents this machine is missing; an uninstalled agent leaves the canvas, and the slot goes when there is nothing left to add. The Combo preset sits centred against the agent column. The canvas scales to the card width and picks one of three layouts (wide, tablet, phone), so the diagram is drawn at every size instead of being replaced by a list. It reads this machine's settings and installed hosts, so a mode that is off or an agent that is not installed draws dimmed, and an active connector carries a travelling dash. Clicking a node opens a menu beside it with its role and the command that changes it, a mode switches to any of its levels from that menu, and the canvas pans and zooms. It reads no usage store, so it paints before any snapshot arrives and costs no query.

### Removed
 - Three slash commands nobody used: `/ai-addons`, `/tersio usage`, and `/tersio check`. `/tersio update` still refreshes the add-ons, the dashboard still shows the ledger, and `tersio doctor` still runs the health check. The updater keeps its code behind `/tersio update`; only the duplicate command entries are gone.
 - The MCP server's HTTP transport and its config writer. The server speaks stdio only now: a client starts `tersio mcp` itself, so there is no port to open, no token to copy, and no config for Tersio to write.

### Changed
 - The dashboard now remembers the accent color and the rail width you pick. Both survive a restart and a different browser, because Tersio stores them with your other settings instead of leaving them in the browser.
 - The rail, the mode banner, the Quick start canvas, and the Logs page show a placeholder while they load. A fast disk read settles first, so the placeholder never flickers.
 - The share card fits its content. The calendar card is shorter, so its figures sit nearer the calendar.
 - The rail reads "Tersio Dashboard" instead of "Tersio stats", and its first group is named "Setup".
 - The Quick start canvas moves with its state. An agent that joins or leaves slides the column into place, a mode switch fades its node and pulses its ring, and a connector fades as it lights or dims.
 - The Settings dialog no longer carries a Connection pane. Each agent's CLI version now shows on its node in the pipeline, and no file path is drawn.
 - `tersio update` now asks which agent to refresh. It used to default to Oh My Pi and never ask, so an update on a pi or OpenCode machine refreshed the wrong tree while the help said a terminal asks. `--host` still pins the agent, and `--yes` keeps the old default for scripts.
 - pstack is now opt-in, and no Combo preset turns it on. A preset sets Caveman, RTK, and Ponytail, and leaves pstack where you had it. This makes the preset cheaper for anyone who does not want the rigor mode, and lets you keep pstack on across a preset change. Set it on its own with `/pstack on` or the pstack row in Settings, which stays editable while a preset is active.
 - One host derivation replaces three. `isPiHost` tested for a missing zod factory, which is also true on OpenCode, so it answered `pi` there while the adapter table answered `opencode`. Every predicate and adapter now reads the same function, and `isOpencodeHost` is new.
 - Each host adapter now names the session events it emits, so a mode loops over that list instead of hard-coding five event names. OpenCode emits none of them, and its dead handler registrations are gone.

### Fixed
 - Provider and vendor logos are now saved on your machine the first time they load. The dashboard used to request them from the internet on every visit, so a slow answer left an empty tile and every icon downloaded again each time. A logo that cannot load now shows the provider's first letter instead of a blank square.
 - Some logos came back blank because Tersio assumed every logo was the same file type. It now handles every type these sites use, including the ones a host converts on the way, so the icon always matches its actual file.
 - `tersio update` run from a source checkout applies the update with that checkout. It delegated to the published package, which cannot carry unshipped changes, so an update in progress failed with `Unknown command: pi`. The global install is skipped there too, because it would replace the tree the checkout lives in.
 - `tersio update --host <agent>` failed with `Unknown command: omp`. The command reader treated a flag's value as the command name, so the inner run the update delegates to printed the help text and exited 1. A flag's value is skipped now, and a test covers the delegated form.
 - The caveman row in Settings offers the retired Wenyan names, and the CLI rejects them: picking one failed with `unknown caveman level`. The row names the Megacave levels now, which is what the mode banner has shown since the rename.
 - Update picks the right package manager when `HOME` itself is a symlink. The running copy was resolved but the `~/.bun` prefix was not, so a bun install under a symlinked home was refreshed through npm. Both sides now resolve the same way.
 - Updating no longer loops when the command is a symlink. The bin at `~/.bun/bin/tersio` points into the bun global tree, and the update read the link's own path, so it still chose npm and the loop survived. It now resolves the link first.
 - The RTK shell hook registers only on a host that emits `tool_call` and `tool_result`. OpenCode drives its own tool hooks, so the shared filter registered two handlers there that could never fire.

## v2.25.13

### Fixed
 - Update picks the right package manager when `HOME` itself is a symlink. The running copy was resolved but the `~/.bun` prefix was not, so a bun install under a symlinked home was refreshed through npm. Both sides now resolve the same way.
 - Updating no longer loops when the command is a symlink. The bin at `~/.bun/bin/tersio` points into the bun global tree, and the update read the link's own path, so it still chose npm and the loop survived. It now resolves the link first.

## v2.25.12

### Fixed
 - Updating no longer loops. If you installed Tersio with bun, `tersio update` refreshed the npm copy instead, so the old version stayed on your path and offered the same update every time. It now refreshes whichever copy is running, and says which one it used.
 - The closing line names your agent instead of always saying OMP. Tersio installs into OMP, pi, and OpenCode, so the uninstall message now names the one you removed.

## v2.25.11

### Changed
 - Benchmarks no longer fill your chat history. A run used to open a new chat for every single try, so one full benchmark left hundreds of them. The whole run now happens in one chat, and the chat is reset between tries so each one still starts fresh. The benchmark guide explains how.
 - The pstack mode ships one more skill, the TypeScript one. It is the only upstream skill that does not need a special command or Cursor, so it comes with its examples. The mode now points at it, because this app cannot trigger a skill by file type the way Cursor does.

### Fixed
 - Tersio now installs and starts on pi. pi could not find the app's list of extensions, so it tried to load every file in the folder and crashed on one meant for OpenCode. The app now says which files to load. Tested on the real package in a clean setup: the crash is gone, all eight extensions load, and the six Ponytail skills come with them. Thanks to @casperdcl, who found the missing `pi` key and sent the fix in #61.
 - Tersio now works on OpenCode without breaking your permissions. OpenCode decides what a command may do, and Tersio used to rewrite the command in a way that could let a blocked command through. It now asks OpenCode first and leaves the command alone when the answer is no. If your OpenCode is too old to ask, it falls back to the old behaviour.
 - Checking for updates no longer stops at npm. A release can now be found through GitHub as well, so a version that is tagged but not yet on npm is still offered.
 - `tersio update` now tells you what it did. The report it built was being thrown away, so you never saw which version your Caveman rules came from. It also works when GitHub limits anonymous requests.
 - The health check no longer hangs. It used to wait up to 30 seconds on one optional lookup, which made the whole check slow and unreliable. That lookup now gives up after 2.5 seconds.
 - The upstream scorecard now checks the files you actually ship. It reads the release archive for the Caveman rules, not just the repository, so a release whose archive disagrees with its source no longer reads as clean.
 - A stale install now tells you which way it is stale, and the exact command that fixes it.
 - The benchmark files now say what each number counts. Sizes are labelled in bytes and characters, run counts match the tables, and each result file names the rules and versions it measured.
 - The Windows test suite no longer fails on a busy machine. One test needed more time than it was given.

## v2.25.10

### Fixed
 - The npm package now matches the release. `2.25.9` was published without moving the `latest` tag, so `npm install` kept fetching `2.25.8`. This version carries every note under `2.25.9`, plus the bench, the gateway record, and the persisted Developer tools switch built after that tarball.
 - The OMP plugin package is pinned to the exact version of the CLI that manages it. A range let npm install a release the tree writer never wrote, so the tree held two and an extension failed to load with "Export named 'ruleDir' not found". The doctor names the mismatch; `tersio install --host omp` rewrites the tree.

## v2.25.9

### Added
 - `tersio upstream` scores the four modes Tersio ports against their upstream projects: what still matches, what moved, and how each installed agent compares. It also writes a Markdown report to `~/.tersio/upstream/`. The command stays out of `help`, because it is an engineering check.
 - The dashboard has an About pane: your version, the build in memory, Node, your platform, the RTK binary, the update controls, and the credits each mode came from.
 - Updates arrive as a notice with `Update now`, `Remind me later`, and `Skip this version`, and the check can run on a cadence you pick: off, daily, weekly, or monthly. `Check now` answers in well under a second.
 - Settings > About holds a `Developer tools` switch, and the dashboard's Sources page sits behind it: the scorecard as a radar over the four ports, a stacked bar per agent, and two dense tables. The rail keeps that page in a `Developer` category of its own, the item and the `g s` jump appear with the switch, and the route falls back to Overview while it is off.
 - The connection list and the Sources table name Claude Code and Codex as `Coming soon`, each with its own mark. Tersio installs into neither yet, so those rows carry no numbers.

### Changed
 - Ponytail ships inside Tersio now instead of as a second package, so a host lists one plugin instead of two. An install or `tersio doctor --fix ponytail` clears what an older install left, and the doctor and the scorecard compare every agent against the bundled copy.
 - The Tools page shows what RTK saved you: a tile, a table folded by leading verb with a `Show every command` toggle, and adoption named in the footer. Measured here: 62.6M B saved of 88.2M B taken in (71%), across 21,468 commands.
 - The By tool and model table filters with two pickers, one per column, so a typo cannot hide every row.
 - Settings shows a country flag beside each currency.
 - The Share usage card draws the GitHub contribution graph: 53 weeks, month and weekday labels, and the less/more legend. A page change animates in, 45ms apart per block, and holds still under reduced motion.
 - Charts read easier: a legend names each series' total after its label and how many series a folded group holds, every timeline lane carries a glyph for its kind, and transcript badges share one width.
 - The graphs and drawers follow your data more closely: the span drawer lists one flat field set, the request drawer drops its three least useful rows and reads `OpenAI` instead of an empty class, a tool span shows what the tool was told to do, and a bridged idle gap keeps its share of the axis. On this machine the largest gap reads 1.5% of the axis compressed and 81% uncompressed.
 - Snapshots are one file each, checked against their own hash before they count, and the pane reads `1K · 1 file` per row with a tooltip naming what it holds.
 - Four small state files fold into `~/.tersio/state.json`, and two files with no reader left are gone.
 - pstack moves to upstream `a968159` and Ponytail to 5.3.2. `docs/ARCHITECTURE.md` shows the order the modes run in, and the status line reads `🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON`.
 - Every Sources pin opens its upstream: a compare view for the two commit pins, and the release page for RTK and Ponytail, whose version pins carried no link. The page draws each agent with the same marks Settings uses, so Oh My Pi, pi, and OpenCode read as they do in the connection list.
 - The picker names its two plugin rows plainly: `Install plugin` and `Uninstall plugin`, where they read `Install add-ons` and `Uninstall`.
 - `tersio settings` is gone, and the session-start defaults, the display currency, and the diagnosis schedule are set in the dashboard, which already carried all three. The installer still takes `--combo-default`, `--caveman-default`, `--rtk-default`, `--ponytail-default`, and `--pstack-default`, so a scripted install keeps working. The `--diag-schedule` and `--subagent-marker` flags go with the command.
 - Reset statistics lives in the dashboard now: the Data pane names the rows a reset would clear and holds the button, and its confirmation is a dialog. The snapshot Restore and Delete confirmations are dialogs as well, naming the snapshot and the files at stake. `tersio reset` and its picker row are gone.
 - `docs/BENCHMARK_GUIDE.md` opens with a ten-minute quick run on your own repo, and the full protocol behind it is tighter: one results table per surface kind, six command rows, and the same fixed prompts, quality gates, and metrics.
 - The `medium` Combo preset is renamed `lite`, so the preset ladder reads `off`, `lite`, `balanced`, `max` and matches the Caveman and Ponytail levels it sets. A settings file or `--combo-default` written before the rename still resolves to `lite`, and `/combo medium` keeps working.

### Fixed
 - The Developer tools switch in Settings > About saves to `~/.tersio/settings.json`. It lived in browser storage, and the dashboard binds a new port each run, so the switch reset on every launch.
 - A request row reports the gateway the transcript named. A model served by Command Code now reads `commandcode` rather than the `deepseek` its model id implies, and rows written before the name was kept fall back to the model id. The store gained a `p` column, migrated in place.
 - The connection list and the Sources table draw Claude Code with its own mark in Claude's terracotta, and Codex with the Codex mark rather than the OpenAI knot.
 - Savings and scorecard numbers could read zero on a busy database, and a snapshot could miss rows still in flight or keep a damaged one. All three read the committed state now: on this machine a plain copy held 7,194 rows where the database held 7,207, and the prune pass reads six snapshots in 18 ms.
 - The Tools page shows real result sizes, call arguments, and error counts instead of zeros. Measured here: 711.1K result characters and 29 failed calls in 24 hours, where both read 0.
 - Settings left every mode row at its old level after you picked a Combo preset: each row updated only itself, while a preset writes all four. The dialog shows what was saved now.
 - A restore refuses a snapshot whose body fails its hash, and the live files stay untouched.

### Removed
 - `tersio reinstall` is gone. `tersio install --host <agent>` re-runs an install, and `tersio doctor` verifies one, so the command only wrapped those two with a menu the installer already shows.
 - `tersio usage` is gone from the CLI. The dashboard shows the same figures from the same store across ten pages, so the terminal report only duplicated them. The ledger, the price list, and the in-session `/tersio usage` summary stay.

## v2.25.8

### Added
 - Windows runs Tersio natively, installed through PowerShell. WSL stays an option, never a requirement.
 - The doctor reports your platform, architecture, Node version, rtk build, and the folders it resolved, so a failure names its own cause.

### Changed
 - The build needs no Unix shell any more, and every rule file ships once instead of twice.
 - CI runs the whole suite on Windows and macOS as well as Linux, and runs the linter for the first time.

### Fixed
 - Windows: condensing, the dashboard, the spend chart, the installer, the updater, the doctor, and the RTK wiring all work. Each of them quietly did nothing before.
 - Windows: folders resolve per platform, so your home and rtk's own data are found where they really are.
 - Windows: session rows carry the right host label, and a project name resolves under either path separator.
 - The RTK summary missed part of your pi and OpenCode work, and one busy host could hide a quiet one. Every host reports its own row now.
 - Ponytail never turned on in pi sessions and stayed off in headless runs. Both apply now.
 - Caveman's rule file refreshes when the upstream wording changes.
 - The pstack library named files it never shipped. It ships complete now, and a test rejects the old shapes.

## v2.25.7

### Added
 - Caveman `lite` is a real level now. It used to load `full`'s rules, so a light run cost the same and read the same body. Measured through the host: `lite` 1,062 tokens, `full` 1,187, `ultra` 638.
 - `megacave-lite` and `megacave-ultra` each have their own body. Both used to read the single full megacave body, so the lightest Classical Chinese level read like the heaviest. All six caveman levels read differently now.
 - The pstack rigor mode ships its whole library: 90 files of principles, playbooks, and skills. Only the main rules shipped before, so a pstack run was told to read files no install ever wrote.

### Changed
 - There is one benchmark guide now, at `docs/BENCHMARK_GUIDE.md`. The older duplicate is gone.

### Fixed
 - An omp install could skip one file, so an edit never reached your machine and the one command doctor named could not fix it. Both work now.
 - A clean install no longer leaves `.bak` copies beside the files it writes. It used to leave eight, and doctor counted them as debris.
 - The Ponytail fallback now uses Ponytail's own words for every level. `ultra` used to borrow `full`'s rules and lost the one rule that makes ultra ultra.
 - `rtk_run` runs your command even when RTK mode is off. It used to refuse, and with host tools off it was the only tool left, so the model spent turns re-calling it. With RTK on but no binary installed, it says so and names the fix.
 - The RTK guidance names the form that keeps failure details, `rtk bun run test`. A failing test still shows its name, its assertion, and its file and line.
 - A saved Ponytail setting and the Ponytail part of every Combo preset now apply in a headless run such as `omp -p`. Only an interactive session used to publish the state Ponytail reads.
 - `tersio settings --pstack-default on` counts now. The Combo preset's off used to win over it.
 - pstack's library arrived damaged from the port that produced it. Command arguments were stripped, some file paths were mangled into strings like "skillsthe swarm skill", and leftovers from another editor survived as `/loop` commands and `.cursor` paths. Every file now comes from the upstream source with that editor's surface removed, and a test rejects the mangled shapes.
 - Running the CLI from its source crashed before any command on Node 22.18 and newer. Type-only names sat in value export lists, which Node refuses. They now move through `export type`.
 - Three tests passed only on a machine with `rtk` installed, so CI failed while local runs looked clean. They run the same everywhere now.
 - The RTK adoption number used a short hardcoded command list, so it read too high in both directions: it counted commands rtk never rewrites and missed ones it does. The list now comes from rtk and refreshes when rtk updates.
 - The RTK adoption number never read OpenCode's storage, so OpenCode runs counted as neither eligible nor missed. All three hosts report into one number now.
 - The RTK guidance named five command families, so the model never learned the rest. It now names every rewritten family and adds the direct calls the rewrite cannot reach, such as `rtk read --level aggressive` for a large file and `rtk err` for failures only. Measured on this repo: an aggressive read cuts a source file by 66 to 76 percent, and `rtk err` cut a build log by 94 percent.

## v2.25.6

### Added
 - `tersio reinstall` is back: it lists the agents that have Tersio, asks which one to refresh, reinstalls it, and checks the result. `--host` skips the question.
 - Brand marks for the WorkBuddy and DeepSeek providers, and for Trae, Kiro, and Meituan. Each shows its own logo, so Kiro no longer uses the AWS mark and Meituan LongCat no longer shows a letter.
 - Logos have breathing room: a mark fills less of its tile, so no artwork touches the edge. One rule covers every size.
 - A new `/pstack` rigor mode, taken from pstack's `poteto-mode` skill (MIT, Lauren Tan). It is an adaptation for Tersio's hosts, not a copy, and it keeps only the rules Caveman and Ponytail do not already add. It covers how work is approached, checked, and designed, while Ponytail still decides how large a change is. Every Combo preset above `off` turns it on, and `tersio settings pstack` sets the default for new sessions. `tersio update` does not update it, because it is an adaptation.

### Changed
 - The bundled Ponytail moves to 5.2.0, the same version Tersio installs, so the pi and OpenCode copies no longer fall behind.
 - Every dashboard page now loads with a preview of its own layout — the stat strip, the chart cards, the table block, and the session trace — instead of two plain boxes.
 - These previews use the panel's own tone, so they read in the light theme too. Before this they nearly vanished there.
 - The status line now names all four modes: `🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA 🥔pstack=ON`. A preset sets all four, so the level reads `CUSTOM` only after you change one by hand. The dashboard and Settings show the same.

### Fixed
 - `tersio doctor` compared one Ponytail file per host, and two recent versions ship that file unchanged, so pi and OpenCode could fall behind with no warning. The row now compares everything Ponytail ships, names the file at fault, and points at `tersio install --host <host>`.
 - `tersio install --host omp` copied the mode files but not the list that loads them, so a mode added since the last release loaded nowhere. The install and `doctor --fix extensions` now write this build's own list, and the repair points at the right tool.
 - The RTK guidance named the wrong commands as condensed: it listed `npm` and `pnpm`, while rtk rewrites `npm run`, `pnpm run`, and `bun`, and leaves `npm test` and `npm install` alone. Each rewritten form is now named and tested.
 - The host footer showed the caveman mode twice. It now reads once, in the Combo line, and `/caveman status` answers with the mode.
 - The dashboard could not show first-token latency for pi or OpenCode, even when the data existed: pi never recorded it, OpenCode recorded it in a field nothing read, and the dashboard read the store without asking for that column. All three carry it now.
 - pi lost every RTK mode surface: the files were installed but could not be found, because pi needs a marker file that was missing. `/rtk`, `rtk_run`, the prompt block, and the search filters all load on pi now.
 - OpenCode lost five of its six Ponytail skills and `/ponytail`, because the bundle shipped one file where pi shipped six, and nothing registered them. All six ship now.
 - On OpenCode, `/rtk off` stopped the prompt text but not the command rewriting. Both read the mode now.
 - A Ponytail file path was declared through `node_modules`, which npm moves out of the package, so it never worked outside a checkout. Removed.
 - pi could fail to start on a leftover extension from an old version, which every install kept. A repair now removes the whole leftover directory, not just the files inside it.
 - `opencode service start` and `service restart` could fail, saying a port was in use, while `service status` said stopped: the service manager had lost track of its own background process. `tersio doctor` now reports this, and `doctor --fix service` stops the stray process and starts the service again.

## v2.25.5

### Added
 - A page-per-view dashboard: Overview, Models, Providers, Costs, Requests, Errors, Traces, Tools, Frustration, Projects, and Gain, each at its own web address.
 - A flamegraph trace page with a searchable span list, a legend, and a zoomable timeline, plus the same spans read out as a transcript.
 - A Data pane in Settings that snapshots everything Tersio keeps, lists the snapshots, and restores or deletes one. Both ask first and name the files involved.
 - Your own price list at `~/.tersio/prices.local.json`. One entry per model, or one entry starting with `*` to cover every gateway that resells it.
 - Brand marks ship inside the app, so no page fetches a logo at runtime and an exported file keeps its logos with the network off.

### Changed
 - Costs come from what the tool reported, instead of a public list that did not know most of the models in use. On this machine the old report said $373.49; the real figure is $71.23.
 - Models the price list does not know now read as an estimate rather than a fact, so a total that is partly a guess says so.
 - A subagent’s work reads apart from its root session, in both the usage report and the dashboard.
 - Extensions install into one tree instead of two, which was loading some of them twice.
 - The navbar shows the session-start modes and the three toggles, and a click opens Settings.

### Fixed
 - A free model reads as $0.00 instead of being billed at a default rate. About twenty free gateway models were affected.
 - A layout gap on the model page where one tile sat alone in a row with an empty space beside it.
 - A narrow window no longer overflows the top bar, and the rails and footers fit a phone.
 - Two flaky tests: one read a price cache that existed on the developer’s machine but nowhere in CI, and the other could be killed mid-fetch on a loaded machine.

### Removed
 - The cache savings figure, which read 0.0% for nearly every model because the data it needed was never recorded.

## v2.25.4
 - Fixes an OMP crash on prompt injection: a `systemPrompt` array holding a non-string no longer throws `undefined is not an object (evaluating 'part.includes')` in the Caveman and Combo extensions. Non-string parts are dropped before the marker check.
 - Stops the pi install test from failing whenever upstream publishes a new Caveman body: `rule.md` still ships byte for byte, the two upstream-tracked bodies are checked for a usable body with its floor rules.
 - Sandboxes `TERSIO_HOME` in the backup tests so the schedule default no longer depends on the machine's own `~/.tersio/settings.json`.

## v2.25.3
 - Interactive installs and `tersio settings` now ask only for the Combo preset; it sets Caveman, RTK, and Ponytail. Change one mode with `tersio settings caveman|rtk|ponytail` or a `--*-default` flag.
 - Rejects a fetched Caveman rule body that is an error page, a 404 or a stub, and keeps the bundled one; doctor warns on an unusable installed body. Each rule pack carries verify samples, so an upstream edit that drops core markers fails the suite.
 - States in `docs/BENCHMARK.md` that savings are eligible-only: clean output saves near zero, and that is the mode working.

## v2.25.2
 - Ships one Caveman rule body per register instead of one shared body: ultra reads the upstream ultracave skill and wenyan reads megacave, so levels stop costing the same 1659 tokens and ultra and wenyan get their own rules.
 - Tracks only the upstream Caveman bodies in the updater and doctor: `rule.md` ships with the package, repair fills in missing bodies without overwriting newer fetches, and uninstall clears all three backups.
 - Names the OpenCode plugin `@krtclcdy/tersio` and folds the rtk bash rewrite into it, so the plugin list shows one entry; install and doctor repair remove the redundant standalone rtk entry.
 - Keeps stored per-mode defaults across installs and updates: only an explicitly chosen combo preset rewrites them.
 - Ships Ponytail to pi as a local package instead of an npm spec, so pi stops nagging about package updates; uninstall removes the directory and its settings entry.
 - Trims the benchmark protocol to tokens and time, dropping the unused cost, steps, and break-even axes.
 - Skips the update-check spinner under CI, where its stop newline pushed the welcome tips off a 20-row terminal.
 - Closes the dashboard server on Ctrl-C before Tersio exits, so its local port is released.
 - Update completion no longer tells users to restart a host after all add-ons refresh.
 - New sessions now restore the persisted Combo default without an empty branch status reset.
 - Compiles TypeScript into `dist/` instead of beside each source, so `bun run build` leaves no `.js` twins in `cli/` or `extensions/`; `bun run clean` now just removes `dist/` and `dashboard/dist/`. The published tarball still carries both the compiled `.js` runtime and the `.ts` sources OMP loads.

## v2.25.1
 - Removes rtk's OpenCode plugin alongside the tree on `tersio uninstall --host opencode`, so no broken hook file is left behind.

## v2.25.0
 - Adds OpenCode as a host: `tersio install --host opencode` copies the extension tree to `~/.config/opencode/plugins/tersio` and registers it in `opencode.json`; `/combo`, `/caveman`, `/rtk`, `/tersio`, mode instruction injection, and the `rtk_run` tool ride a thin mapping (`extensions/opencode/server.ts`) from the plugin API onto the shared `ExtensionApi`. Doctor checks the plugin entry and repairs it on `--fix`; uninstall removes the tree and the config entry. The dashboard shows OpenCode rows with its own logo, host label, and a Connection-pane entry.
 - Removes Codex records from the usage ledger: the store and importer no longer scan `~/.codex/sessions`.
 - Guards usage.db migrations: a re-parse that keeps less than half the rows restores the pre-migration backup instead of publishing the loss (override with TERSIO_FORCE_REPARSE=1), and every sqlite write runs with -bail so a failed statement can never leave half a transaction behind.
 - Shrinks usage.db: message rows key the transcript by id instead of repeating its path, and migrations VACUUM the file (6.3MB to 1.3MB at 10k rows).
 - Adds a Backup now button to the dashboard snapshots card (POST /backups/create) for one-tap manual backups.
 - Folds provider-prefixed keys into vendor-first labels ("Anthropic - Claude - Haiku-4.5"); the recent-requests window grows from 200 to 2000 rows while aggregates keep full lifetime history.
 - Merges same-model gateway rows into one ("OpenAI - GPT-5.2-Codex" once, priced per gateway then summed); adds xAI/Grok, Alibaba/Qwen, and InclusionAI vendors with brandmarks.
 - Capitalizes model labels once (GPT/SWE stay all-caps) and leaves folded labels untouched on second pass.
 - Fixes stuck model hover cards: leaving a card always dismisses its tip instead of freezing it after a click.
 - Adds a request detail drawer to Recent requests with copy/download JSON.
 - Records message ids end to end (transcript row id, opencode msg file) into a new usage.db column, migrated in place; headers and gateway metadata cannot be captured locally.
 - Moves the agent mark off the request drawer header onto its Agent row, and drops the Speed row and the unrecorded-data footnote.
 - Replies visibly to OpenCode slash commands instead of answering blank, and keeps the opencode tree out of pi/omp extension dirs.
 - Replaces the Models share and Tools impact progress bars with one horizontal shadcn chart cell.
 - Restores the combo status on the host footer bar: `🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA` now paints via `ui.setStatus` on every mode command and session event, instead of a one-shot notify message.
 - Fixes subagent inheritance for Caveman and RTK: the OMP subagent marker now matches the host's real prompt, so a worker no longer runs with both modes silently off. Doctor scans the omp binary and warns when the marker drifts, and `tersio settings markers` overrides it.
 - Lets `rtk_run` fall back to shared state, so a subagent spawned after a mode switch can still use the tool.
 - Lets a Ponytail level switch take effect; the dedupe guard matched a level-agnostic phrase, so `/combo` changes were ignored for the rest of the session.
 - Execs the resolved rtk path in `rtk_run`, so it starts on a host whose PATH lacks `~/.bun/bin`.
 - Adds a `markers` setting and a repeatable `--subagent-marker` flag, and an `RTK exec` doctor row for hosts that cannot run the tool.
 - Fixes the Models table on narrow dashboards: columns size to their content, and the table scrolls as one unit below 640px instead of crushing the model name.
 - Replaces the Models table's Last run / Last 20 runs columns with a shadcn Progress share bar, so the table fits without horizontal scroll on most panels.
 - Removes the Agents panel from the model detail dialog.
 - Fixes pricing for provider-prefixed model ids: "codex/openai/gpt-6-luna" and similar now match their cached price by tail segment instead of the default, so OpenAI and Claude rows report the real rate.
 - Fixes OpenCode usage gaps: sqlite reads allow 50MB (a busy `session_message` table cleared the 1MB cap and silently dropped), writes flush under the Linux argv limit, and MiniMax/Gemma labels read family-first with `space-bunny-alpha` folded onto the free row.
 - Wires RTK into every host at install: `rtk init -g --agent omp`, `--agent pi`, and `--opencode` each run for their target, with doctor rows and fail-open `--fix` repairs.
 - Restores modes per OpenCode session instead of once at server start, so a change in one session no longer leaks into the next.
 - Bundles the full Ponytail ruleset beside the OpenCode tree (no node_modules there); `tersio update --host` refreshes one agent, and `opencode plugin add @krtclcdy/tersio` installs host-side via the new `exports["./server"]` entry.
 - Trims doctor to one line per host (`package/extensions @krtclcdy/tersio <version>`), drops the one-off rows, and shows each agent's config dir in the dashboard Connection pane.
 - Replaces the sticky status banner with a status message: combo state paints in the menu title and serves read-only at GET /status for the dashboard.
 - Fixes subagent mode inheritance: the correct OMP marker, shared-state `rtk_run`, effective Ponytail switches, kept worker state, a `markers` setting with repeatable `--subagent-marker`, resolved-binary exec, and doctor verification against the host binary.
 - Turns BENCHMARK.md into a rerunnable protocol and records the subagent fixes with their standing limitations.
 - Renders Models as a table with last-run age and run bars, and shows which agents ran each model with OpenCode counted as its own host.
 - Injects the full upstream Caveman rule at every level and lets the upstream pi-extension own Ponytail injection on pi.
 - Hardens the installer: refuses RTK binaries with unverifiable checksums, resolves home from HOME, and verifies the whole extension tree.
 - Fetches and installs Ponytail updates from npm in `/ai-addons`.

## v2.24.1
 - Restores OpenCode/Codex usage history lost to the mirror wipe, with scheduled mirror backups plus restore/delete in the Data pane.
 - Adds dashboard accents, a CO2 detail dialog, real vendor brandmarks, session-start defaults, and share/export fixes.
 - Fixes doctor, rtk_run errors, uninstall and RTK wiring gaps, install confirm, and dashboard icon/tab glitches.
 - Fixes session resilience: stops the shared listener pile-up, runs Ponytail on main sessions, never re-injects a prompt that already carries the mode, and makes the OMP subagent marker correctable instead of a frozen literal.
 - Adds Cognition/Devin and Stealth brandmarks, and shows select labels instead of raw values.

## v2.24.0
 - Saves tokens and reports spend across every supported coding agent. Install now targets whichever agent you run, `--host omp|pi` pins it for scripts, and uninstall removes only the agent you pick.
 - Ships one extension tree for every host instead of one per host. The API differences between them live in a single adapter, so a fix lands everywhere at once.
 - Moves session-start defaults to `~/.tersio/settings.json`, shared by every host, seeded once from the previous store so no saved choice is lost.
 - Makes the doctor agent-aware: it reports each host and how it is installed, adds a per-host tree row, and `doctor --fix extensions` repairs a partly written install.
 - Retires `tersio reinstall`; `tersio doctor --fix` covers the same ground on every host.
 - Installs the RTK binary once per machine. An install that finds one rebinds instead of re-downloading; `tersio update` still refreshes it.
 - Adds an agent row to the Dashboard Connection pane with its logo, version, and resolved path.
 - Publishes under the `pi-package` keyword for discoverability in the pi package gallery, alongside the documented install routes.
 - Folds the space-bunny aliases into one free model in the usage ledger, so a stealth model no longer reports a phantom cost.
 - Refreshes the benchmark doc with all modes, a base column, and RTK tool calls.

## v2.23.0
 - Improves RTK, Caveman, and Ponytail fidelity across OMP plugin loading, session state, fallback paths, and packaged extension ownership.
 - Adds weighted RTK savings reporting, OMP-specific adoption and recall diagnostics, path-aware RTK lookup, and fail-open behavior.
 - Aligns Caveman with current upstream rules: six explicit modes, full packaged `rule.md`, legacy Wenyan migration, clarity safeguards, and offline fallback support.
 - Keeps Ponytail runtime modes aligned with upstream, separates review from session defaults, and strengthens Combo/subagent inheritance.
 - Consolidates extension ownership under OMP plugin manifests. Doctor and repair flows now inspect effective package paths and remove stale or duplicate registrations.
 - Updates the Dashboard and CLI diagnostics to reflect effective plugin state, including missing packaged rules and duplicate extension registrations.

## v2.22.1
 - Consolidates the Vite + React + shadcn/ui Dashboard under `dashboard/`, removes the legacy runtime and `gain/` app, and makes `tersio dashboard` the sole public Dashboard command.
 - Adds animated telemetry and chart reveals, a bounded shadcn Diagnosis Table + ScrollArea, reduced-motion support, a seven-day USD cost sparkline, and credits EcoLogits and Tokscale as measurement references.
 - Reduces metered CI usage by deduplicating PR checks, validating only the merged main result, and cancelling superseded runs.
 - RTK off now gates the automatic hook through shared `RTK_DISABLED` state, command percentages use weighted saved/input totals, and CLI probes resolve RTK from `PATH` instead of Bun-only paths.
 - Caveman now ships the current upstream rules and six explicit Wenyan levels; Ponytail review remains a separate one-shot command and no longer appears as a session default.
 - Dashboard and usage reports now show OMP-specific RTK adoption plus local recall diagnostics. Doctor flags duplicate OMP registrations, and `doctor --fix registrations` removes them.
 - Extension ownership now has one path: OMP plugin manifests load Tersio and Ponytail extensions; `config.yml` keeps only rtk-owned wiring. Doctor removes legacy manifest-owned entries and fixes preserve the package registration.
 - Caveman now ships `rule.md` inside the published plugin, and doctor, updater, and update diagnostics inspect that effective package path. Offline installs use the bundled upstream rules when the fetch fails.

## v2.22.0
 - Dashboard rebuilt as a responsive Vite + React + shadcn/ui application. Cards, Tables, Selects, Tabs, Charts, Badges, Skeletons, tooltips, pagination, loading states, theme controls, model details, and settings now share one component and token system instead of the legacy inline dashboard.
 - Settings gains working search with highlighted matches, grouped General/Connection/Diagnosis/Data panes, a read-only OMP coding-agent status card, theme tabs, schedules, data paths, and safe reset/reload actions. Diagnosis and doctor flows gained clearer grouped findings, repair coverage, and persistent data-home handling.
 - Usage history now lives under `~/.tersio`; OMP and Codex cache-read/cache-write buckets feed the CLI and dashboard consistently, including explicit zero cache-write reporting, measured-cost data, and USD currency persistence.
 - Share Usage renders the complete branded preview as a PNG and reuses one cached image for Copy, Download, X, Reddit, and LinkedIn. The preview includes the Tersio mark, lightning watermark, token metrics, and theme-aware social controls.
 - Gain charts and model details now use shadcn/Recharts patterns: a complete 14-day USD area window, compact activity tabs, vendor silhouettes, model token volume, a four-bucket token-mix bar chart, pagination, and theme-aware status badges.
 - Release/runtime hardening: generated CLI/extension JavaScript ships beside TypeScript, the packed Gain bundle is included for npm consumers, the tarball layout is regression-tested, and the dashboard export remains self-contained.


## v2.21.0
 - New: `tersio doctor --fix` repairs whatever doctor flags — missing extension files copied from the running CLI, config.yml registrations (combo, ponytail, rtk.ts, mode reinforcement), self-plugin registration, the checksum-verified RTK binary + `rtk init` wiring, a Ponytail refresh, and the CLI update itself. Bare `--fix` prompts for scope (`--fix <scope>` pins one; `--yes` fixes all; `--dry-run` previews), then re-runs doctor to prove it. The bare `tersio` menu offers the repair after a failing doctor run.
 - Fix: a broken release payload can no longer half-update the machine. `tersio update` smoke-checks the target (`npm exec --package=<target> -- tersio --version`, side-effect free) before touching the global CLI or OMP files, and aborts with a hint when the payload fails. `install.sh` runs the same `--version` check before `tersio install`. 183 tests.

## v2.20.1
 - Fix: v2.20.0 shipped `extensions/**/*.ts` without the compiled `.js` the CLI requires at runtime, so npm-installed users crashed with `ERR_MODULE_NOT_FOUND` on first run (no banner, update dead). The tarball carries both again; a tarball-contents test now fails the build if any CLI-used extension module lacks either counterpart. 177 tests.

## v2.20.0
 - Tooling modernized: Vitest replaces the custom `tsx --test` runner (161 → 176 tests), Bun replaces npm for installs/CI (`bun.lock` in, `package-lock.json` out), and `package.json` metadata tightened.
 - OMP extensions now ship as TypeScript sources instead of compiled JS (supported per OMP extension-authoring docs); reinstall drops legacy `.js` twin lines from `config.yml` so OMP never loads both copies.
 - Tests reorganized into folders mirroring the source tree (`cli/`, `usage/`, `updater/`, `shared/`, `commands/`); new caveman command/injection and ponytail fallback coverage. 176 tests.

## v2.19.0
 - Usage gains a sqlite cache (`usage.db`): best-effort sync with live-parse fallback, `tersio reset`/`doctor` cover the new store, and the report marks its source (live/stored/stored-stale).
 - Gain dashboard: dark mode, sortable Recent table, duration derived from timestamps; the currency picker POSTs to `/currency` so close → reopen keeps the choice (each run is a fresh port/origin, so localStorage alone could not).
 - New `tersio settings` command: session-start defaults (combo, caveman, rtk, ponytail, currency) in a box-drawing table, non-interactive flags, `--dry-run` preview, bare-`tersio` menu entry. Profile read/write factored into `cli/profile.ts` so install and settings share it.
 - Display currency: `--currency <code>` on `usage`/`gain` (10 currencies, offline snapshot rates; flag wins, then the stored default, then USD), declared in `omp.settings` for OMP's plugin page.
 - Fix: `extensions/shared/usage-store.ts` was referenced but never committed (red CI on fresh clones); a repo-integrity test now fails locally whenever tracked sources import untracked files. 161 tests.

## v2.17.0
 - Gain dashboard: Models card shows top 10 with pager; Recent requests pages at 15 per page (Command-tools pattern).
 - Both cards gain the 10/15/25/50 per-page picker (shared helper); footers pin to card bottom and always render (empty reads `Showing 0-0 of 0`); cards grow dynamically and split 50/50.
 - Model tooltips show per-bucket cost in parentheses plus a costed total; tooltips widened with tabular numerals.
 - Recent requests gains a Time column (`5.5s ⚡61/s`: elapsed time + output tok/s, legend in subtitle) and per-row hover tooltips (exact timestamp, input/output/cache/elapsed/speed).
 - Savings bento gains Lucide zone faces (CO2, leverage, cache share) with matching hover tooltips; CO2 tooltip trimmed to zone + energy.
 - Gain dashboard: version chip moves from footer to settings dialog description; served process titles itself `tersio gain` so it reads as tersio in `ps`/Activity Monitor.

## v2.16.0
 - Update and install output condensed: the delegated `tersio update` payload runs quiet (no repeated banner, no per-file writes), the parent owns one plan line and one closing summary. Failures still surface per add-on.
 - Install is non-technical and minimal: `[1/8]` numbering and absolute paths gone — each add-on prints one plain line (`Ponytail — refresh plugin`, `RTK — download binary and wire into OMP`, …). File paths move behind `--verbose`. RTK dry-run stays offline (no GitHub API probe, so rate limits no longer print `[fail]`).
 - `tersio update` now reports every add-on's status (Tersio, RTK, Caveman rule, Ponytail) — up to date, version jump, or honest unknown — instead of only the stale ones.
 - Fix RTK metering after install/update/reinstall: `rtk init` writes `rtk.ts` but never registers it, and OMP only loads extensions listed in config.yml, so bash commands silently stopped rewriting. The wire step now appends `extensions/rtk.ts` to config.yml (idempotent, backs up first), and `tersio doctor` warns when the file exists but is unlisted. Native tool calls (`read`/`edit`/`grep`/`glob`) stay unmetered — rtk's hook surface is bash-only.
 - Docs: dropped the throwaway output-example files and the stale README command rows. 139 tests.

## v2.15.0
 - `/tersio` router slimmed: redundant mode-switch branches (`caveman`, `rtk`, `ponytail`, `combo`) removed — each redirects to its own dedicated command (`/caveman`, `/rtk`, `/combo`, `/ponytail`). One spelling per switch.
 - Combo defaults preserved across update: seed from live lock file, flagless update path keeps defaults, ponytailDefault applied via config.yml and plugin-settings, default gate relaxed.
 - Graphify knowledge graph wired: AGENTS.md rules (query, path, explain, wiki, update), .gitignore for graphify-out/ wiki, .gitattributes merge driver for graph.json.
 - Dynamic LiteLLM pricing: full-feed cache from proxy, lazy background refresh on stale or missing, static pricing table removed from source.
 - Gain dashboard auto-refreshes every 5s while served and visible.
 - Installer routes curl via bun by default, falls back to npm; CLI and installer gain `--bun`/`--npm`/`--ref` flags.
 - Doctor output polished: merged sections, trimmed noise, added `[OK]`/`[FAIL]` status per line. Banner: side-by-side layout polish.


## v2.13.0
 - RTK is now wired into OMP by default: the installer runs `rtk init -g --agent omp` after the binary lands, so OMP rewrites eligible bash tool calls to `rtk` and every rewritten run meters into `history.db` and the gain dashboard's Command tools. Wiring decouples from download success (rate-limited or checksum-failed releases still wire a pre-existing binary), dry-run previews it, uninstall `--remove-rtk` removes the `rtk.ts` extension with the binary, and `tersio doctor` gains an `RTK OMP wiring (rtk.ts)` check. Native tool calls (`read`/`edit`/`eval`) stay unmetered — rtk's hook surface is bash-only. Fixes #28.
 - Dashboard: the Reset control moves from the header into a red danger-zone section at the bottom of the Settings dialog (destructive tint per theme, red hover glow, two-click confirm unchanged); stacked dialog rows gain a 14px gap. Header now holds the gear only.
 - Docs: BENCHMARK.md fully rerun (2026-09-13, o200k_base, Node v26.8.1) — per-level ponytail overhead (bundled floor 54–60 tok vs installed plugin v4.9.0 1,260–1,275 tok), fresh reply/code samples at every caveman and ponytail level, real rtk runs (git status −60.4%, grep −27.1%, diff −33.0%), hook-wrapped test suites −97.5% verified from `history.db`, and v2.9.0-vs-main runtime (install −14.1%, doctor −85.9%). README benchmark table covers every measured surface including per-level ponytail rows, with a new metering troubleshooting entry. 129 tests.

## v2.12.0
 - Install is user-level only: the project-scope prompt, branch, and `--scope project|both` are removed — session extensions must live in `~/.omp/agent/extensions` to load. A stale `--scope project|both` now fails loudly; bare `--scope user` still parses for old scripts. `tersio update` no longer forwards scope.
 - Fix OMP launch warning: the shared bridge now ships `shared/usage-ledger.js` with its `pricing.js`/`carbon.js` deps, so the `/tersio` root command loads (it was broken since the router gained `usage`/`gain`). Pinned by a dry-run bridge test. 125 tests.
 - Dashboard: empty-state placeholders no longer render alongside data (`.empty.hidden` beats Tailwind's `.hidden`); Settings store paths truncate with ellipsis inside their cards; footer social icons load from the Simple Icons CDN (LinkedIn stays inline — no v16 CDN slug).

## v2.11.0
 - `tersio reset` clears tersio-owned statistics (usage ledger) with `--dry-run` preview and confirm-unless-`--yes`; session transcripts and RTK history are never touched. `tersio doctor` gains a Records section showing every store path with ownership. Gain dashboard gets a served-mode Reset button plus shadcn-style empty states (dashed well, Lucide icon, title, hint) on Activity, Top models, Models, Recent, Tools, and the cost sparkline for zero-data renders. Header controls collapse into a native-modal Settings dialog (icon-only Light/Dark/System theme tabs, reload, and all three store paths with ownership).

## v2.10.0
 - Gain dashboard: Command Tools merges session tool calls and RTK-metered commands into one sortable, paginated table (15/page) with honest gaps for unmetered rows; USD card gains a 10-currency converter with live rates; scroll progress rail; hero gradient fixed in light mode; reload no longer fades the hero.
 - CLI: OMP-style launch welcome (pixel-scissor banner + tips) via Clack on interactive `tersio` / `tersio install`; `tersio usage` merges Top Tools and RTK into one Command Tools table; zero-value cache-write buckets collapse in CLI and dashboard until a client reports them.
 - Usage ledger reads Codex session transcripts alongside OMP (`codex/<provider>` rows, cache-write capture).
 - README rewritten in house style with shieldcn badges; v1.0.0 entry drops the dead upstream-fork link. 116 tests.

## v2.9.0
- Update check fix: the menu's "Check for updates" always probes the registry live instead of trusting a 6-hour cache; an unreachable registry now reports unknown rather than a false "latest", and `tersio doctor` warns instead of claiming the CLI is current. Pinned by two regression tests (fresh-stale-cache bypass, offline-unknown).
- Gain dashboard: the USD cost card gains a 14-day volume sparkline with per-day cost tooltips, ~per-day and top-day estimates (blended rate, labeled ~), and a cache-leverage multiple (saved / cost). The floating dock gets a gradient hairline ring, brand glow, divider, and accent hover on Reload. The footer is two rows with a live version chip and a local-only privacy note.
- Top Tools is now a full-width impact table (# / tool / calls / share / impact) below Models; the Models list went full width with vendor monograms; heatmap month labels align to the column rhythm.
- Export fix: the inlined `data.json` chain no longer double-`.then` (offline `file://` snapshots previously rendered empty); `data.json` gains a `version` field for the footer chip. 109 tests.
- Token buckets follow tokscale (input / output / cache read / cache write, always rendered); per-model USD cost from a new pricing module (live LiteLLM refresh with local cache, built-in fallback, refreshed on `tersio update`).
- CO2 upgraded from a flat factor to an EcoLogits 0.8.2 port (per-model params, provider grids, served ÷32 amortization) with a methodology hover on the card; derivation credited in `ECO_NOTICE.md`.
- Dashboard split into `dashboard/` segments (template, styles, app logic); 30-day token line graph with per-model hover cards; GitHub-style heatmap with day tooltips; brand icons via Simple Icons (bot-glyph fallback, never initials); model breakdown hovers (input/output/requests/cache-hit); condensed single-row footer.
- Export hardening: `$`-pattern payloads no longer corrupt the inlined snapshot (regression-tested).

## v2.8.0
- `tersio dashboard` / Serve merged into `tersio gain`: one command serves localhost, opens the browser, or exports a file. The 26-week heatmap is gone; token activity is a stacked per-model chart with Daily/Weekly/Cumulative toggle, top models get vendor monogram cards with week-over-week deltas, and Top Commands is now Top Tools.
- Top Tools splits `bash` calls by lead binary (`bash:git`, `bash:npm`, …) parsed from session tool calls; cache savings estimated from cache-read volume (~$659 on the author's ledger).
- 96 tests.

## v2.7.0
- Bare `tersio` at a terminal is now a Clack command picker (Install, Check for updates, Update everything, Doctor, Usage, Gain dashboard, Serve dashboard, Uninstall). Pipes, CI, `--yes`, and `--dry-run` keep the old straight-to-install path.
- Pending release on bare run: `Install it now?` Yes/No offer; Yes runs the full update and stops so the fresh binary owns what follows.
- `/tersio gain` opens the dashboard in the default browser (file-ready snapshot, shell-hint fallback).
- Installer now ships `extensions/tersio-commands` (previously declared but never copied, so `/tersio` never appeared); doctor checks it, uninstall removes it.
- 96 tests.

## v2.6.0
- Unified `/tersio` root session command: `combo`, `caveman`, `rtk`, `ponytail`, and `ai-addons` collapse under one entry with subcommand routing; README goes `/tersio`-first.
- Usage ledger + `tersio usage` report: session tokens parsed from OMP transcripts, priced per model (LiteLLM-refreshable table), with USD cost, CO2 estimate, and cache-share stats.
- Gain dashboard (`tersio dashboard`): single-file HTML with token strip, 26-week activity graph, 14-day input-vs-output chart, savings rail, models top-5, floating dock navbar, and transparent webp brand (black bg keyed out of the avif source). Footer socials are inline SVGs with no icon-font dependency. Serves on 127.0.0.1 only; `--export` writes a self-contained file.
- 92 tests.

## v2.5.0
- `tersio update` chases the real latest release instead of a stale `@latest`: the target resolves once via `npm view --prefer-online` and pins `@<exact>` for both the global refresh and the delegated installer (falls back to `@latest` when the registry is unreachable). Dry-run previews the resolved version.
- Update prints a per-add-on plan before doing anything: current -> latest for Tersio, RTK, Caveman rule, and Ponytail. All probes run concurrently (4-6s cap, best-effort); unreachable sources print `unknown` and never block the update.
- `tersio.ts` splits into focused modules: an 82-line entry plus `cli/` modules for `common`, `interactive`, `install`, `doctor`, `update`, and `uninstall`. Pure move, no behavior change. 76 tests.

## v2.4.1
- Fix the combo bar disappearing after idle/resume: the combo level was tracked by session-entry write order, so any individual mode entry after the `combo-level` entry forced the level to `custom` — even a redundant same-value replay. The level now always derives from the final mode triplet, so a preset survives entry replay and individually aligning all three modes to a preset triplet activates the bar.
- Mode commands confirm the session-wide active set: `/caveman`, `/rtk`, and `/combo` report all three modes (e.g. `Combo max on — caveman=ULTRA, rtk=ON, ponytail=ULTRA active for this session.`). 75 tests.

## v2.4.0
- Interactive CLI via `@clack/prompts` — the framework behind the Vite, Astro, Nuxt, TanStack, and Cloudflare CLIs. On a TTY, the scope and Combo preset prompts become arrow-key radio menus, the uninstall confirmation becomes a `confirm` dialog, and every network-bound step (registry check, Caveman rule fetch, RTK release lookup/download/checksum, Ponytail and self-plugin installs, update refresh and delegate) runs under a live timer spinner. `doctor` probes start concurrently and report through progressive task phases in fixed section order.
- Non-TTY behavior is unchanged: piped, CI, `--dry-run`, and test runs emit byte-identical plain output with no spinners or prompts. `tersio version`, `tersio help`, and unknown-command output stay plain by design.
- Dependencies/policy: `@clack/prompts` is the first runtime dependency; `engines.node` rises from `>=18` to `>=20.12.0` (Clack 1.x requirement; Node 18 is EOL). CI matrix moves to Node 20/22/24. 73 tests.

## v2.3.0
- The curl one-liner is the default install and runs the full `tersio install` in the same pass: `curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh` lands you at the scope + Combo preset menus. Interactive shells get the menus directly, piped installs read them from the controlling terminal, and CI/non-interactive shells fall back to `tersio install --scope user --yes` with zero prompts. Extra flags forward: `curl ... | sh -s -- --dry-run --scope both`.
- `install.sh` picks its source dynamically: it prefers the `tersio-npm.tgz` tarball attached to the latest GitHub release (built by CI per tag) and falls back to `npm install -g @krtclcdy/tersio@latest`. `TERSIO_TARBALL_URL` overrides the source for mirrors or pinned versions.
- `install.sh` is served from GitHub releases (frozen per release, stable `releases/latest/download` URL); a new `release-assets` workflow attaches `install.sh` + the packed tarball to every `v*` tag automatically.
- Reliability fixes: the `/dev/tty` probe uses a subshell `exec` (dash aborts a script when a special builtin hits a failed redirection, so piped installs crashed on Ubuntu CI), and `ask()` now returns an empty answer on a closed readline instead of throwing `ERR_USE_AFTER_CLOSE` when stdin EOFs between prompts.
- README: curl listed as the default install; the manual npm two-step removed. 73 tests.

## v2.2.0
- Curl bootstrap installer: `curl -fsSL https://raw.githubusercontent.com/KurutoDenzeru/tersio/main/install.sh | sh` checks for npm (friendly Node.js hint if missing), installs the CLI globally, and prints the `tersio install` follow-up. macOS/Linux/WSL.
- Update banner: running bare `tersio` (or `install`/`reinstall`) prints `[update] tersio X.Y.Z available (installed A.B.C) — run 'tersio update'` when a newer release is on npm. The check is cached for 6 hours under `~/.omp/plugins/tersio-update-check.json`, capped at 4s per fresh lookup, silent on failure, and TTY-gated so scripts and CI stay quiet.
- `tersio doctor` now reports add-on versions and freshness in a new `Add-ons` section: Caveman rule age (file mtime), RTK binary version plus age, and the installed Ponytail package version plus age. `Environment` gains a `Tersio CLI` row (warns when a newer release exists) and `Plugins` shows the installed self-plugin version.
- Doctor probes (file mtimes and the cached update check) join the existing concurrent probe batch; print order unchanged. 71 tests.

## v2.1.0
- `tersio update` is now a full refresh: it upgrades the globally installed CLI (`npm install -g @krtclcdy/tersio@latest`, best-effort with a manual hint on failure) before delegating to the latest installer, so the `tersio` banner no longer lags behind the OMP-side files. Dry-run previews the step without running `npm -g`.
- `tersio update` refreshes all three add-ons: the Ponytail package (npm), the tersio self-plugin registration, the RTK binary (latest release, checksum-verified), and the Caveman rule (re-fetched). Previously the Ponytail package and self-plugin fast paths skipped the refresh.
- `tersio install` asks its Combo default with a numbered menu (`1) off 2) medium 3) balanced 4) max`) instead of free-text preset names, with the same invalid-choice retry as the scope prompt. Flags still override.
- `tersio doctor` output is grouped into five sections — Environment, Installation, Extensions, Plugins, RTK — with unified `ok`/`MISSING`/`warn` states and a closing `Summary: N checks — X ok, Y warn, Z missing` tally. The RTK version probe now accepts version text from stdout or stderr regardless of exit code, fixing the false `unavailable` on working binaries.
- Tests: 69 pass (new: global CLI refresh call, dry-run preview, doctor section/summary assertions).

## v2.0.1
- Fix combo status bar after a fresh install or session reload: `/combo balanced` restored caveman and rtk modes (persisted as `FULL`/`ON`) but the unified `🧩 combo BALANCED` bar never appeared. Caveman and rtk now publish the persisted combo state themselves at `session_start`/`session_branch`/`session_tree`, and the combo bar paints from the live shared bridge instead of extension-local state captured at registration — suppression no longer depends on the combo extension's UI-gated reconcile or extension load order.
- Fix `tersio uninstall` leaving the Ponytail plugin installed: the plugin package, `plugins/package.json` dep, `omp-plugins.lock.json` entry, and `config.yml` line are now removed by default. New `--keep-ponytail` flag opts out; the legacy `--remove-ponytail` flag is still accepted; `tersio reinstall` still preserves Ponytail.
- Docs: README benchmark table now shows mode savings only (3 columns, p50 `o200k_base` BPE tokens, break-even math); `BENCHMARK.md` adds median/ratio lines and explicit pay-off formulas. 67 tests.

## v2.0.0
- Breaking: Amanai reward detector removed from source, tests, `README.md`, and `package.json` manifests (`omp.extensions`, `pi`). The plugin ships only the Caveman, RTK, Ponytail, Combo, and Updater add-ons.
- Core refactor per the Google TypeScript Style Guide, landed as 69 incremental audit commits: shared scope/JSON/config helpers, merged Ponytail writers, split `stepRtk`, table-driven updater copy, shared RTK/session/file utils in `extensions/lib/utils.ts`, shared `parseJsonObject` for tolerant JSON parses, batched doctor probes, concurrent `copySources` reads, single shared Caveman rule fetch, native `Promise.withResolvers`. Measured: install dry-run (both scopes) −24.5% wall time, `tersio doctor` −12%, memory flat, source −101 LOC.
- Tests regrouped into `test/combo`, `test/installer`, and `test/rtk` with new uninstall, doctor, RTK, and combo-derive suites — 65 tests. Test runner glob fixed for subfolders.
- Installer/doctor fixes: `balanced` preset, `Promise.withResolvers` fallback, corrupt-manifest guard, scope re-prompt, config backup, tmpdir/stream fixes, `--ponytail-default` flag, concurrent addon probes.
- Docs: `BENCHMARK.md` with measured before/after token tables (`o200k_base` tokenizer), README benchmark table, concise package description.

## v1.0.4
- Combo default persists preset entries on fresh sessions: the installer/user-configured preset now writes `caveman-mode`, `rtk-mode`, `ponytail-mode`, and `combo-level` entries, so resume keeps the combo bar and upstream Ponytail activates. Before, the default lived only in memory and evaporated on resume.
- `tersio uninstall --remove-ponytail` fully removes the Ponytail plugin (npm dep, package files, lock entry, config line). Before, only the config line was dropped and `omp plugin list` kept showing it. Without the flag Ponytail stays. Uninstall also removes the orphaned `extensions/lib` dir.
- Test hermeticity: statusbar and subagent suites no longer read the developer's real lock file.

## v1.0.3
- Install asks one question: the Combo preset implies caveman, rtk, and ponytail modes (`medium` = lite/on/lite, `balanced` = full/on/full, `max` = ultra/on/ultra). The redundant Caveman/RTK prompts are gone; `--caveman-default` / `--rtk-default` remain as overrides. The profile line now shows ponytail too.
- Fix OMP launch failure (`EINVAL: stat '/.resolve/index.ts'`): the installer appended extension entries under OMP's default `extensions: null` scalar, producing malformed YAML. The writer now normalizes `null` / `~` / `[]` / empty to `extensions:` first, and install validates the key at the end with a repair hint.

## v1.0.2
- Fix broken npm tarball: 1.0.1 shipped without `tersio.js` and most extension files, so npm never created the `tersio` bin link and `tersio install` failed with `command not found`. npm pack consults `.gitignore` when no `.npmignore` exists; the build outputs were ignored. Added `.npmignore` (packing no longer consults `.gitignore`) and `prepublishOnly` (build runs before every publish). 1.0.1 is superseded.

## v1.0.1
- Fix install crash `ERR_USE_AFTER_CLOSE`: the installer closed the shared readline interface after the first prompt, so the second session-default question threw. `ask()` now keeps the interface open; a single close happens at exit. Verified with an interactive pty run through all three prompts.
- Sources now import with `.ts` specifiers (`rewriteRelativeImportExtensions`): compiled output still uses `.js`, package layout unchanged.

## v1.0.0
- Rebrand: `oh-my-pi-token-saver` is now Tersio — npm package `@krtclcdy/tersio`, `tersio` command, OMP plugin, GitHub repo `KurutoDenzeru/tersio`. (Unscoped `tersio` is blocked by npm's typosquat guard against `terser`; the `tersio-omp` stopgap is deprecated.) New product line, so the version restarts at 1.0.0; code is identical to `oh-my-pi-token-saver@2.1.1` apart from the rename.
- Migration is one reinstall: `omp plugin install @krtclcdy/tersio` (or `npm i -g @krtclcdy/tersio` + `tersio install`). The installer drops legacy `oh-my-pi-token-saver` and `tersio-omp` dependencies from `~/.omp/plugins/package.json` on its next run. Old releases stay on npm, deprecated in favor of `@krtclcdy/tersio`.

## v2.1.1
- Fix status bar duplication under the balanced combo preset: caveman and rtk still hardcoded the medium/max preset names in their suppression checks, so `/combo balanced` painted three status lines instead of one. Both extensions now consult `COMBO_LEVELS` from the shared session-state module, so a future preset cannot reopen the gap.

## v2.1.0
- Session-start mode defaults. Set them with the installer (`install --combo-default balanced`, `--caveman-default lite`, `--rtk-default on`, or the interactive prompt) or through OMP plugin settings (`omp plugin config set oh-my-pi-token-saver comboDefault max`). All default off.
- Declares `omp.settings` (typed enum/boolean settings) in `package.json` so the same knobs are manageable from OMP's plugin manager without the installer.
- Defaults persist to `~/.omp/plugins/omp-plugins.lock.json`; extensions read them via the new `extensions/shared/plugin-settings.js` (shipped by the installer).
- Persisted session state always wins: `/combo`, `/caveman`, and `/rtk` entries override the defaults on every restore.
- Installer drops its own add-on selection; per-add-on choice is OMP's native feature-flag job (`omp plugin install 'oh-my-pi-token-saver[caveman,ponytail]'`, `omp plugin features --disable rtk`).

## v2.0.0
- Full TypeScript migration: all 9 source files and 7 test files converted to TypeScript (`strict` mode, NodeNext resolution). `npm run build` compiles to `.js` (published), `npm run check` type-checks, tests run via `tsx`.
- Extracted duplicated helpers (`httpsGet`, `httpsDownload`, `sha256Hex`, `parseChecksum`, `readTextIfExists`, `normalizeRtkVersion`) from the installer and `/ai-addons` updater into `extensions/lib/utils.ts`.
- Added shared extension-host types (`extensions/shared/types.ts`); typed all extension entry points, installer functions, and test fakes.
- Installer now ships the compiled `shared/types.js` and `lib/utils.js` alongside the extensions they import.

## v1.2.0
- New Combo preset `balanced`: caveman=full, rtk=on, ponytail=full — sits between `medium` (lite) and `max` (ultra). `/combo balanced` activates it, shows the footer bar, and inherits into task subagents like the other presets.

## v1.1.3
- Combo bar now includes the active level: `🧩 combo MEDIUM: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE` (or `MAX`).
- Combo clobbers the sibling `caveman`, `rtk`, and `ponytail` status slots after painting its own, so a stale `🪨 caveman: LITE` line no longer lingers alongside the combo bar.

## v1.1.2
- Status bar shows a single unified line for combo presets: `🧩 combo: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE`; individual `caveman` and `rtk` bars stay clear while a preset is active.
- Installer writes `~/.config/ponytail/config.json#hideStatus=true` so the upstream ponytail bar (horse + level icon) is suppressed; combo owns the bar. Per-level ponytail icons remain `🌿 / ⚡ / 🔥` inside the system-prompt block.

## v1.1.0
- Register `oh-my-pi-token-saver` in `~/.omp/plugins` during user-level install so the package appears in OMP Settings → Plugins; when registered, the Amanai reward detector loads through the plugin manifest instead of a copied `agent/extensions` entry (no double load).
- `uninstall` now also removes the legacy `aaa-combo-boot` helper (it imports `shared/session-state.js` and failed to load after uninstall) and drops the package's plugin registration from `~/.omp/plugins`.
- `doctor` reports the self-plugin registration and recognizes the plugin-provided Amanai detector.

## v1.0.0
 - Initial release: `oh-my-pi-token-saver` on npm with the `oh-my-pi-token-saver` CLI command.
 - Shipped behavior: Caveman, RTK, and Ponytail session modes; Combo presets; `/ai-addons` updater with dry-run; passive Amanai reward detector; installer subcommands (`install`, `update`, `reinstall`, `doctor`, `uninstall`, `version`, `help`) with `--scope`, `--dry-run`, `--yes`, and `--verbose`.
