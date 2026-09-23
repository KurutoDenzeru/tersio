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

Measured savings against the same workload without the modes. Token counts are real `o200k_base` BPE tokens (js-tiktoken), not chars÷4 estimates. Sample protocol, per-sample data, and caveats in [BENCHMARK.md](./BENCHMARK.md).

| Measured surface (n) | Baseline → Tersio | Δ |
|---|---|---|
| Terse reply, caveman lite — BPE tok (3 samples, p50) | 173 → 69 tok | **−60.1%** |
| Terse reply, caveman full — BPE tok (3 samples, p50) | 173 → 49 tok | **−71.7%** |
| Terse reply, caveman ultra — BPE tok (3 samples, p50) | 173 → 25 tok | **−85.5%** |
| Code diff, ponytail lite — BPE tok (2 tasks) | 326–462 → 57–121 tok | **−73.8…−82.5%** |
| Code diff, ponytail full — BPE tok (2 tasks) | 326–462 → 55–88 tok | **−81.0…−83.1%** |
| Code diff, ponytail ultra — BPE tok (2 tasks) | 326–462 → 40–88 tok | **−81.0…−87.7%** |
| Shell output, rtk — `git status` — BPE tok | 182 → 72 tok | **−60.4%** |
| Shell output, rtk — repo `grep` — BPE tok | 376 → 274 tok | **−27.1%** |
| Shell output, rtk — `find` — BPE tok | 205 → 168 tok | **−18.0%** |
| Shell output, rtk — `git diff` — BPE tok | 12,684 → 8,504 tok | **−33.0%** |
| Shell output, rtk — `npm test` (passthrough) — BPE tok | 2,597 → 2,577 tok | **−0.8%** |

Break-even math, balanced preset (caveman full + rtk + ponytail): a mixed turn costs 941 tok baseline vs 399 with Tersio (0.42×, **−57.6% per turn**). Overhead repays in turn 1 with the bundled floor (464 tok); turn 4 with the real installed Ponytail plugin (v4.9.0, 1,264 tok). RTK concentrates savings where noise lives — hook-wired sessions record **−97.5% on summarized test suites** (rtk `history.db`, 4 runs).

## 📈 Gain Dashboard

`tersio gain --open` serves a local dashboard (127.0.0.1 only) that charts your own savings from `~/.omp/plugins/tersio-usage.jsonl`. Three views:

**Live feed and savings.** Token throughput, cost, savings bento, and recent activity — the top of the dashboard.

![Gain dashboard: live token feed, cost, savings, and activity](/assets/GainHero.webp)

**Top models and recent requests.** Per-model cost breakdown plus the last requests with elapsed time and token speed.

![Gain dashboard: top models with per-model cost, recent requests with elapsed time and token speed](/assets/GainModels.webp)

**Command tools.** Token savings, average rate, and timing per shell tool.

![Gain dashboard: command tools with token savings, average rate, and timing](/assets/GainTools.webp)

## 🖥️ CLI

