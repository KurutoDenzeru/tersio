![Banner](./docs/Banner.webp)

# ✂️ Tersio — Token Saver & Usage Tracker

[![npm version](https://shieldcn.dev/npm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![node](https://shieldcn.dev/badge/node-%3E%3D20.12-22c55e.svg?variant=branded&size=xs&logo=nodedotjs)](https://nodejs.org)
[![npm downloads](https://shieldcn.dev/npm/dm/@krtclcdy%2Ftersio.svg?variant=branded&size=xs&logo=npm)](https://www.npmjs.com/package/@krtclcdy/tersio)
[![Build](https://shieldcn.dev/github/ci/KurutoDenzeru/tersio.svg?variant=branded&size=xs&logo=githubactions&label=Build)](https://github.com/KurutoDenzeru/tersio/actions)
[![MIT](https://shieldcn.dev/badge/license-MIT-2563eb.svg?variant=branded&size=xs&logo=opensourceinitiative)](./LICENSE)

Token saver & usage tracker for coding agents: terse caveman replies, compact RTK shell output, lean Ponytail code, Headroom compression, pstack rigor, and a gain dashboard — one-command combos over one shared extension tree.

Measured savings per mode, the prompt overhead each one adds, and the rerun protocol: [docs/BENCHMARK_GUIDE.md](./docs/BENCHMARK_GUIDE.md).

## 🎯 What this is, and why you would use it

Coding agents bill you per token. Three of the costs you never asked for:

- **Replies carry filler.** The same three sentences, plus a greeting, a hedge, a recap, and a "hope this helps".
- **Shell output is noise.** A failing test prints hundreds of lines to reach the four that matter.
- **The rules repeat every turn.** Your agent re-reads its instructions on every single turn.

Tersio installs into Oh My Pi, Pi, Pi-in-go, OpenCode, and DeepSeek Harness, and cuts those costs:

| Mode | What it does for you |
|---|---|
| 🪨 **Caveman** | Shorter replies. Answer first, filler gone, and code, commands, paths, and errors stay exact. |
| 🗜️ **RTK** | Condensed shell output, every signal kept. A failing test still names the test, the assertion, and the line. |
| 🧠 **Ponytail** | Leaner code. YAGNI: no feature, option, or abstraction nobody asked for, and the shortest diff that still works. |
| 🥔 **pstack** | Rigor mode. It applies a design principle when the moment fits, and owns the approach, the check, and the design. Opt-in, on its own switch. |
| 🍃 **Headroom** | Headroom shrinks tool output, file reads, and history. Opt-in; Tersio reads its savings and never turns it on for you. |
| 🧩 **Combo** | One command sets Caveman, RTK, and Ponytail, at three strengths. |
| 📊 **Dashboard** | What you spent, per model and per day. |

Every mode is a text block you can read in the repo. Measured savings and prompt overhead are published per mode in [docs/BENCHMARK_GUIDE.md](./docs/BENCHMARK_GUIDE.md). No total-bill claim: the tests measure reply tokens, prompt overhead, and command output only.

Oh My Pi and OpenCode use Headroom's own writer. Pi, PiG, and DeepSeek Harness get a Tersio switch that saves the provider endpoint and puts it back when you turn Headroom off.

## ⚡ Getting Started

All install paths in one table, with update and remove commands: [INSTALL.md](./INSTALL.md).

**Default** (macOS/Linux) — one line. Installs the CLI via npm, then runs the main installer (scope + Combo preset menus) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

**Windows** — one line, the same pass through PowerShell:

```powershell
irm https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.ps1 | iex
```

Then run the CLI. Bare `tersio` opens a menu and asks which agent to install into:

```bash
tersio                      # menu — picks Oh My Pi, pi, OpenCode, Pi-in-go, or DeepSeek Harness
tersio install --host pi    # pi, non-interactive
tersio install --host omp   # Oh My Pi, non-interactive
tersio install --host opencode  # OpenCode, non-interactive
tersio install --host pig   # Pi-in-go (PiG), non-interactive
tersio install --host dsh   # DeepSeek Harness — mounts the bundle into every dsh profile
```

Or let each host install the package itself:

```bash
omp plugin install @krtclcdy/tersio
pi install npm:@krtclcdy/tersio
opencode plugin add @krtclcdy/tersio
pig install npm:@krtclcdy/tersio
dsh plugin --profile web add npm:@krtclcdy/tersio
```

The DeepSeek Harness desktop app installs through its Plugins pane instead: **Add plugin** → paste `@krtclcdy/tersio`, or a local checkout path while the bundle field is unreleased → restart the app. `dsh plugin` refuses the `desktop` profile by design, and `tersio install --host dsh` never writes it.

Pick one install method per host, not both. Using both registers every command twice.

All hosts load the same six extensions from the same sources and read their session-start defaults from `~/.tersio/settings.json`. All six load always.

One-off use without installing:

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

### Requirements

| Need | Detail |
|---|---|
| Host | [OMP](https://github.com/can1357/oh-my-pi), [pi](https://github.com/earendil-works/pi), [OpenCode](https://opencode.ai), [PiG](https://pi-in-go.dev), or [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — `tersio install --host <omp\|pi\|opencode\|pig\|dsh>` |
| Node.js | 20.12+ with npm. The CLI runs under Node |
| Bun | Optional. Preferred when on PATH, npm otherwise; also supplies SQLite in process |
| SQLite | Bun, Node 22.5+ `node:sqlite`, or the `sqlite3` binary on PATH |
| OS | macOS, Linux, or Windows, native (`install.ps1`). WSL works too, installed from inside it |

## 📊 Dashboard

`tersio dashboard` opens a local page for usage, cost, tools, traces, and savings. Other pages cover Models, Providers, Costs, Carbon, Requests, Errors, Tools, and Projects.

**Quick start (Recommended)** is the place to see the whole setup workflow: the modes, the agents, and how one turn moves from prompt to output.

![Tersio Quick start dashboard](./docs/Quick%20Start.webp)

**Overview** shows spend, requests, tokens, cache rate, and the latest calls.

![Tersio Overview dashboard](./docs/Overview.webp)

## 🔌 MCP

`tersio mcp` speaks the Model Context Protocol, so any MCP-capable client can read Tersio's data and set its modes mid-session. Nothing to run: the client starts Tersio when it needs it and stops it when done.

Add this entry under `mcpServers` in the client's MCP settings:

```json
{
  "mcpServers": {
    "tersio": {
      "command": "tersio",
      "args": ["mcp"]
    }
  }
}
```

That is the whole setup. No extra command, no port, no token, and no process to keep alive. `tersio install` writes this same Tersio server entry into OMP, Pi, PiG, Deepseek Harness, and OpenCode, so there is no second MCP process. `tersio_headroom` carries savings, status, and retrieve for compressed content.

Three tools become available: `tersio_stats` (requests, errors, tokens, cache rate, and cost for a range, in your display currency), `tersio_activity` (what Tersio changed, newest first), `tersio_modes` (read the session-start defaults, or set them: a Combo preset, or any single mode — caveman, rtk, ponytail, pstack, headroom — overriding its piece of the preset), and `tersio_headroom` (savings by default; `action: status` for live proxy counters and routing; `action: retrieve` with a marker hash; or `action: memory`, `evals`, and `dashboard` for the upstream commands Tersio does not reimplement).

## 🖥️ CLI

| Command | Purpose |
|---|---|
| `tersio install` | Install (user scope: all OMP sessions) |
| `tersio update` | Update the Tersio CLI. `--host <agent>` also refreshes that agent's extensions and add-ons (RTK binary, Caveman rule, Headroom, Ponytail); no prompt is asked |
| `tersio doctor` (Defaults row) | `tersio doctor` prints the shared defaults and each agent's overrides, so a value's source is visible without reading the store |
| `tersio doctor` | Check OMP, extension, Ponytail, RTK, and OpenCode service health (`--fix` repairs, `--fix=<scope>` one scope, `--dry-run` previews) |
| `tersio dashboard` | Open the Dashboard (`--open`, `--export <file>`, `--port <n>`, `--currency <code>`; serves localhost only) |
| `tersio mcp` | Start the Tersio MCP server on stdio (see [MCP](#-mcp)) |
| `tersio uninstall` | Remove extensions, registrations, the Ponytail plugin, and the `rtk.ts` OMP wiring (`--keep-ponytail` keeps Ponytail; `--remove-rtk` also removes the RTK binary) |
| `tersio version` | Print version |

Flags: `--dry-run`, `--yes`/`-y`, `--verbose`, `--combo-default`/`--caveman-default`/`--rtk-default`/`--ponytail-default`/`--pstack-default`/`--headroom-default`, `--currency <code>` (usage/dashboard display currency; flag wins, then the dashboard's own default, then USD). Legacy `--doctor` / `--uninstall` forms still work.

## ⌨️ Commands reference

Mode switches live on their own commands; bare `/tersio` prints status. Every mode command, and every session start, prints the status line:

```
🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🍃 headroom=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON
```

It is display-only — it never enters the model context, so it costs the session nothing.

| Command | Purpose |
|---|---|
| `/combo off\|lite\|balanced\|max\|status` | One preset for caveman, RTK, and Ponytail. pstack and headroom stay separate. |
| `/caveman lite\|full\|ultra\|megacave-lite\|megacave-full\|megacave-ultra\|off\|status` | [Caveman](https://github.com/JuliusBrussee/caveman) reply levels. Legacy `wenyan` names still work. |
| `/rtk on\|off\|status` | [RTK](https://github.com/rtk-ai/rtk) shell output. Exact bytes skip it. |
| `/ponytail off\|lite\|full\|ultra\|status` | [Ponytail](https://github.com/DietrichGebert/ponytail) code levels. |
| `/pstack on\|off\|status` | [pstack](https://github.com/cursor/plugins/tree/main/pstack) rigor mode. Opt-in; `normal mode` clears it. |
| `/headroom on\|off\|status` | [Headroom](https://github.com/headroomlabs-ai/headroom) compression. Opt-in; Tersio reads its savings and never installs it silently. |
| `/tersio status` | Active modes and combo level. |
| `/tersio update <ponytail\|rtk\|caveman\|all> [--dry-run]` | Update add-ons. |
| `/tersio dashboard` | Open the dashboard. |
| `/tersio help` | This table. |

## 🗂️ Files and backups

Shared, and identical for every host:

| What | Path |
|---|---|
| Session defaults | `~/.tersio/settings.json` — combo, caveman, rtk, ponytail, pstack, headroom, and currency. `hosts.<agent>` overrides one agent; `inherit` restores the shared value |
| RTK binary | `~/.bun/bin/rtk` (`rtk.exe` on Windows); `PATH` wins when present |
| Ledger and caches | `~/.tersio/usage.db` — usage rows, prices, scorecard, state, Headroom records, and layout. Local only |
| Activity log | `~/.tersio/activity.jsonl` — one line per change, as the Logs page reads it |
| Host scope | The same `usage.db` mirrors omp, pi, and OpenCode sessions, split by host and agent kind |
| Snapshots | `~/.tersio/backups/` — one hashed `.snap` each, fourteen kept, carrying `usage.db` whole |

The installer writes `<file>.bak` before it replaces a source. `tersio doctor --fix extensions` restores a damaged tree, and `doctor --fix registrations` drops retired or duplicate `config.yml` entries.

Settings → **Data** holds snapshots, the backup schedule, retention (7 days to Forever; older usage rows drop on the next sync; transcripts stay), and Reset behind Advanced. Restore saves the current state first, then copies the snapshot over the live files; delete never touches live data. Both ask first, name what they change, and leave files outside the snapshot untouched. Reset confirms, clears the ledger and its RTK rows, hides the summary, and keeps transcripts, rtk history, and prices.

Active modes reassert after Ponytail's prompt block on every top-level turn, including after history compaction.

## 🛠️ Troubleshooting

**Ponytail or Combo command missing on OMP:** confirm `~/.omp/plugins/package.json` lists `@krtclcdy/tersio`, then run `tersio install`, restart OMP, and check `tersio doctor`. A damaged tree is repaired by `tersio doctor --fix extensions`.

**RTK missing or not executable:** run `tersio install`, then `tersio doctor`. On Linux/macOS: `chmod +x ~/.bun/bin/rtk`. On Windows the binary is `rtk.exe`, and rtk publishes no `aarch64-pc-windows` build, so a Windows-on-ARM host has no rtk to install. The doctor's Platform row names this directly.

**RTK savings and adoption:** the Gain numbers read rtk's own `history.db` (`%LOCALAPPDATA%\rtk` on Windows), so pi and OpenCode runs are already in them. The adoption row counts executed Bash calls from the omp and pi transcripts and OpenCode's v2 sqlite or pre-v2 JSON tree. The eligible list comes from `rtk rewrite`, cached per binary version. Native tool calls (`read`/`edit`/`eval`) and exact bytes bypass RTK.

**Checksum warning or failure:** the installer aborts on RTK checksum mismatch but warns and continues when checksum metadata is unavailable; `/tersio update rtk` aborts when metadata is missing.

## 🤝🏻 Contributing

Contributions are always welcome, whether you're fixing bugs, improving docs, or shipping new features that make the project better for everyone.

Check out [CONTRIBUTING.md](CONTRIBUTING.md) to learn how to get started and follow the recommended workflow.

## ⚖️ License

This project is released under the MIT License, giving you the freedom to use, modify, and distribute the code with minimal restrictions.

For the full legal text, see the [LICENSE](LICENSE) file.
