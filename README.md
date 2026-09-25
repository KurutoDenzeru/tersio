![Banner](/assets/Banner.webp)

# ✂️ Tersio — Token-saving add-ons for coding agents

[![npm version](https://shieldcn.dev/npm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![node](https://shieldcn.dev/badge/node-%3E%3D20.12-22c55e.svg?variant=branded&size=xs&logo=nodedotjs)](https://nodejs.org)
[![npm downloads](https://shieldcn.dev/npm/dm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![Build](https://shieldcn.dev/github/ci/KurutoDenzeru/tersio.svg?variant=branded&size=xs&logo=githubactions&label=Build)](https://github.com/KurutoDenzeru/tersio/actions)
[![MIT](https://shieldcn.dev/badge/license-MIT-2563eb.svg?variant=branded&size=xs&logo=opensourceinitiative)](./LICENSE)

 Terse replies, compact shell output, and minimal code decisions for **11 coding agents** — installed and updated through one CLI.

One `tersio` installer writes to every agent you use: [Oh My Pi](https://github.com/can1357/oh-my-pi), [OpenCode](https://opencode.ai), Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor, Grok Build, Pi, OpenClaw, and Hermes. Pick your agents once; the CLI handles each host's own format, hook protocol, and config path.

## ⚡ Getting Started

Install the CLI and run setup for your agents — one command, one agent-selection step:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

The installer asks which agents to install for. Skip the prompt with `--agent`:

```bash
tersio install --agent omp,opencode,claude-code
```

Then restart each agent you installed and enable a preset. In Oh My Pi:

```text
/combo balanced
```

Individual toggles: `/caveman full` · `/rtk on` · `/ponytail full`. Everything starts off until you enable it.

Change your selection any time with `tersio settings agents`. Full walkthrough in [INSTALL.md](./INSTALL.md).

**One-off use without installing:**

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

### Requirements

- Node.js 20.12+ with npm
- At least one supported coding agent

Windows/WSL have separate agent homes — install from the environment where your agent runs. Inside WSL, `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

## 📊 Benchmarks

Every mode is measured against a base run with all modes off. Measured surfaces use different boundaries. Do not treat reply-text, code-output, and shell-output reductions as total bill savings. Full protocol and caveats are in [BENCHMARK.md](./BENCHMARK.md).

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

Prompt overhead is included in [BENCHMARK.md](./BENCHMARK.md) with a full prompt-base example. Summary: `/rtk on` pays back immediately, `/ponytail ultra` repays in about 7 code tasks, `/combo medium` in about 8, and every Caveman level costs more in prompt than it saves in reply text.

The Command tools dashboard reports weighted RTK command-output savings and OMP-specific adoption from executed Bash records. It does not estimate provider billing.
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
| `tersio install` | Install, asking which coding agents to install for (`--agent omp,opencode,claude-code` skips the prompt) |
| `tersio update` | Refresh the CLI, every selected agent's files, and the shared add-ons (RTK binary, Caveman rule) |
| `tersio reinstall` | Fresh install, preserving the Ponytail package |
| `tersio doctor` | Check the CLI, every selected agent, and RTK health (`--fix` repairs, `--fix=<scope>` one scope, `--dry-run` previews) |
| `tersio usage` | Ledger-backed usage + savings report |
| `tersio dashboard` | Open the Dashboard (`--open`, `--export <file>`, `--port <n>`, `--currency <code>`; serves localhost only) |
| `tersio reset` | Clear tersio statistics: usage ledger + a watermark that hides pre-reset rows from every derived view (Y/N confirm, `--dry-run`, `--yes`) — session transcripts and RTK history stay intact on disk |
| `tersio uninstall` | Remove every selected agent's files and the shared add-ons (`--remove-rtk` also removes the RTK binary and its hooks; `--keep-ponytail` keeps Ponytail) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`, `--currency <code>` (usage/dashboard display currency; flag wins, then the `tersio settings` default, then USD). Legacy `--doctor` / `--uninstall` forms still work.

### Coding agents

The CLI is the installer for every host. `tersio install` asks which agents to install for, and all eleven below are supported.

| Host | `--agent` id | Rules file | Skills | RTK auto-rewrite |
|---|---|---|---|---|
| Oh My Pi | `omp` | — (live extension) | ✅ | ✅ (rtk-owned hook) |
| OpenCode | `opencode` | `AGENTS.md` | ✅ | ✅ (plugin) |
| Claude Code | `claude-code` | `CLAUDE.md` | ✅ | ✅ |
| OpenAI Codex | `codex` | `AGENTS.md` | ✅ | ✅ |
| Gemini CLI | `gemini-cli` | `GEMINI.md` | ✅ | ✅ |
| GitHub Copilot CLI | `copilot-cli` | `copilot-instructions.md` | ✅ | ✅ |
| Cursor | `cursor` | `rules/tersio.mdc` | ✅ | ✅ |
| Grok Build | `grok-build` | `rules/tersio.md` | ✅ | ✅ |
| Pi | `pi` | `AGENTS.md` | ✅ | ✅ (rtk-owned extension) |
| OpenClaw | `openclaw` | `AGENTS.md` | ✅ | — guidance only |
| Hermes | `hermes` | — (none global) | ✅ | ✅ |

Two hosts deviate on purpose. **Hermes** has no user-global instruction file at all (`SOUL.md` is its only global context file; `AGENTS.md` is project-scope), so its modes arrive as skills. **OpenClaw** can rewrite tool arguments only from a native TypeScript plugin, so it ships RTK guidance rather than a static hook.

Each host is written independently: one host failing never stops the others or the rest of the install. Every path, format, and hook wire protocol comes from that host's own documentation, recorded in `cli/agent-hosts.ts` next to the entry it justifies.

The choice is stored in `~/.tersio/agents.json` and reused on every later install, reinstall, and update. Change it with `tersio settings agents`, or non-interactively with `tersio settings --agent claude-code`. Non-interactive runs (`--yes`, CI, pipes) auto-detect instead of prompting: every host whose config directory already exists is included, so a host you never installed never gets a directory created for it. Doctor only checks the hosts you selected.

Host config directories honor each tool's own relocation variable (`CODEX_HOME`, `COPILOT_HOME`, `CURSOR_CONFIG_DIR`, `GROK_HOME`, `PI_CODING_AGENT_DIR`, `HERMES_HOME`).

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
| **Chosen coding agents** | `~/.tersio/agents.json` — written by `tersio install`, read by every later run |
| **Oh My Pi** — Caveman / RTK / Combo / Tersio commands | `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/{caveman-session,rtk-session,combo-toggle,tersio-commands}/` — loaded from Tersio's OMP plugin manifest |
| **Oh My Pi** — RTK wiring (rtk-owned) | `~/.omp/agent/extensions/rtk.ts` — written via `rtk init -g --agent omp`; auto-loads, no config entry |
| **Oh My Pi** — Ponytail | `~/.omp/plugins/node_modules/@dietrichgebert/ponytail/` — bundled dependency, updated with `tersio update` |
| **OpenCode** — RTK plugin (tersio-owned) | `~/.config/opencode/plugins/tersio-rtk.ts` — auto-discovered, no config entry |
| **OpenCode** — RTK guidance (tersio-owned) | `~/.config/opencode/AGENTS.md` — marked `tersio:rtk` block, fallback when the plugin is disabled |
| **Pi** — RTK extension (rtk-owned) | `~/.pi/agent/extensions/rtk.ts` — written via `rtk init -g --agent pi`; auto-loads, no config entry |
| **Other agents** — rules block | One marked `tersio` block in each host's own instruction file (see the matrix above) |
| **Other agents** — skills | `tersio-caveman`, `tersio-ponytail`, `tersio-rtk` directories in each host's skills dir |
| **Other agents** — RTK rewrite hook | `tersio-rtk-rewrite.mjs` plus one merged entry in each host's own hook config |
| **RTK binary** | Installer writes `~/.bun/bin/rtk` (`rtk.exe` on Windows). Runtime resolves `PATH` first, then this managed path. |
| **Usage data** | `~/.tersio/usage.db` — local only, never uploaded |
| **Legacy config cleanup** | `~/.omp/agent/config.yml` — doctor removes retired or duplicate extension entries |

Installers write `<file>.bak` before replacing an extension source; the updater keeps `rtk.bak` / `rule.md.bak` and restores them if the replacement fails validation.

Removing with `tersio uninstall --remove-rtk` is non-destructive outside Oh My Pi: instruction files keep their content and lose only the marked block, hook configs keep every hook except ours, and the skill directories Tersio created are removed. Oh My Pi additionally registers the package in `~/.omp/plugins` (visible in **Settings → Plugins**), and its modes reassert on every top-level turn including after history compaction.

## 🛠️ Troubleshooting

**Start here for any problem:** `tersio doctor` reports one row per selected agent, per install step. `--fix` repairs what it can; `--dry-run` previews the repair.

**Ponytail or Combo command missing (Oh My Pi):** confirm `~/.omp/plugins/package.json` lists `@krtclcdy/tersio`, then run `tersio reinstall`, restart OMP, and re-check `tersio doctor`.

**RTK missing or not executable:** run `tersio reinstall`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`.

**RTK commands not metered:** check the per-agent `rtk hook` row in `tersio doctor`. For Oh My Pi specifically, `rtk init -g --agent omp` (needs rtk ≥ 0.49) and a restart. RTK only rewrites shell commands — an agent's native file/search tools stay unmetered on every host, and a compound command such as `echo x && git status` has no single RTK equivalent, so it passes through unchanged.

**OpenCode commands not rewritten:** OpenCode needs its own plugin, because `rtk init -g --opencode` still emits a file OpenCode refuses to load ([rtk#3463](https://github.com/rtk-ai/rtk/issues/3463), [rtk#3898](https://github.com/rtk-ai/rtk/issues/3898)). `tersio install` writes a compatible one instead. Set `TERSIO_RTK=off` to disable the hook.

**Pi commands not rewritten:** Pi loads `~/.pi/agent/extensions` as TypeScript modules, so it cannot use a JSON hook file. `tersio install` runs `rtk init -g --agent pi` to write `~/.pi/agent/extensions/rtk.ts`. If that file is missing or is not a Pi module, `tersio doctor` says so; rerun `rtk init -g --agent pi` (needs rtk ≥ 0.49) and restart Pi.

**An agent you did not select is missing from the install:** that is expected — only selected hosts are written. Change the selection with `tersio settings agents`.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/tersio update rtk` aborts when metadata is missing.

## 🤝🏻 Contributing

Contributions are always welcome, whether you're fixing bugs, improving docs, or shipping new features that make the project better for everyone.

Check out [Contributing.md](Contributing.md) to learn how to get started and follow the recommended workflow.

## ⚖️ License

This project is released under the MIT License, giving you the freedom to use, modify, and distribute the code with minimal restrictions.

For the full legal text, see the [LICENSE](LICENSE) file.
