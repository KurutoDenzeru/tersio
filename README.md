# Tersio ✂️

[![npm version](https://img.shields.io/npm/v/@krtclcdy%2Ftersio?color=cb0000)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![release](https://img.shields.io/github/v/release/KurutoDenzeru/tersio?color=7c3aed)](https://github.com/KurutoDenzeru/tersio/releases)
[![license](https://img.shields.io/badge/license-MIT-6e7681)](./LICENSE)
[![node](https://img.shields.io/node/v/@krtclcdy%2Ftersio?color=30363d)](https://nodejs.org)
[![CI](https://github.com/KurutoDenzeru/tersio/actions/workflows/ci.yml/badge.svg)](https://github.com/KurutoDenzeru/tersio/actions)
[![issues](https://img.shields.io/github/issues/KurutoDenzeru/tersio?color=d97706)](https://github.com/KurutoDenzeru/tersio/issues)

Terse replies, compact shell output, and minimal code decisions for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi).

## Install

**Default** (macOS/Linux/WSL) — one line. Installs the CLI via npm, then runs the main installer (scope + Combo preset menus) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

Prefer OMP-managed updates and feature flags? Install as an OMP plugin instead:

```bash
omp plugin install @krtclcdy/tersio
```

Subset only:

```bash
omp plugin install '@krtclcdy/tersio[caveman,ponytail]'
omp plugin features @krtclcdy/tersio --disable rtk
```

Then restart OMP and enable a preset:

```text
/tersio combo medium
```

Individual toggles: `/tersio caveman full` · `/tersio rtk on` · `/tersio ponytail full`. Everything starts off until you enable it.

Session-start defaults (prompted during `install`, or flags):

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Defaults apply to fresh sessions only — anything persisted with `/tersio combo`, `/tersio caveman`, or `/tersio rtk` wins. Stored as plugin settings (`omp plugin config get @krtclcdy/tersio comboDefault`).

## What it installs

| Add-on | What it does |
|---|---|
| **Caveman** | Shortens replies, keeps technical substance. Modes: `lite`, `full`, `ultra`, `wenyan` |
| **RTK** | Routes noisy shell commands through the RTK binary for compact output |
| **Ponytail** | Minimal, YAGNI-oriented code decisions |
| **Combo** | Toggles all three at once. Presets: `off`, `medium`, `balanced`, `max` |
| **Updater** | `/tersio check` and `/tersio update` cover Ponytail, RTK, and Caveman in-session, with dry-run and backups |

User-level installs also register the package in `~/.omp/plugins` (visible in OMP **Settings → Plugins**), directly through the plugin manifest. Active modes reassert after Ponytail's prompt block on every top-level turn, including after history compaction.

## Benchmarks

Measured savings against the same workload without the modes. Token counts are real `o200k_base` BPE tokens (js-tiktoken), not chars÷4 estimates. Sample protocol, per-sample data, and caveats in [BENCHMARK.md](./BENCHMARK.md).

| Measured surface (n) | Baseline → Tersio | Δ |
|---|---|---|
| Terse reply, caveman lite — BPE tok (3 samples, p50) | 146 → 73 tok | **−52.6%** |
| Terse reply, caveman full — BPE tok (3 samples, p50) | 154 → 58 tok | **−62.3%** |
| Terse reply, caveman ultra — BPE tok (3 samples, p50) | 146 → 33 tok | **−78.6%** |
| Code diff, ponytail minimal-ladder — BPE tok (2 tasks) | 261–481 → 108–143 tok | **−58.6…−70.3%** |
| Shell output, rtk — `git status` — BPE tok | 32 → 21 tok | **−34.4%** |
| Shell output, rtk — repo `grep` — BPE tok | 537 → 469 tok | **−12.7%** |

Break-even math, balanced preset (caveman full + rtk + ponytail): `⌈overhead ÷ saving-per-turn⌉ = ⌈480 ÷ 306⌉ = 2 turns`, where a mixed turn (reply + `git status`-class command + code task) costs 944 tok baseline vs 638 tok with Tersio — a 0.68× ratio. Every turn after turn 2 nets ≈ −32%. RTK keeps diffs and failing-test output exact by design (−0.4% and −1.5% there), concentrating savings where noise lives.

## CLI

| Command | Purpose |
|---|---|
| `tersio install` | Install (user scope by default; `--scope project\|both` for more) |
| `tersio update` | Refresh the CLI, extensions, and add-ons (RTK binary, Caveman rule, Ponytail) |
| `tersio reinstall` | Fresh install, preserving the Ponytail package |
| `tersio doctor` | Check OMP, extension, Ponytail, and RTK health |
| `tersio usage` | Ledger-backed usage + savings report |
| `tersio dashboard` | Serve the gain dashboard on localhost (`--open`, `--export <file>`, `--port <n>`) |
| `tersio uninstall` | Remove extensions, registration, and the Ponytail plugin (`--keep-ponytail` keeps Ponytail; `--remove-rtk` also removes the RTK binary) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--scope`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`. Legacy `--doctor` / `--uninstall` forms still work.

## Commands reference

Everything runs under one root. Bare `/tersio` prints status.

| Command | Purpose |
|---|---|
| `/tersio combo off\|medium\|balanced\|max\|status` | preset for all three modes (start here) |
| `/tersio caveman lite\|full\|ultra\|wenyan\|off\|status` | terse-reply mode |
| `/tersio rtk on\|off\|status` | compact shell-output toggle |
| `/tersio ponytail off\|lite\|full\|ultra\|review\|status` | minimal-code level |
| `/tersio status` | active modes + combo level |
| `/tersio check` | add-on version check (same as old `/ai-addons check`) |
| `/tersio update <ponytail\|rtk\|caveman\|all> [--dry-run]` | update add-ons, preview with dry-run |
| `/tersio gain` | savings summary + dashboard hint |
| `/tersio usage` | ledger report for this machine |
| `/tersio help` | this table |

### Combo — one preset for all three

Start here: one setting drives all three modes (`medium` = lite/lite/on, `balanced` = full/full/on, `max` = ultra/ultra/on, `off` = normal). Tweaking a mode individually drops to a `custom` mix.

### Caveman — terse replies

Pleasantries and restatements go; substance stays. Ladder: `lite`, `full`, `ultra` (fragments only), `wenyan` (compressed classical-Chinese-inspired register).

### RTK — compact shell output

A real binary, not a prompt trick: `rtk git status|diff|grep|test|tsc|lint` strips noise before output reaches the model. Exact bytes (checksums, patches) bypass it by policy.

### Ponytail — minimal code (YAGNI)

You Aren't Gonna Need It: smallest working change, no speculative abstractions, no new deps for stdlib jobs. `lite` nudges, `full` enforces, `ultra` challenges the requirement, `review` audits for over-engineering.

`/tersio` persists state and reloads OMP without emitting separate command messages. Presets propagate to task subagents and light the Combo footer indicator; mixed individual settings report via `/tersio status`.

### Legacy aliases (still work)

The pre-`/tersio` commands remain registered: `/caveman`, `/rtk`, `/combo`, `/ai-addons`. Prefer `/tersio` in new muscle memory; help output lists the aliases as deprecated-but-working.

Usage rows land in `~/.omp/plugins/tersio-usage.jsonl` (local only); `tersio dashboard` serves them as a plain-HTML page on 127.0.0.1.

## Files and backups

| What | Path |
|---|---|
| Caveman / RTK / Updater / Combo extensions | `~/.omp/agent/extensions/{caveman-session,rtk-session,ai-addons-updater,combo-toggle}/` |
| Ponytail package | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows) |
| Extension registrations | `~/.omp/agent/config.yml` |

The installer writes `<file>.bak` before replacing an extension source; the updater keeps `rtk.bak` / `rule.md.bak` and restores them if the replacement fails validation.

## Requirements

- [OMP](https://github.com/can1357/oh-my-pi)
- Node.js 20.12+ with npm

Windows/WSL have separate OMP homes — install from the environment where OMP runs. Inside WSL, `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

One-off use without installing:

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

## Troubleshooting

**Ponytail or Combo command missing:** run `tersio reinstall` in OMP's environment, restart OMP, then `tersio doctor` (repairs `config.yml` registrations).

**RTK missing or not executable:** run `tersio reinstall`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/tersio update rtk` aborts when metadata is missing.

## License

[MIT](./LICENSE)
