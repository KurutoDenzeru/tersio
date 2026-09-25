![Banner](/assets/Banner.webp)

# ✂️ Tersio — Token-saving OMP Add-ons

[![npm version](https://shieldcn.dev/npm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![node](https://shieldcn.dev/badge/node-%3E%3D20.12-22c55e.svg?variant=branded&size=xs&logo=nodedotjs)](https://nodejs.org)
[![npm downloads](https://shieldcn.dev/npm/dm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![Build](https://shieldcn.dev/github/ci/KurutoDenzeru/tersio.svg?variant=branded&size=xs&logo=githubactions&label=Build)](https://github.com/KurutoDenzeru/tersio/actions)
[![MIT](https://shieldcn.dev/badge/license-MIT-2563eb.svg?variant=branded&size=xs&logo=opensourceinitiative)](./LICENSE)

 Terse replies, compact shell output, and minimal code decisions for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) — one-command combo presets.

## ⚡ Getting Started

**Default** (macOS/Linux/WSL) — one line. Installs the CLI via npm, then runs the main installer (scope + Combo preset menus) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

Prefer OMP-managed updates? Install as an OMP plugin instead:

```bash
omp plugin install @krtclcdy/tersio
```

All modes load always. Only the updater stays toggleable:

```bash
omp plugin features @krtclcdy/tersio --disable updater
```

Then restart OMP and enable a preset:

```text
/combo balanced
```

Individual toggles: `/caveman full` · `/rtk on` · `/ponytail full`. Everything starts off until you enable it.

When Tersio is installed through OMP, the first interactive launch asks for a session-start Combo preset once (`off`, `medium`, `balanced`, or `max`) and saves it as `comboDefault`. Running `tersio install` performs the same setup through the CLI.

Session-start defaults (prompted during `install`, or flags):

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Defaults apply to fresh sessions only — anything persisted with `/combo`, `/caveman`, or `/rtk` wins. Stored as plugin settings (`omp plugin config get @krtclcdy/tersio comboDefault`).

One-off use without installing:

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

### Requirements

- [OMP](https://github.com/can1357/oh-my-pi)
- Node.js 20.12+ with npm

Windows/WSL have separate OMP homes — install from the environment where OMP runs. Inside WSL, `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

## 📊 Benchmarks

Measured surfaces use different boundaries. Do not treat reply-text, code-diff, and shell-output reductions as total bill savings. Full protocol and caveats are in [BENCHMARK.md](./BENCHMARK.md).

| Measured surface (n) | Baseline → Tersio | Δ |
|---|---|---|
| Terse reply, caveman lite — BPE tokens (3 samples, p50) | 173 → 69 | **−60.1% reply text** |
| Terse reply, caveman full — BPE tokens (3 samples, p50) | 173 → 49 | **−71.7% reply text** |
| Terse reply, caveman ultra — BPE tokens (3 samples, p50) | 173 → 25 | **−85.5% reply text** |
| Code diff, ponytail lite — BPE tokens (2 tasks) | 326–462 → 57–121 | **−73.8…−82.5% diff** |
| Code diff, ponytail full — BPE tokens (2 tasks) | 326–462 → 55–88 | **−81.0…−83.1% diff** |
| Code diff, ponytail ultra — BPE tokens (2 tasks) | 326–462 → 40–88 | **−81.0…−87.7% diff** |
| Shell output, rtk `git status` | 182 → 72 | **−60.4% command output** |
| Shell output, rtk repo `grep` | 376 → 274 | **−27.1% command output** |
| Shell output, rtk `find` | 205 → 168 | **−18.0% command output** |
| Shell output, rtk `git diff` | 12,684 → 8,504 | **−33.0% command output** |

The Command tools table reports weighted RTK command-output savings and OMP-specific adoption from executed Bash records. It does not estimate provider billing.
Upstream Ponytail's fair agentic benchmark reports 54% less code, 22% fewer tokens, 20% lower cost, and 100% retained safety. RTK estimates command-output tokens, not bill savings. Caveman and Ponytail compliance varies by model. Measure your own sessions with `tersio usage` and the dashboard.


## 📈 Dashboard

`tersio dashboard --open` serves a local dashboard (127.0.0.1 only) that charts your own savings from `~/.tersio/usage.db`. Three views:

**Live feed and savings.** Token throughput, cost, savings bento, and recent activity — the top of the dashboard.

![Dashboard: live token feed, cost, savings, and activity](/assets/GainHero.webp)

**Top models and recent requests.** Per-model cost breakdown plus the last requests with elapsed time and token speed.

![Dashboard: top models with per-model cost, recent requests with elapsed time and token speed](/assets/GainModels.webp)

**Command tools.** Token savings, average rate, and timing per shell tool.

![Dashboard: command tools with token savings, average rate, and timing](/assets/GainTools.webp)

### Measurement references

- **[EcoLogits](https://github.com/mlco2/ecologits)** informs Tersio's local CO₂ and energy estimates. Tersio ports the model to TypeScript; EcoLogits is not a runtime dependency.
- **[Tokscale](https://github.com/junhoyeo/tokscale)** informs Tersio's Input, Output, Cache Read, and Cache Write accounting from local OMP sessions. Tokscale is a reference, not a runtime dependency.

## 🖥️ CLI

| Command | Purpose |
|---|---|
| `tersio install` | Install (user scope: all OMP sessions) |
| `tersio update` | Refresh the CLI, extensions, and add-ons (RTK binary, Caveman rule, Ponytail) |
| `tersio reinstall` | Fresh install, preserving the Ponytail package |
| `tersio doctor` | Check OMP, extension, Ponytail, and RTK health (`--fix` repairs, `--fix=<scope>` one scope, `--dry-run` previews) |
| `tersio usage` | Ledger-backed usage + savings report |
| `tersio dashboard` | Open the Dashboard (`--open`, `--export <file>`, `--port <n>`, `--currency <code>`; serves localhost only) |
| `tersio reset` | Clear tersio statistics: usage ledger + a watermark that hides pre-reset rows from every derived view (Y/N confirm, `--dry-run`, `--yes`) — session transcripts and RTK history stay intact on disk |
| `tersio uninstall` | Remove extensions, registration, and the Ponytail plugin (`--keep-ponytail` keeps Ponytail; `--remove-rtk` also removes the RTK binary and its `rtk.ts` OMP wiring) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`, `--currency <code>` (usage/dashboard display currency; flag wins, then the `tersio settings` default, then USD). Legacy `--doctor` / `--uninstall` forms still work.

## ⌨️ Commands reference

Mode switches live on their own commands; bare `/tersio` prints status.

| Command | Purpose |
|---|---|
| `/combo off\|medium\|balanced\|max\|status` | One preset for all three (start here): medium = lite/lite/on, balanced = full/full/on, max = ultra/ultra/on; per-mode tweaks drop to `custom`. |
| `/caveman lite\|full\|ultra\|wenyan-lite\|wenyan-full\|wenyan-ultra\|off\|status` | Terse replies with upstream-aligned Caveman levels. Legacy `wenyan` restores as `wenyan-full`. |
| `/rtk on\|off\|status` | Controls RTK session guidance, `rtk_run`, and the automatic hook through shared `RTK_DISABLED` state. Exact bytes bypass RTK. |
| `/ponytail off\|lite\|full\|ultra\|status` | Minimal code using upstream Ponytail modes. Review runs separately through `/ponytail-review`. |
| `/tersio status` | Active modes + combo level; state persists, propagates to subagents, and lights the Combo footer indicator. |
| `/tersio check` | Add-on version check |
| `/tersio update <ponytail\|rtk\|caveman\|all> [--dry-run]` | Update add-ons, preview with dry-run |
| `/tersio dashboard` | Open the Dashboard. |
| `/tersio usage` | Ledger report for this machine (rows in `~/.tersio/usage.db`, local only) |
| `/tersio help` | This table |
| `/ai-addons` | Add-on updater alias, still works. |

## 🗂️ Files and backups

| What | Path |
|---|---|
| Caveman / RTK / Combo / Tersio commands | `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/{caveman-session,rtk-session,combo-toggle,tersio-commands}/` — loaded from Tersio's OMP plugin manifest |
| RTK OMP wiring (rtk-owned) | `~/.omp/agent/extensions/rtk.ts` — written by the installer via `rtk init -g --agent omp`; auto-loads, no config entry |
| Ponytail package (bundled Tersio dependency — one Plugins row, updates with `tersio update`) | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` — loaded as a nested plugin dependency |
| RTK binary | Installer writes `~/.bun/bin/rtk` (`rtk.exe` on Windows). Runtime resolves `PATH` first, then this managed path. |
| Legacy config cleanup | `~/.omp/agent/config.yml` — doctor removes retired or duplicate extension entries |

The installer writes `<file>.bak` before replacing an extension source; the updater keeps `rtk.bak` / `rule.md.bak` and restores them if the replacement fails validation.

User-level installs also register the package in `~/.omp/plugins` (visible in OMP **Settings → Plugins**), directly through the plugin manifest. Active modes reassert after Ponytail's prompt block on every top-level turn, including after history compaction.

## 🛠️ Troubleshooting

**Ponytail or Combo command missing:** confirm `~/.omp/plugins/package.json` lists `@krtclcdy/tersio`, then run `tersio reinstall`, restart OMP, and check `tersio doctor`.

**RTK missing or not executable:** run `tersio reinstall`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`.

**RTK commands not metered in the Dashboard:** check `tersio doctor` — the `RTK OMP wiring (rtk.ts)` row must be ok. Missing: run `rtk init -g --agent omp` (needs rtk ≥ 0.49) and restart OMP. Native tool calls (`read`/`edit`/`eval`) stay unmetered — only bash tool calls pass through rtk.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/tersio update rtk` aborts when metadata is missing.

## 🤝🏻 Contributing

Contributions are always welcome, whether you're fixing bugs, improving docs, or shipping new features that make the project better for everyone.

Check out [Contributing.md](Contributing.md) to learn how to get started and follow the recommended workflow.

## ⚖️ License

This project is released under the MIT License, giving you the freedom to use, modify, and distribute the code with minimal restrictions.

For the full legal text, see the [LICENSE](LICENSE) file.
