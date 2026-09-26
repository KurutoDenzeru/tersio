![Banner](/assets/Banner.webp)

# ✂️ Tersio — Terse replies, filtered shell output, minimal code

[![npm version](https://shieldcn.dev/npm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![node](https://shieldcn.dev/badge/node-%3E%3D20.12-22c55e.svg?variant=branded&size=xs&logo=nodedotjs)](https://nodejs.org)
[![npm downloads](https://shieldcn.dev/npm/dm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![Build](https://shieldcn.dev/github/ci/KurutoDenzeru/tersio.svg?variant=branded&size=xs&logo=githubactions&label=Build)](https://github.com/KurutoDenzeru/tersio/actions)
[![MIT](https://shieldcn.dev/badge/license-MIT-2563eb.svg?variant=branded&size=xs&logo=opensourceinitiative)](./LICENSE)

Tersio installs three coding modes into whichever agents you already use — **twelve supported** — and keeps the savings in one local ledger and dashboard.

| Mode | What it changes |
|---|---|
| **Caveman** | Terse replies: drops filler and hedging, keeps complete technical substance |
| **Ponytail** | Minimal code: root causes, standard library, YAGNI, no speculative abstractions |
| **RTK** | Runs noisy shell commands through the [rtk](https://github.com/rtk-ai/rtk) binary, which filters the output before the model reads it |

Tersio is one CLI for every supported agent. The install writes into each agent's own config directory and never a shared one, so you can pick any combination, change it later, or add an agent without reinstalling the others.

## ⚡ Getting Started

One line. Installs the CLI via npm, then runs the installer:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

Then tell it which agents to set up:

```bash
tersio install --agent claude-code,cursor
```

The selection is saved to `~/.tersio/agents.json` and reused by every later install, reinstall, and update. Run `tersio install` with no `--agent` to auto-detect the agents you already have, and `tersio doctor` to see what landed. Every file written, per host, is in **[INSTALL.md](./INSTALL.md)**.

### Supported agents

`--agent` takes any id below. Repeatable and comma-separated.

| Agent | `--agent` | Rules file | Skills | RTK auto-rewrite |
|---|---|---|---|---|
| Claude Code | `claude-code` | `CLAUDE.md` | ✅ | ✅ hook |
| OpenAI Codex | `codex` | `AGENTS.md` | ✅ | ✅ hook |
| GitHub Copilot CLI | `copilot-cli` | `copilot-instructions.md` | ✅ | ✅ hook |
| Cursor | `cursor` | `rules/tersio.mdc` | ✅ | ✅ hook |
| Grok Build | `grok-build` | `rules/tersio.md` | ✅ | ✅ hook |
| Hermes | `hermes` | — none global | ✅ | ✅ hook |
| OpenCode | `opencode` | `AGENTS.md` | ⚠️ project-only | ✅ plugin |
| Pi | `pi` | `AGENTS.md` | ✅ | ✅ rtk extension |
| Oh My Pi | `omp` | ✅ | ✅ | ✅ rtk extension |
| OpenClaw | `openclaw` | `AGENTS.md` | ✅ | ⚠️ guidance only |
| Command Code | `command-code` | `AGENTS.md` | ✅ | ⚠️ guidance only |
| Antigravity CLI | `agy` | `AGENTS.md` | ✅ | ⚠️ guidance only |

**Read the ⚠️ rows literally.** OpenClaw, Command Code, and Antigravity CLI document no way to rewrite a shell command, so they get the rules pack and skills and the RTK text tells the model to prefix commands by hand. `tersio doctor` states which case each host is in, so none of this is a claim you have to take on faith.

Two notes on the Google rows: `agy` keeps its global rules at `~/.gemini/GEMINI.md` but moved its workspace skills to `.agents/skills/`, and Gemini CLI itself is sunset for free, Pro, and Ultra accounts — `agy` is its successor.

Run `tersio install` again at any point to change the selection. It asks which agents to set up, so there is one install path for all twelve — nothing is scoped to a single agent's plugin system.

```bash
tersio install                      # prompt for the agents
tersio install --agent claude-code  # or name them
```

Session-start defaults (prompted during `install`, or flags):

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Defaults apply to fresh sessions only. Anything persisted with a live command wins, where the host has one.

One-off use without installing:

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

### Requirements

- Node.js 20.12+ with npm
- Any of the twelve supported agents — nothing else is required

Windows/WSL have separate home directories — install from the environment where the agent runs. Inside WSL, `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

## 📊 Benchmarks

Measured on Oh My Pi, the host with the most instrumentation available. Every mode is measured against a base run with all modes off. Measured surfaces use different boundaries. Do not treat reply-text, code-output, and shell-output reductions as total bill savings. Full protocol and caveats are in [BENCHMARK.md](./BENCHMARK.md).

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
| `tersio install` | Install the CLI, RTK, and the selected agents (`--agent <ids>` picks them; omit to auto-detect) |
| `tersio update` | Refresh the CLI, extensions, and add-ons (RTK binary, Caveman rule, Ponytail) |
| `tersio reinstall` | Fresh install, preserving the Ponytail package |
| `tersio doctor` | Check OMP, extensions, add-ons, and every selected agent (`--fix` repairs, `--fix=<scope>` one scope, `--dry-run` previews) |
| `tersio usage` | Ledger-backed usage + savings report |
| `tersio dashboard` | Open the Dashboard (`--open`, `--export <file>`, `--port <n>`, `--currency <code>`; serves localhost only) |
| `tersio reset` | Clear tersio statistics: usage ledger + a watermark that hides pre-reset rows from every derived view (Y/N confirm, `--dry-run`, `--yes`) — session transcripts and RTK history stay intact on disk |
| `tersio uninstall` | Remove extensions, registration, and the Ponytail plugin (`--keep-ponytail` keeps Ponytail; `--remove-rtk` also removes the RTK binary and its `rtk.ts` OMP wiring) |
| `tersio version` | Print version |

Flags: `--agent <ids>` (repeatable, comma-separated), `--dry-run`, `--yes`/`-y`, `--verbose`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`, `--currency <code>` (usage/dashboard display currency; flag wins, then the `tersio settings` default, then USD). Legacy `--doctor` / `--uninstall` forms still work.

## ⌨️ Commands reference

**Oh My Pi only.** These are live session commands: `/combo` changes the mode for the rest of the session and the state is persisted. Other agents have no equivalent runtime hook, so they receive the same modes as rules and skills instead — the behaviour is equivalent, the switching is not live. See [INSTALL.md](./INSTALL.md) for what each host actually gets.

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

Tersio writes to each agent's own configuration, never a shared one. Per-agent paths and the exact file list are in [INSTALL.md](./INSTALL.md); the OMP paths are below.

| What | Path |
|---|---|
| Caveman / RTK / Combo / Tersio commands | `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/{caveman-session,rtk-session,combo-toggle,tersio-commands}/` — loaded from Tersio's OMP plugin manifest |
| RTK OMP wiring (rtk-owned) | `~/.omp/agent/extensions/rtk.ts` — written by the installer via `rtk init -g --agent omp`; auto-loads, no config entry |
| RTK Pi wiring (rtk-owned) | `~/.pi/agent/extensions/rtk.ts` — written via `rtk init -g --agent pi`; rtk owns the format |
| Other agents' rules, skills, and hooks | See [INSTALL.md](./INSTALL.md) — every artifact is inside that agent's own config dir, between `<!-- tersio:start -->` and `<!-- tersio:end -->` where the file is shared |
| Selected agents | `~/.tersio/agents.json` — the `--agent` list, reused by later runs |
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
