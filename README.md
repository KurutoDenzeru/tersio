![Banner](./docs/Banner.webp)

# ✂️ Tersio — Token Saver OMP & Usage Tracker

[![npm version](https://shieldcn.dev/npm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![node](https://shieldcn.dev/badge/node-%3E%3D20.12-22c55e.svg?variant=branded&size=xs&logo=nodedotjs)](https://nodejs.org)
[![npm downloads](https://shieldcn.dev/npm/dm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![Build](https://shieldcn.dev/github/ci/KurutoDenzeru/tersio.svg?variant=branded&size=xs&logo=githubactions&label=Build)](https://github.com/KurutoDenzeru/tersio/actions)
[![MIT](https://shieldcn.dev/badge/license-MIT-2563eb.svg?variant=branded&size=xs&logo=opensourceinitiative)](./LICENSE)

Token saver & usage tracker for coding agents: terse caveman replies, compact RTK shell output, lean Ponytail code calls, and a gain dashboard — one-command combo presets over one shared extension tree.

## ⚡ Getting Started

All install paths in one table, with update and remove commands: [INSTALL.md](./INSTALL.md).

**Default** (macOS/Linux/WSL) — one line. Installs the CLI via npm, then runs the main installer (scope + Combo preset menus) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

Then run the CLI. Bare `tersio` opens a menu and asks which agent to install into:

```bash
tersio                      # menu — picks Oh My Pi, pi, or OpenCode
tersio install --host pi    # pi, non-interactive
tersio install --host omp   # Oh My Pi, non-interactive
tersio install --host opencode  # OpenCode, non-interactive
```

Or let each host install the package itself:

```bash
omp plugin install @krtclcdy/tersio
pi install npm:@krtclcdy/tersio
opencode plugin add @krtclcdy/tersio
```

Pick one install method per host, not both. Using both registers every command twice.

All hosts load the same six extensions from the same sources and read their session-start defaults from `~/.tersio/settings.json`. All six load always.

One-off use without installing:

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

### Requirements

- [OMP](https://github.com/can1357/oh-my-pi), [pi](https://github.com/earendil-works/pi), or [OpenCode](https://opencode.ai) — all three are supported; pick one with `tersio install --host <omp|pi|opencode>`
- Node.js 20.12+ with npm
- macOS or Linux, native or WSL

On Windows, use WSL. There is no native Windows path: the installer, the extensions, and the RTK wiring are tested on macOS and Linux only. WSL has its own home directory, so install from inside WSL — `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

## 📊 Benchmarks

Every mode is measured against a base run with all modes off. Measured surfaces use different boundaries. Do not treat reply-text, code-output, and shell-output reductions as total bill savings. **A mode also spends tokens on the prompt, on every turn — read the caveat under the table before choosing.** Results and the rerun protocol are in [docs/BENCHMARK.md](./docs/BENCHMARK.md).

| Mode | Surface (n) | Base → Tersio | Δ |
|---|---|---|---|
| `/caveman full` | Terse reply, o200k tokens (3 samples, p50) | 124 → 107 | **−13.7% reply text** |
| `/caveman ultra` | Terse reply, o200k tokens (3 samples, p50) | 124 → 109 | **−12.1% reply text** |
| `/ponytail lite` | Code reply, o200k tokens (3 samples, p50) | 306 → 177 | **−42.2% code** |
| `/ponytail full` | Code reply, o200k tokens (3 samples, p50) | 306 → 208 | **−32.0% code** |
| `/ponytail ultra` | Code reply, o200k tokens (3 samples, p50) | 306 → 112 | **−63.4% code** |
| `/combo medium` | Code reply, o200k tokens (3 samples, p50) | 306 → 132 | **−56.9% code** |
| `/rtk on` — `bun run test` | Command output (3 runs, p50) | 4,003 → 54 | **−98.7% output** |
| `/rtk on` — `find . -name '*.test.ts'` | Command output (3 runs, p50) | 10,908 → 248 | **−97.7% output** |
| `/rtk on` — `ls -la .` | Command output (3 runs, p50) | 983 → 275 | **−72.0% output** |
| `/rtk on` — `git status` | Command output (3 runs, p50) | 72 → 18 | **−75.0% output** |
| `/rtk on` — `bun run build` | Command output (3 runs, p50) | 140 → 114 | **−18.6% output** |

The two `/caveman` rows above are the exception worth naming: both levels spend more prompt tokens than the reply text they save, so they cost you money on net. Use Caveman for the terser writing style, not as a token saving.

Prompt overhead is included in [docs/BENCHMARK.md](./docs/BENCHMARK.md) with a full prompt-base example. Summary: `/rtk on` pays back immediately, `/ponytail ultra` repays in about 7 code tasks, `/combo medium` in about 8, and every Caveman level costs more in prompt than it saves in reply text.

The Command tools dashboard reports weighted RTK command-output savings and OMP-specific adoption from executed Bash records. It does not estimate provider billing.
Upstream Ponytail's fair agentic benchmark reports 54% less code, 22% fewer tokens, 20% lower cost, and 100% retained safety. RTK estimates command-output tokens, not bill savings. Caveman and Ponytail compliance varies by model. Measure your own sessions with `tersio usage` and the dashboard.

## 🖥️ CLI

| Command | Purpose |
|---|---|
| `tersio install` | Install (user scope: all OMP sessions) |
| `tersio update` | Refresh the CLI, extensions, and add-ons (RTK binary, Caveman rule, Ponytail) |
| `tersio doctor` | Check OMP, extension, Ponytail, and RTK health (`--fix` repairs, `--fix=<scope>` one scope, `--dry-run` previews) |
| `tersio usage` | Ledger-backed usage + savings report |
| `tersio dashboard` | Open the Dashboard (`--open`, `--export <file>`, `--port <n>`, `--currency <code>`; serves localhost only) |
| `tersio reset` | Clear tersio statistics: usage ledger + a watermark that hides pre-reset rows from every derived view (Y/N confirm, `--dry-run`, `--yes`) — session transcripts and RTK history stay intact on disk |
| `tersio uninstall` | Remove extensions, registrations, the Ponytail plugin, and the `rtk.ts` OMP wiring (`--keep-ponytail` keeps Ponytail; `--remove-rtk` also removes the RTK binary) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`, `--currency <code>` (usage/dashboard display currency; flag wins, then the `tersio settings` default, then USD). Legacy `--doctor` / `--uninstall` forms still work.

## ⌨️ Commands reference

Mode switches live on their own commands; bare `/tersio` prints status. Every mode command, and every session start, prints the status line:

```
🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA
```

It is display-only — it never enters the model context, so it costs the session nothing.

| Command | Purpose |
|---|---|
| `/combo off\|medium\|balanced\|max\|status` | One preset for all three (start here): medium = lite/lite/on, balanced = full/full/on, max = ultra/ultra/on; per-mode tweaks drop to `custom`. |
| `/caveman lite\|full\|ultra\|megacave-lite\|megacave-full\|megacave-ultra\|off\|status` | Terse replies with upstream-aligned Caveman levels. The legacy `wenyan` spelling still resolves, onto `megacave-full`. |
| `/rtk on\|off\|status` | Controls RTK session guidance, `rtk_run`, and the automatic hook through shared `RTK_DISABLED` state. Exact bytes bypass RTK. |
| `/ponytail off\|lite\|full\|ultra\|status` | Minimal code using upstream Ponytail modes. Review runs separately through `/ponytail-review`. |
| `/tersio status` | Active modes + combo level; state persists and propagates to subagents. |
| `/tersio check` | Add-on version check |
| `/tersio update <ponytail\|rtk\|caveman\|all> [--dry-run]` | Update add-ons, preview with dry-run |
| `/tersio dashboard` | Open the Dashboard. |
| `/tersio usage` | Ledger report for this machine (rows in `~/.tersio/usage.db`, local only) |
| `/tersio help` | This table |
| `/ai-addons` | Add-on updater alias, still works. |

## 🗂️ Files and backups

Shared, and identical for every host:

| What | Path |
|---|---|
| Session-start defaults | `~/.tersio/settings.json` — combo, caveman, rtk, ponytail, and the display currency |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows). The runtime resolves `PATH` first, then this managed path. |
| Usage ledger and price cache | `~/.tersio/` — local only, nothing leaves the machine |
| `usage.db` host scope | `~/.tersio/usage.db` mirrors every agent Tersio reads: omp and pi transcripts, the OpenCode JSON tree, and the OpenCode v2 sqlite rows. Each row records its host and its agent kind, so a report splits by agent and by main agent or subagent. |
| Model prices | `~/.tersio/prices.json` is a cache of LiteLLM's feed, refreshed in the background. `~/.tersio/prices.local.json` is yours: one entry per model id, keyed as the transcript spells it or with a `*` prefix to cover every gateway prefix. It wins over the feed, and it is how a gateway model the feed keys under another provider gets its real rate. `tersio usage` prints an `Unpriced (heaviest first)` line naming the model keys to add. |
| Price sources | The cost the host itself reported wins over every rate card: it is the only figure from the party that billed. A recorded zero is a real zero, not a missing value — omp flags a request it could not price in a separate field, so a zero is a free model. A model counts as host-priced only when every one of its messages carried a cost. Then `prices.local.json`, then the LiteLLM cache, then a default table the report labels as a guess. |
| Data snapshots | `~/.tersio/backups/` — one directory per snapshot with a `manifest.json`; six are kept |

Per host, written by `tersio install --host <omp|pi|opencode>`:

| Host | Extensions | Ponytail |
|---|---|---|
| Oh My Pi | `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/` — the plugin manifest (`omp.extensions`) owns every mode extension, so the agent tree keeps only rtk's `extensions/rtk.ts` wiring, which `config.yml` registers by path | nested plugin dependency under `~/.omp/plugins/node_modules/`, one Plugins row |
| pi | `~/.pi/agent/extensions/{caveman,rtk,combo,commands,updater}/` — pi auto-discovers `<agent-dir>/extensions`, so there is nothing to register | `npm:@dietrichgebert/ponytail`, installed as a pi package |
| OpenCode | `~/.config/opencode/plugins/tersio/` — registered in `opencode.json` plugins, so there is nothing else to register | bundled with Tersio; no separate package |

All three hosts carry the same `shared/` modules and the same mode extensions from the same sources.

omp merges the plugin manifest with the extension dir it discovers by default, so Tersio installs its extensions in one place per host. An install removes the copies an older build left in `~/.omp/agent/extensions/`, because a second copy of the same file would load twice and one of them cannot resolve its own rule bodies.

The installer writes `<file>.bak` before replacing an extension source. `tersio doctor --fix extensions` restores a damaged tree, and `doctor --fix registrations` drops retired or duplicate `config.yml` entries.

Settings -> **Data** covers the snapshots that can put this machine's data back. A restore never deletes and a delete never touches the live data; each asks first and names the files it moves. Files a snapshot does not hold are left alone.

An OMP install also registers the package in `~/.omp/plugins`, so it shows under OMP **Settings → Plugins**. Active modes reassert after Ponytail's prompt block on every top-level turn, including after history compaction.

## 🛠️ Troubleshooting

**Ponytail or Combo command missing on OMP:** confirm `~/.omp/plugins/package.json` lists `@krtclcdy/tersio`, then run `tersio install`, restart OMP, and check `tersio doctor`. A damaged tree is repaired by `tersio doctor --fix extensions`.

**RTK missing or not executable:** run `tersio install`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`.

**RTK commands not metered in the Dashboard:** only bash calls routed through rtk's OMP wiring (`~/.omp/agent/extensions/rtk.ts`, written by `rtk init -g --agent omp`) are metered. Missing: run that command (needs rtk ≥ 0.49) or `tersio doctor --fix rtk`, then restart OMP. Native tool calls (`read`/`edit`/`eval`) stay unmetered.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/tersio update rtk` aborts when metadata is missing.

## 🤝🏻 Contributing

Contributions are always welcome, whether you're fixing bugs, improving docs, or shipping new features that make the project better for everyone.

Check out [CONTRIBUTING.md](CONTRIBUTING.md) to learn how to get started and follow the recommended workflow.

## ⚖️ License

This project is released under the MIT License, giving you the freedom to use, modify, and distribute the code with minimal restrictions.

For the full legal text, see the [LICENSE](LICENSE) file.
