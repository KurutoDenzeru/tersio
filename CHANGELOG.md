## Unreleased
 - Adds OpenCode support: `tersio install` writes an RTK rewrite plugin to `~/.config/opencode/plugins/tersio-rtk.ts` plus a marked `tersio:rtk` guidance block in `~/.config/opencode/AGENTS.md`. Verified in a live session — `ls -la cli` rewrote to `rtk ls -la cli` and metered 705 → 239 tokens.
 - OpenCode needs a Tersio-owned plugin because `rtk init --opencode` still emits one in a format OpenCode rejects (rtk#3463, rtk#3898). The plugin is self-contained (no `@opencode/plugin` import), fails open, skips already-routed commands, and honors `TERSIO_RTK=off`.
 - Doctor reports the OpenCode plugin and guidance as warnings when absent, since OpenCode is an optional second host. `tersio uninstall --remove-rtk` removes the plugin and strips only the marked block from `AGENTS.md`.
 - `doctor --fix rtk` now repairs the OpenCode plugin and its AGENTS.md guidance, and runs that write before the rtk download so a network failure no longer leaves the OpenCode rows unrepaired. Regression test drives the real CLI with no `PATH`, proving the repair survives a failed download.
 - Install now asks which coding agents to install for, via a Clack multiselect (`omp`, `opencode`). The choice persists in `~/.tersio/agents.json`, is settable non-interactively with `--agent omp,opencode`, and is editable later with `tersio settings agents`. Hosts are resolved before the Combo preset question, so an OpenCode-only run never asks about OMP-only modes. Non-interactive runs auto-detect, keeping `install --yes` and CI unchanged.
 - Adds the nine remaining coding agents from #17: Claude Code, OpenAI Codex, Gemini CLI, GitHub Copilot CLI, Cursor, Grok Build, Pi, OpenClaw, and Hermes. Each gets a marked rules block, per-mode Agent Skills, and — where the host documents a pre-execution hook — an RTK shell-rewrite hook generated for that host's exact wire protocol (five distinct ones). `tersio install` now offers all eleven hosts in the agent multiselect and `--agent` accepts any of them.
 - Fixes `--agent` silently keeping only the first value when repeated (`--agent omp --agent cursor` installed omp alone); it now unions every occurrence, accepts `--agent=` inline form, and rejects a missing value with the valid list.
 - Uninstall now previews every selected agent, not just Oh My Pi and OpenCode, so the consent prompt shows what a non-OMP machine will lose.
 - Reframes the docs around the unified CLI: new `INSTALL.md` covers the install and agent-selection flow end to end, and the README leads with `tersio install` and `--agent` rather than the Oh My Pi plugin. Version-specific OpenCode wording is replaced with plain "OpenCode" throughout.
 - Fixes the install agent menu never appearing once a choice was stored. `~/.tersio/agents.json` was returned before the prompt, so anyone who installed before the multiselect existed could not see or change their host selection from the install flow at all. The prompt is now asked at a terminal even when a choice exists, seeded with it; `--yes`, CI, pipes, and `--apply-update` still skip straight to the stored value or detection.
 - Agent menu hints now describe what each host actually gets (live extensions vs rules pack, rtk hook vs guidance) in a short form that fits an 80-column terminal, and mark hosts already present on the machine with a check.
 - The bare `tersio` menu no longer carries a separate **Coding agents** entry: agent selection now happens inside the install flow, so a second route to the same choice was redundant.
 - Uninstall now previews only the agents that actually have Tersio files on disk, and removes exactly those. It previously listed the whole stored selection — a host that was selected but never installed appeared in the consent prompt, and removal ran over hosts that had no files. Each candidate is now probed for its own artifacts, OpenCode's own marker and plugin file included, and each host is listed with what it actually has.
 - The bare `tersio` menu drops the unreachable `update` case: the update offer is asked before the menu renders, so a declined update could never reach it. **Install** and **Reinstall** stay separate rows, with hints saying which one clears stale files — `doctor --fix` restores what is missing but never deletes leftovers, so only a reinstall does that.
 - **Fixes Pi's RTK rewrite never loading.** Pi was registered with a hook config pointing at `~/.pi/agent/extensions/tersio-rtk.ts`, so the generic emitter wrote a 288-byte JSON object into a `.ts` path. Pi loads that directory through jiti, so the file failed to parse (`Expected ';', '}' or <eof>`) and bash commands were never rewritten — while doctor still reported a hook as present. Pi now gets its rewrite from `rtk init -g --agent pi`, which writes the real ~4.8 KB TypeScript extension (byte-identical to OMP's). Verified in a live install, and a regression test asserts the file parses as a Pi module rather than a bare JSON object.
 - Pi wiring now checks the binary advertises `--agent pi` before running it. rtk 0.49 added that agent; an older binary ignores the flag and writes an OMP extension instead, which looked like success while leaving Pi unwired.
 - Installing for Pi now repairs machines already broken by the bug above. rtk refuses to overwrite a file it did not write, and in a non-interactive shell it defaults to "no" and ignores stdin, so those installs stayed broken however many times the user reinstalled. A leftover that is not a Pi module is removed before `rtk init` runs; verified against rtk 0.50, taking an 18-byte JSON leftover to a working 4,815-byte extension.
 - Dead code removed: `HOME_REL` (identity function, zero references), `renderRulesFile` (exported, never called), the `CAVEMAN`/`PONYTAIL` rule-text exports (only their command bodies are used), and `CO2_G_PER_1K_OUTPUT` (superseded by `./carbon.ts`).
 - Duplication removed: doctor's absolute-date formatter and dashboard's relative-age copy now share `common.ts`; the "a newer version exists" prompt had two identical copies in `install.ts` and now has one; the five session-lifecycle event handlers repeated in both mode extensions now come from one `registerSessionLifecycle` in `shared/session-state.ts`.
 - The uninstall preview now lists only files that exist. It previously promised to remove every OMP extension directory on any machine, including Pi-only and OpenCode-only installs that never had them, which buried the line that mattered. Pi's rtk extension is listed and removed with the rtk binary, matching how OMP's already worked.
 - Four uninstall dry-run tests were asserting against a deliberately-missing `HOME`, so they passed by demanding the old always-list-the-everything output rather than the behavior they described. They now seed the files they claim to preview.
 - **Fixes `/ai-addons` failing to load entirely.** `RtkRelease` is an interface but was imported as a value. TypeScript erases it at build, so `bun run build` and the test suite both passed, but OMP loads the `.ts` through jiti and Node then threw `does not provide an export named 'RtkRelease'` — taking the whole updater extension down. Confirmed in the live install at `~/.omp/plugins/node_modules/@krtclcdy/tersio`.
 - New test loads every OMP extension the way OMP does — raw Node against the `.ts` — because a vitest import erases type-only imports and cannot see this class of failure. It also asserts each extension registers its slash command, that `rtk-session` registers the `rtk_run` tool, and that the plugin manifest lists every one of them, so an unlisted extension can no longer go quietly missing. The manifest is read with `fs` rather than `import("package.json")`, because the repo-integrity guard requires every relative import in a tracked source to resolve to a `.ts` file.
 - The OpenCode RTK plugin is now tested by driving its `execute.before` hook the way OpenCode does, rather than by starting a session. Every available model on the development machine is credit-limited, region-blocked, or missing a key, so a live session could not be used as evidence; the hook takes no model input, so driving it directly proves the wiring. The test pins that a noisy command is rewritten in place, an already-`rtk` command is not double-prefixed, non-shell tools are ignored, and `TERSIO_RTK=off` registers no hook. Removing the rewrite line makes it fail.
 - The rtk test stub now answers `rewrite` as well as `init`, so tests that exercise a rewriter no longer depend on a real rtk being installed. That dependency is what made the OpenCode plugin test pass locally and fail in CI: with no rtk on the runner the hook correctly fails open, and the test read that as a broken rewrite.
 - OpenCode now gets slash commands: `/caveman`, `/rtk`, `/ponytail`, and `/combo`, written to `~/.config/opencode/commands/` as markdown files with `$ARGUMENTS` ([OpenCode docs](https://opencode.ai/docs/commands)). The mode text is derived from the same `rules-pack` bodies every other host receives, so it cannot drift. These are prompt templates, not runtime toggles — an OpenCode command sends text to the model and cannot flip state the way OMP's does, so the prompt states the mode for the rest of the conversation instead of claiming a toggle the host cannot perform.
 - Corrects a documentation claim that was simply wrong. The README, INSTALL.md, and this PR all said slash commands were "OMP-only by design". A review of each host's own documentation found that **every** supported host has some command mechanism: Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor, Grok Build, Pi, OpenClaw, and Hermes all accept user commands, most of them prompt-shaped. The claim survived because it was only ever prose — nothing in `cli/agent-hosts.ts` modeled command capability, so no test could contradict it.
 - A finding worth more than the commands: Claude Code merged custom commands into skills, and Tersio already installs `~/.claude/skills/tersio-<mode>/SKILL.md`. Those are invocable as `/tersio-caveman` today, so that host has always had working mode commands. The same is true wherever a host surfaces skills as commands.

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
