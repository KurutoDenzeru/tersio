# Plugin ports

One folder per host. Each `PORT.md` records what that host's plugin system
actually supports, what Tersio ships there today, and what is still to do.

| Host | Folder | Mechanism | State |
|---|---|---|---|
| Oh My Pi | [`omp/`](./omp) | extension tree under `~/.omp/agent/extensions/`, registered by the OMP plugin manifest | **Complete** |
| Pi | [`pi/`](./pi) | extension tree under `~/.pi/agent/extensions/`, one `index.ts` per directory, loaded through jiti | **Complete** |
| OpenCode | [`opencode/`](./opencode) | a real plugin module auto-discovered from `~/.config/opencode/plugins/` | **Complete** |
| Claude Code | [`claude-code/`](./claude-code) | a plugin directory under `~/.claude/skills/`, which auto-loads with no install step | **Portable now** |
| OpenAI Codex | [`codex/`](./codex) | static rules, skills and a `hooks.json` rewrite | **Plugin available, install path is a marketplace** |

Sources for the three complete ports stay where the installer already resolves
them — `extensions/` for OMP and `extensions/pi/` for Pi, with OpenCode's module
at `extensions/opencode/`. Moving them would churn the installer's path
resolution, the Pi tree wiring, and the package `files` allowlist for no
functional gain. Claude Code and Codex add no source tree until they are wired,
so their folders hold plans rather than scaffolding.

## Why OMP and Pi are not "a plugin file"

Both hosts load **live code** — five extension directories plus `shared/` and
`lib/` — so their modes can switch mid-session and inject into the next turn.
Rules files and skills are the static fallback those two hosts also get, and
they get them through the same generic emitters as every other host.

Claude Code and Codex have no such live surface: their plugins are a manifest
plus `skills/`, `hooks/` and optionally an MCP server. That is a different
class of port, and [INSTALL.md](../INSTALL.md#plugin-ports) says what each one
gets.
