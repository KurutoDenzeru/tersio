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
