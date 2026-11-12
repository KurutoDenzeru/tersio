## Unreleased

## v2.25.20

### Added
- INSTALL.md and README.md now name Claude Code's own install route: `/plugin marketplace add` then `/plugin install`. The Tersio CLI route follows it as the one that adds RTK and Headroom.
- The dashboard's Latest requests, Requests, and Traces tables carry an Agent column: each harness's brand mark and name, sortable and searchable like the other cells.
- Mode switches now save the next session's defaults. `/combo`, `/caveman`, `/rtk`, `/ponytail`, `/pstack`, `/headroom`, and the stop phrases write the current state to the host section and the shared defaults, so a new session starts where the last one ended.
- Claude Code now ships Tersio's MCP server in the plugin bundle, so Headroom recovery and stats tools are reachable from Claude. The host check reads the bundled `.mcp.json` instead of assuming the plugin carries one.
- The Claude plugin carries pstack's playbooks, skills, principles, and references, and prints the absolute skill directory in the injected rule.
- Claude slash commands gain `/tersio:update` and `/tersio:help`.
- Claude mode stop phrases (`normal mode`, `stop caveman`, `caveman off`, `stop ponytail`, `ponytail off`, `pstack off`) turn the matching modes off and tell the model that earlier rules no longer apply.
- Claude transcript traces now render turns, one model span per request, and tool spans with their results.

### Fixed
- `tersio uninstall --host claude` unwraps Headroom's Claude route instead of restoring the OMP gateway and leaving Claude pointed at a stopped proxy.
- Claude's RTK toggle now adds or removes the `rtk hook claude` entry in `~/.claude/settings.json`; the stored preference was previously a label only.
- The Claude plugin reads `TERSIO_HOME` and `CLAUDE_CONFIG_DIR` instead of assuming `~/.tersio` and `~/.claude`.
- The host menu no longer lists a disabled “Claude Code — Coming soon” entry beside the real host.

### Changed
- The bare `tersio` launch shows a spinner while its six-hour update cache refreshes from npm and GitHub, and prompts a yes/no CLI update when one is pending. The update row then tucks the installed agents under an `AI agents` choice like Uninstall. The submenu updates all agents or one, and marks outdated hosts with their version. The update plan labels `RTK binary` and `Headroom binary`, omits `latest unknown`, and drops the duplicate closing Tersio line.
- Doctor and the Settings diagnosis list each agent's own version instead of the Tersio package version. A host whose agent binary is absent dims and stops hovering; the install badge carries the state, so the redundant “not installed” and leftover-file lines are gone.
- Doctor no longer reports a per-host Headroom route or the shared proxy endpoint. The Headroom binary row stays.
- The Headroom proxy no longer loads its Kompress ONNX model at startup. Footprint falls from about 600MB to 274MB and threads from 23 to 9, measured on the same machine. The cheaper engines still run every turn: Code-Aware AST compression, the compression cache, and CCR, which between them carried the work; one of 131 learned routing patterns had used the model. A deployment that passes `--enable-kompress` keeps it.
- The dashboard ships the 97 Lucide icons it names instead of all 2,029, cutting the bundle every user downloads from 2,616 kB to 1,964 kB, and from 872 kB to 705 kB gzipped.
- Carbon moves from Usage to the Insights group in the dashboard rail, above Tools and Projects, because it reads as an impact figure rather than a usage one. The section id and the `f` hotkey are unchanged.

