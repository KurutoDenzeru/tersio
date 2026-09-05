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
- Initial release of the maintained fork of [Fernado03/oh-my-pi-supreme-token-saver](https://github.com/Fernado03/oh-my-pi-supreme-token-saver) (unmaintained upstream, releases v1.2.1–v1.3.10).
- Published to npm as `oh-my-pi-token-saver`; the CLI command is now `oh-my-pi-token-saver`.
- Carries over upstream behavior: Caveman, RTK, and Ponytail session modes; Combo presets; `/ai-addons` updater with dry-run; passive Amanai reward detector; installer subcommands (`install`, `update`, `reinstall`, `doctor`, `uninstall`, `version`, `help`) with `--scope`, `--dry-run`, `--yes`, and `--verbose`.