| Command | Purpose |
|---|---|
| `tersio install` | Install (user scope: all OMP sessions) |
| `tersio update` | Refresh the CLI, extensions, and add-ons (RTK binary, Caveman rule, Ponytail) |
| `tersio reinstall` | Fresh install, preserving the Ponytail package |
| `tersio doctor` | Check OMP, extension, Ponytail, and RTK health (`--fix` repairs, `--fix=<scope>` one scope, `--dry-run` previews) |
| `tersio usage` | Ledger-backed usage + savings report |
| `tersio gain` | Open the gain dashboard (`--open`, `--export <file>`, `--port <n>`, `--currency <code>`; serves localhost only) |
| `tersio reset` | Clear tersio statistics: usage ledger + a watermark that hides pre-reset rows from every derived view (Y/N confirm, `--dry-run`, `--yes`) — session transcripts and RTK history stay intact on disk |
| `tersio uninstall` | Remove extensions, registration, and the Ponytail plugin (`--keep-ponytail` keeps Ponytail; `--remove-rtk` also removes the RTK binary and its `rtk.ts` OMP wiring) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`, `--currency <code>` (usage|gain display currency; flag wins, then the `tersio settings` default, then USD). Legacy `--doctor` / `--uninstall` forms still work.

## ⌨️ Commands reference

Mode switches live on their own commands; bare `/tersio` prints status.

| Command | Purpose |
|---|---|
| `/combo off\|medium\|balanced\|max\|status` | One preset for all three (start here): medium = lite/lite/on, balanced = full/full/on, max = ultra/ultra/on; per-mode tweaks drop to `custom`. |
| `/caveman lite\|full\|ultra\|wenyan\|off\|status` | Terse replies (substance stays); `ultra` uses fragments only, `wenyan` a compressed classical-Chinese-inspired register. |
| `/rtk on\|off\|status` | Compact shell output via the real `rtk` binary; exact bytes (checksums, patches) bypass it by policy. |
| `/ponytail off\|lite\|full\|ultra\|review\|status` | Minimal code (YAGNI): `lite` nudges, `full` enforces, `ultra` challenges the requirement, `review` audits for over-engineering (upstream command). |
| `/tersio status` | Active modes + combo level; state persists, propagates to subagents, and lights the Combo footer indicator. |
| `/tersio check` | Add-on version check |
| `/tersio update <ponytail\|rtk\|caveman\|all> [--dry-run]` | Update add-ons, preview with dry-run |
| `/tersio gain` | Savings summary; the gain dashboard charts `~/.omp/plugins/tersio-usage.jsonl` (`tersio gain --open` serves on 127.0.0.1, `--export` writes one file). |
| `/tersio usage` | Ledger report for this machine (rows in `~/.omp/plugins/tersio-usage.jsonl`, local only) |
| `/tersio help` | This table |
| `/ai-addons` | Add-on updater alias, still works. |

## 🗂️ Files and backups

| What | Path |
|---|---|
| Caveman / RTK / Updater / Combo extensions | `~/.omp/agent/extensions/{caveman-session,rtk-session,ai-addons-updater,combo-toggle}/` |
| RTK OMP wiring (rtk-owned) | `~/.omp/agent/extensions/rtk.ts` — written by the installer via `rtk init -g --agent omp`; auto-loads, no config entry |
| Ponytail package (bundled tersio dependency — one Plugins row, updates with `tersio update`) | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows) |
| Extension registrations | `~/.omp/agent/config.yml` |

The installer writes `<file>.bak` before replacing an extension source; the updater keeps `rtk.bak` / `rule.md.bak` and restores them if the replacement fails validation.

User-level installs also register the package in `~/.omp/plugins` (visible in OMP **Settings → Plugins**), directly through the plugin manifest. Active modes reassert after Ponytail's prompt block on every top-level turn, including after history compaction.

## 🛠️ Troubleshooting

**Ponytail or Combo command missing:** run `tersio reinstall` in OMP's environment, restart OMP, then `tersio doctor` (repairs `config.yml` registrations).

**RTK missing or not executable:** run `tersio reinstall`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`.

**RTK commands not metered in the gain dashboard:** check `tersio doctor` — the `RTK OMP wiring (rtk.ts)` row must be ok. Missing: run `rtk init -g --agent omp` (needs rtk ≥ 0.49) and restart OMP. Native tool calls (`read`/`edit`/`eval`) stay unmetered — only bash tool calls pass through rtk.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/tersio update rtk` aborts when metadata is missing.

## 🤝🏻 Contributing

Contributions are always welcome, whether you're fixing bugs, improving docs, or shipping new features that make the project better for everyone.

Check out [Contributing.md](Contributing.md) to learn how to get started and follow the recommended workflow.

## ⚖️ License

This project is released under the MIT License, giving you the freedom to use, modify, and distribute the code with minimal restrictions.

For the full legal text, see the [LICENSE](LICENSE) file.