### Fixed
- Headroom routes Anthropic-compatible providers at the proxy root and OpenAI providers under `/v1`. Thanks to @FrancoStino (#102).
- The bun hand-off probe allows 10s instead of 2s. Under load the probe timed out, the CLI read that as a broken bun, stayed on node, and the runtime test failed with no stated cause.
- The error icons render again. lucide 1.70 renamed `circle-alert` to `circle-exclamation-point` and `triangle-alert` to `triangle-exclamation-point` and dropped both old keys, which eleven files still named; a missing name falls back to a question-mark glyph, so the build stayed green.
- `happy-dom` moves to 21.0.4 for CVE-2026-33943, a high-severity advisory where an unsanitized import alias reached host code. A devDependency, so the shipped bundle is unchanged.

### Removed
- `date-fns` and `simple-icons` leave the dashboard workspace. Neither had a single import; together they cost 52MB of installed tree and nothing in the bundle.

## v2.25.19

### Added
- Tersio registers its Codex prompt hook in `~/.codex/hooks.json`, beside rtk and headroom. Current Codex removed plugin-declared hooks, so the copy inside the plugin never ran and a literal `/combo lite` reached the model. Uninstall removes only Tersio's entry.
- `/headroom on|off|status` is now a Codex slash command, with its own prompt file and `$headroom` skill. It stores the same `headroomDefault` the CLI writes and says the endpoint route applies at install or from the dashboard switch, because moving the route needs the running proxy.
- A literal `/combo lite` answers in Tersio's prompt hook instead of the model: the mode applies and the command returns before a turn starts, with no network round trip.
- Codex's prompt hook returns a `systemMessage` on every turn: the same `🧩 LITE | 🪨 caveman:LITE | …` combo line the DSH bar and the CLI print. Codex Desktop exposes no plugin status bar, so the hook result is the surface.
- `/combo help` lists the presets and changes nothing.
- Codex is now a Tersio host: `tersio install --host codex` materializes a local marketplace and installs the portable plugin with its bundled MCP server. A prompt hook applies literal `/combo`, `/caveman`, and `/ponytail` commands and keeps those modes active for the session; per-mode skills expose `$combo`, `$caveman`, `$ponytail`, `$pstack`, `$rtk`, and `$tersio`, with `/prompts:*` fallbacks. Codex rollout sessions feed every dashboard page with requests, models, providers, API, payloads, errors, tools, real working-directory projects, and separate traces. Headroom routes Codex through its own `init codex` / `unwrap codex` commands and the dashboard detects CLI and desktop installs on macOS, Windows, and Linux; RTK remains out of the Codex v1 surface.

### Changed
- The upstream **Agent copies** chart labels each row with the agent's own mark instead of its name, so six agents fit without a wide axis. The caption and the chart's accessible name still spell every agent out.
- The Caveman pin moves to v4.1.0. All three tracked rule bodies are byte-identical between v4.0.1 and v4.1.0, so no mode text changes; the pin only clears the stale badge. Caveman 4.1.0's two action items target its own proxy config and `caveman-compress`, neither of which Tersio writes.
- `tersio install --host omp` rewrites the OMP manifest pin when `node_modules` already matches, so `omp plugin doctor` no longer reports version drift. Thanks to @FrancoStino (#97).
- A blocked Codex command now prints the combo line under its confirmation, because Codex renders only `reason` and drops `systemMessage`.
- Headroom's Codex route writes `openai_base_url` with the `/v1` path, so Codex upgrades `ws://…/v1/responses`. A root URL answered 403 on the WebSocket upgrade before every turn fell back to HTTPS, which read as an error on each run.
- The Codex install now says that its prompt hook needs one approval in `/hooks`. Codex skips a hook whose recorded trust hash no longer matches, and the install re-adds the plugin, so a literal `/combo lite` reaches the model and reports the slow path instead of answering.
- A quick start drawer now holds its header and footer on the same skeleton as its body. Install and Update were reachable while the first read was still in flight, and headroom and rtk defaulted to "not installed" until health answered, so the footer offered Install for a tool that was already there.
- The canvas mode badges for caveman, pstack, Ponytail, RTK, and Headroom now carry the version, tinted green when it matches the newest upstream the last check saw and orange when it is behind. An unmeasured check stays gray instead of claiming either, and the tooltip names both versions.
- The dashboard harness badge shows the version alone, shortened to the release, and the Headroom drawer names the install option: `durable` or `routed`. DeepSeek Harness gained a version badge: `/health` asked the PATH wrapper, which is a stub that exits before answering, so the probe now prefers the desktop app's own CLI and reports `0.2.2-rc.1` instead of nothing.
- The Ponytail rules load from the package's `extensions/ponytail/skills` when the module sits in `dist/`, which the build never copies skills into. Every emitted CLI used to report the broken-install stub instead of the real rules.
- The Codex prompt hook reads `session_id` from its payload, so a mode command applies to the session that sent it instead of the host defaults.
- Doctor groups advisory findings under a dedicated Warnings section and names Oh My Pi consistently. The Upstream check now compares Codex's generated hook and MCP files structurally, so absolute runtime paths no longer read as drift.
- `tersio` now runs the command under bun whenever bun is installed, instead of the node its shebang names. The whole CLI follows, MCP server included, and `TERSIO_RUNTIME=node` keeps a machine on node. A real command spends about 15% less CPU; a command that only prints text pays roughly 30ms for the second boot.
- The MCP server starts under bun directly when bun is installed, instead of booting node and then handing off to bun. Its process tree is one bun process at about 36 MB; a machine without bun stays on one node process at about 72 MB.
- The MCP server no longer loads the whole dashboard to answer two tools. The agent-stats layer moved to its own module, so the server imports 30 files instead of 51.
- The MCP server asks for a summary view instead of the dashboard full view. One `tersio_stats` call now costs about 18 MB of resident memory and 0.5s; it cost about 51 MB and 2s.
- zlib is loaded when a cache row is first written or read, not at import, so a process that never caches never pays its 8 MB.
- The proxy starts directly instead of through `headroom install start`, which kept a second 82 MB Python process alive for the life of the proxy.
- A restart no longer brings that supervisor back either: the proxy is stopped and started directly with the upstream just written.
- Uninstalling stops the proxy instead of leaving it serving a provider endpoint nothing points at.
- Turning Headroom off for the last routed agent stops the proxy. One agent of two keeps it running.
- A machine under 2 GB of memory is not given the proxy. The install names the floor as the reason, and `TERSIO_HEADROOM_FORCE=1` overrides it.
- Stopping the proxy only touches the port Tersio owns, so another tool running headroom on another port is left alone.
- The installed `tersio` entry replaces its node process with bun in place, instead of keeping node alive to wait on a bun child, so a hand-off leaves one process instead of two.
- The saved settings are parsed once and reused until the text changes, so restoring a session no longer parses the same file six times. The file is still read on every check, because a stat cannot see a same-size rewrite on Windows.
- RTK output filtering keeps one temporary directory for the life of the process, instead of creating and removing one for every filtered result.

### Fixed
- The dashboard's Headroom update now passes `--yes`. Without the flag headroom asked a confirmation no TTY could answer, printed `Aborted!`, and left the binary where it was.
- The Headroom drawer checks the release feed when it opens, so an available update is a button rather than a two-click hunt, and it waits three minutes for `uv tool upgrade` to finish instead of one.
- The Headroom drawer names the agents that swap endpoints from the live routes. Codex and Oh My Pi keep headroom's own block, so they no longer read as endpoint swaps.
- Quick start keeps its last read across navigation. Coming back paints the host state instead of a skeleton, and an install that was running when the page was left keeps its spinner, then reports its own result.
- The proxy starts on the first agent session after a reboot. A proxy still binding its port was read as another tool's proxy, so the start was refused and the route pointed at a dead port. A proxy on Tersio's own port now waits instead of refusing.
- A shell whose command line mentions `headroom.cli proxy` no longer counts as a proxy. `pgrep -f` matched the text, so a `tersio doctor` run could report one or refuse a start; only a Python interpreter counts now.
- The proxy stops when the last agent session quits. Each session claims it, and a quit waits 2.5s before the stop so a restart does not race it. A session that dies without a quit stops refreshing its claim, which expires after 20 minutes.
- A confirm prompt still reads its answer after the hand-off: the CLI opens its stdin reader when a prompt needs it, not when it boots.
- The DSH plugin now activates from an npm install. The package root and `./dsh-plugin` export the compiled `dist/extensions/dsh/index.js` instead of raw TypeScript, which Node refuses to strip under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the entry never imported from the registry copy. Thanks to @nosidak (#91).
- The DSH plugin reads its mode rules from the package root when it runs from `dist/`, so the caveman, Ponytail and pstack bodies no longer fall back to "rule is missing" on an npm install.
- `rtk_run` in DeepSeek Harness answers the string its own schema declares. It returned `{ content }` against a `string` schema, so every call failed with `INVALID_TOOL_OUTPUT`. A command that exits non-zero now returns its output as text instead of throwing. Thanks to @nosidak (#93).

## v2.25.18

### Added
- The installer now asks before adding Tersio's MCP server to an agent. The question reads "Add the Tersio MCP server to … (optional)", so a machine that should stay untouched can say no.
- Agents get two new MCP tools: one lists every supported agent with its version and whether Tersio is connected, the other lists the newest sessions with their cost and tokens.
- An MCP client can read the saved settings and the agent list directly, without spending a tool call.
- A small Tersio pill now sits under the message box in DeepSeek Harness. It shows the current Combo with a puzzle icon and the word Off, Lite, Balanced or Max.
- Click the pill to open a card that switches the Combo, or any single mode on its own: Caveman, RTK, Headroom, Ponytail and pstack.
- The Headroom switch in that card reads and writes the same saved setting the installer, the command line and the dashboard use, so the three agree.
- Settings → Data can now send an encrypted copy of your Tersio data to WebDAV, S3 storage, or a private GitHub repository. You choose the passphrase once; old copies are listed by date and can be restored from there.
- A Test connection button proves the saved details can read, write, and delete in that account, so a storage service that only pretends to accept uploads is caught before you rely on it.
- Tersio now records DeepSeek Harness usage like every other agent: tokens, request time, first-response time, and which request each row came from.
- RTK now works in DeepSeek Harness with nothing extra to install. Once RTK is on, shell commands are shortened for you.

### Changed
- OpenCode is routed in both its versions. V2 keeps the endpoint under `providers.<id>.settings.baseURL` in `opencode.jsonc`, and V1 under `provider.<id>.api` or its options. A `.jsonc` file is edited in place, so its comments survive, and the route is refused rather than flattening a file it cannot put back.
- DeepSeek Harness pins its MCP command to the installed binary, because a GUI launch inherits no shell `PATH`.
- Tersio now writes the headroom endpoint for every agent itself, including omp and OpenCode. Uninstalling, or switching a route off, puts the old endpoint back from Tersio's own record; Tersio no longer asks headroom to unwrap anything.
- The Headroom card in the dashboard is one switch per agent: it points that agent's provider at the local proxy and keeps it there across restarts. The separate wrapped-tools list and the saved record of which tool was wrapped when are gone.
- Tersio no longer downloads, replaces, or removes the rtk program. `tersio install` uses the binary already on your machine, the way rtk's own docs describe. rtk is part of what Tersio ships, so a machine without it gets rtk's own quick install automatically — their `install.sh` script on macOS and Linux, `winget install rtk-ai.rtk` on Windows — with no question to answer. If the new rtk lands somewhere your shell cannot see yet, the install says exactly which line to add to your shell profile.
- `tersio doctor --fix` re-connects rtk instead of downloading it, and `tersio uninstall --remove-rtk` removes Tersio's connection but never your rtk program.
- `/tersio update rtk` and the dashboard card now tell you when rtk has a newer release and point you at rtk's installer, instead of downloading it for you.
- A mode change over MCP can now target one agent, the same way the dashboard and the installer already could.
- Switching a mode in DeepSeek Harness no longer posts a message in the conversation. The pill is the only feedback, like the other agents.
- The pill stays quiet until you hover over it or open it, and the card follows the app's own light and dark panels.
- Status lines now read `🧩 LITE | 🪨 caveman:LITE | 🗜️ rtk:ON | …`: the word COMBO is gone, and every mode uses a colon instead of an equals sign. Pi, OpenCode, Oh My Pi, the command line and the dashboard all follow it.
- Balanced no longer carries a "not recommended" note in the installer or the dashboard.
- The DeepSeek Harness status card is sized to its content, with one row per mode and a single sliding highlight instead of separate buttons. It no longer hides behind the message box.
- DeepSeek Harness sessions no longer show on the Traces page; that app keeps its own Trajectory view.
- Snapshots in Settings → Data select one at a time, with softer highlight colours.
- The same RTK command rewriting now serves Pi, Pi-In-Go, Oh My Pi, and DeepSeek Harness from one shared piece, so a fix reaches all of them at once.

### Fixed
- An MCP row the Harness patch targets is restated in full, so an override no longer drops `failOnStartupError` or the tool timeout. `tersio uninstall --host dsh` removes it with the bundle.
- Duplicate headroom proxies are found on Windows as well, so `tersio doctor --fix headroom` works there.
- Three doctor tests failed on a working checkout because they counted stale files; they now name the file instead of the count.
- Headroom's proxy no longer piles up. A session that found the health check slow used to start a second proxy, and nothing ever stopped it; on this machine eleven copies were holding about seven gigabytes. A start is now serialised across processes, a proxy on another port is never duplicated, and `tersio doctor --fix headroom` stops the duplicates and starts one where the routes expect it.
- A headroom binary that cannot be spawned no longer crashes the caller with an unhandled process error.
- OpenCode and omp are routed without headroom's own writer, so the off switch restores the file Tersio changed instead of depending on a command that may not exist.
- An omp model served by a gateway block (the usual magpie setup) is now routed under that block instead of failing with "not in the agent's catalog".
- `tersio doctor` names an agent whose headroom route drifted, and names a route that is in place.
- The RTK install gives up after two minutes instead of five when the machine is offline.
- Headroom's proxy now starts with the agent session, not only when the dashboard is open. A routed agent works after a reboot without anything else running first.
- DeepSeek Harness is routed on the profile the app is actually running. The old code always wrote the desktop profile, even when `dsh web` was the one in use.
- The first route for Pi, PiG or DeepSeek Harness now starts Headroom pointed at that agent's provider, instead of refusing with an instruction the user could not act on.
- Switching omp's route off puts its gateway address back and removes the marker Tersio wrote.
- A Headroom installed somewhere off `PATH` can be named with `TERSIO_HEADROOM_BIN`, instead of the install guessing.
- The Tersio pill in DeepSeek Harness no longer fails to come back after a page refresh or a plugin update. The page could not load the same file twice, so it now keeps its own names to itself.
- DeepSeek Harness no longer reports Tersio's MCP server as missing: its entry ships inside the plugin bundle, and the check now looks there.
- Agents launched from the desktop now find Tersio's MCP server. The entry stores the full path when the command is findable, and keeps the short name as a fallback.
- Adding the MCP entry to a commented OpenCode config no longer drops the comments.
- A long Headroom eval no longer fails before it finishes; the DeepSeek Harness client now waits long enough.
- Cancelling a tool call in the client now stops the work behind it.
- `tersio doctor` names any installed agent whose MCP entry is missing, with the command that fixes it.
- Quick start agent cards now show the Headroom setting you saved instead of replacing it with "unrouted". Hovering the row still warns when that agent has no live route, so the card never claims compression it is not getting.
- Remote backups survive a brief server hiccup: a failed request retries on its own instead of losing the run.
- A storage service hosted under a sub-path, a very long list of old copies, and a GitHub repository that does not sort its files are all handled now.
- A crash while saving sync settings can no longer wipe the saved passphrase.
- WebDAV folders that do not exist yet are created during the first backup.

## v2.25.17

### Added
- A Benchmark page for developers: every measured result in one place, with charts, the raw tables, and the notes each run wrote.
- A history window in Settings → Data. Keep usage for 7 days to a year, or forever.
- Tersio now works with DeepSeek Harness: install, update, remove, and dashboard support.
- The dashboard can open on your phone, with a QR code for the address.
- Models and providers now lead with token volume, with request share beside it.

### Changed
- Lite is the recommended Combo preset. Balanced is marked as not recommended.
- The readme lists the benchmark numbers in a single table, and the tagline no longer repeats the guide.
- The benchmark guide and its result files describe only what a run records. The command-surface rows and the unfilled review-round column are gone.
- The dashboard is faster and calmer: remembered ranges, smaller downloads, a cleaner layout, larger Settings, simpler drawers, and a clearer Add agent picker.
- The Upstream page now explains the scorecard in plain English: the pin, the copy, drift, gaps, what is lacking, and the full ledger. The radar chart stays, and the agent table lists Tersio hosts only.
- The benchmark guide is now `docs/BENCHMARK.md`, and the old per-agent result files are gone. Results use one file per mode or stack: `BENCH_CAVEMAN`, `BENCH_PONYTAIL`, `BENCH_RTK`, `BENCH_HEADROOM`, `BENCH_PSTACK`, `BENCH_COMBO`, `BENCH_COMBO_HEADROOM`, `BENCH_COMBO_PSTACK`, and `BENCH_COMBO_ALL`. The guide adds a Headroom compression check that reads proxy JSONL and verifies a token drop plus the surviving sentinel.
- The Upstream gaps block now groups uncarried upstream, local paths, and agent drift with repair commands. The Agents table keeps one State cell instead of separate Stale, Missing, and Unloaded columns. The duplicate Gaps card is gone, and the check card fills its row with the last run.
- The dashboard keeps fewer loose files. Saved records, caches, prices, upstream data, brand marks, Headroom state, and session state now live in fewer places.
- The dashboard watch prints only the live, LAN, and QR lines. Restarts and UI errors stay quiet, and a missing build returns a retry page.
- Quick start agent cards read `unrouted` for Headroom when the session default is on but that agent has no route. They no longer claim compression a host does not get.
- Oh My Pi and OpenCode now read the active model route too. A leftover Headroom config block no longer makes the drawer or the host card claim compression.
- Brand logos load when needed and stay cached.
- The Headroom drawer lists only tools it can really set up. ZCode and Continue are gone.
- Switches explain what changed, and failed actions show the real reason.
- RTK setup is one request to RTK. Tersio no longer edits agent config itself.
- Ponytail uses one rule file and modern files. Old copies are ignored.
- `tersio update` updates Tersio only. Add-ons refresh per agent with `tersio update --host <agent>`.
- A scripted install prints one line about optional Headroom.
- Tokscale is no longer credited.
- Behind the scenes, agent support, dashboard data, and usage code now share one source, so future changes are smaller.
- Headroom now routes Pi, PiG, and DeepSeek Harness through their active provider endpoint. The install and the Quick start switch save the old endpoint and restore it on off.
- The Headroom drawer lists Tersio's five agents only. Claude Code and Codex rows are gone. A present agent without its Tersio tree reads as Tersio missing and offers Install.
- The Add agent picker hides an empty group. Claude Code and Codex leave that picker too, so only PiG remains under Unavailable.
- An OpenCode plugin entry that outlives its tree now reads as declared, so the install menu and doctor name the missing tree instead of the whole agent.

### Fixed
- A Headroom route that another tool reset is put back automatically at the next session, so you no longer edit the gateway by hand.
- The dashboard action button follows your accent colour instead of staying green.
- The check icon on the Upstream page spins while a check runs.
- A Headroom switch writes the provider block an agent keeps in its own catalog. Pi and PiG take the endpoint and models from `models-store.json`, so a provider with no `models.json` block is routed without a hand edit, and the same path serves omp.
- Oh My Pi routes a model whose id names a provider it keeps built-in, such as `commandcode/...`. Tersio writes the block that provider needs and reads its real endpoint from omp's model cache, so the route chip no longer says `routed via magpie` while traffic leaves for the provider's own API.
- A model that names its own endpoint is routed with its provider. Pi, PiG, and Oh My Pi read and write both.
- Oh My Pi routes the provider of the active role, not the first local gateway in the file.
- A Headroom route now reports what its reader sees. A write that leaves traffic bypassing the proxy is rolled back.
- The Headroom warning names the command that routes the agent.
- Headroom now tells the truth: it starts its runtime before enabling, waits for the runtime, refuses to claim compression when traffic does not use it, and shows live counters and routing.
- Compressed content can be retrieved through Tersio's own MCP server. One shared entry covers OMP, Pi, PiG, and OpenCode.
- Headroom can use a local model gateway as its upstream and records the original address for undo. Some gateways rewrite their own settings, so reapply the Headroom setup after changing models.
- Headroom fallback keeps the saved mode and connection style, and every Headroom writer uses the same proxy address.
- RTK setup is one command per agent. PiG gets the Pi hook.
- Doctor treats leftover files as not installed, stops touching agents you do not have, and leaves the DeepSeek Harness desktop profile alone.
- pstack and Ponytail track their upstreams again. Ponytail moves to 5.3.3, and missing pstack skills now ship.
- Closing the dashboard releases the port. Requests are no longer counted twice. History survives updates and resets.
- Install keeps each agent's own settings, model logos are correct, and uninstalled tools read as uninstalled.
- Uninstalling OpenCode removes the plugin paths it wrote, so a stale Tersio entry no longer survives.
- Uninstalling an agent now removes its Headroom route first: Headroom's unwrap for Oh My Pi and OpenCode, and the saved endpoint for Pi, PiG, and DeepSeek Harness.
- A Headroom route is refused when the proxy names no upstream for that protocol, or forwards to another provider. An agent cannot silently send traffic to the wrong upstream.
- No stray files are left in your projects.
- A saved agent card can no longer sit on another card and hide it. The Quick start page draws the agent group in three columns again.
- The default agent group uses your saved position. A fourth agent starts a new row under the first column.

## v2.25.16

### Added
 - **`inherit` is a first-class value.** A `hosts.<agent>` section stores only real overrides, `inherit` returns a field to the shared store, and `tersio doctor` prints the shared defaults plus each agent's overrides.
 - **The OMP plugin manifest defaults every mode setting to `inherit`**, so `omp plugin config get` follows Tersio's store instead of reporting a second, contradictory default.

### Fixed
 - **Ponytail skills load on OMP.** The install registers the bundled skills directory in OMP's `skills.customDirectories` and uninstall removes it; OMP's plugin manifest has no skills field, so the old declaration was ignored.

## v2.25.15

### Added
 - **PiG (Pi-in-go) support.** `tersio install --host pig` sets Tersio up for PiG the same way it does for the other agents: its extensions, RTK, the session modes, and Ponytail. The doctor, uninstall, the upstream check, and the Quick start page know the host too. Thanks to @trun9ko33 (#77).
 - **Headroom mode.** [Headroom](https://github.com/headroomlabs-ai/headroom) shrinks what an agent reads and writes. Turn it on with `/headroom on`, see it in the status line, and the Combo presets leave it alone. A missing binary is named, never installed silently.
 - **Headroom in the dashboard.** An Install button when it is missing, a card with the savings it records, and a session-start switch in Settings.
 - **`tersio_headroom` on the MCP server** reports those savings, and can also ask Headroom for its memory, its evals, or its dashboard.
 - **Per-agent session defaults.** An install for one agent can save its own preset, so each agent starts the way you set it.
 - A `--headroom-default on|off` flag.
 - **Uninstall asks what to remove.** One Enter-driven list: your agents, the RTK binary, or the Headroom binary. Removing Headroom unwraps its agents first.
 - **Headroom lifecycle.** `tersio update` refreshes it, turning the mode off unwraps, and the switch state is shared by every browser and corrected from Headroom's own check.
 - **The installer asks about Headroom** right after the preset.
 - **A fullscreen Quick start canvas.** Drag nodes anywhere, snap them to each other, and the layout is remembered on the machine.
 - **Node options open in place.** Mode dialogs, agent drawers, and for Headroom a switch per supported tool with a footer that updates or removes it. The Modes tab is gone; its rows live here.
 - **Headroom on the upstream check**, so `tersio upstream` says when it is behind. A failed install shows the reason instead of spinning.
 - A slow read says "Still reading your sessions" with a retry instead of waiting forever, and the sidebar keeps every item visible, dimmed while loading.
 - The developer switch survives a refresh.
 - **`tersio mcp`** lets an MCP client read usage, see what changed, and set modes without opening the dashboard.

### Fixed
 - The updater no longer ships as an extension, so pi starts again.
 - The update check names the Caveman rule's version, and no longer claims Ponytail is missing.
 - `/new` on Oh My Pi starts with your defaults again. Thanks to @FrancoStino (#74).

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

[Showing lines 1-372 of 375 (50.0KB limit). Use offset=373 to continue.]