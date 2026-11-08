# Install

Tersio installs into an agent host. Pick the row for the host you use.

| Host | Install | Update | Remove |
|---|---|---|---|
| Any (default) | one-liner below | `tersio update` | `tersio uninstall` |
| [OMP](https://github.com/can1357/oh-my-pi) | `tersio install --host omp` | `tersio update --host omp` | `tersio uninstall --host omp` |
| [pi](https://github.com/earendil-works/pi) | `tersio install --host pi` | `tersio update --host pi` | `tersio uninstall --host pi` |
| [OpenCode](https://opencode.ai) | `tersio install --host opencode` | `tersio update --host opencode` | `tersio uninstall --host opencode` |
| [Pi-in-go (PiG)](https://pi-in-go.dev) | `tersio install --host pig` | `tersio update --host pig` | `tersio uninstall --host pig` |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `tersio install --host dsh` | `tersio update --host dsh` | `tersio uninstall --host dsh` |
| [Codex](https://github.com/openai/codex) | `tersio install --host codex` | `tersio update --host codex` | `tersio uninstall --host codex` |

Host-native equivalents, same code: `omp plugin install @krtclcdy/tersio`, `pi install npm:@krtclcdy/tersio`, `opencode plugin add @krtclcdy/tersio`, `pig install npm:@krtclcdy/tersio`. Codex can install the repo plugin with `codex plugin marketplace add KurutoDenzeru/tersio --sparse .agents/plugins --sparse plugins/tersio`, then `codex plugin add tersio@tersio`. That route installs the plugin, hooks, per-mode skills, and MCP server. Never run both forms for one host, or every command registers twice.

Codex loads Tersio's modes from a plugin hook. Restart Codex after installing and trust the hook in `/hooks` (or **Settings → Hooks**). Codex v1 does not wire RTK. Headroom is available through Headroom's own `headroom init codex` / `headroom unwrap codex` commands.

The plugin ships six discoverable skills: `$combo`, `$caveman`, `$ponytail`, `$pstack`, `$rtk`, and `$tersio`. Literal commands such as `/combo lite`, `/caveman full`, and `/ponytail lite` are handled by the plugin's `UserPromptSubmit` hook, which applies the mode, blocks the command from the model, and injects that mode into the rest of the session. Codex does not autocomplete those literal commands.

OpenCode users who installed via `opencode plugin add` update and remove through `opencode plugin update` / `opencode plugin remove` instead.

The default one-liner installs the CLI and runs the setup menus (scope + Combo preset) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

On Windows the same pass runs through PowerShell:

```powershell
irm https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.ps1 | iex
```

Passing flags needs the download wrapped in a scriptblock, because `iex` cannot take arguments:

```powershell
& ([scriptblock]::Create((irm https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.ps1))) --npm
```

Each host loads its extensions from one place, so the same file never loads twice: `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/` for OMP, `~/.pi/agent/extensions`, `~/.config/opencode/plugins/tersio`. Codex loads the plugin cache under `$CODEX_HOME/plugins/cache/tersio/tersio/`. The OMP agent tree keeps rtk's own `extensions/rtk.ts` wiring, which `config.yml` registers. `tersio update` without `--host` refreshes OMP.

## Requirements

- OMP, pi, OpenCode, PiG, DeepSeek Harness, or Codex.
- Node.js 20.12+ with npm, or Bun. The installer prefers Bun when it is present.
- SQLite runs in process where the runtime provides it (Bun, or Node 22.5+); an older Node uses the `sqlite3` binary instead.
- macOS, Linux, or Windows. Install from the environment where the host runs.

## After installing

Restart the host. Backend defaults come from `~/.tersio/settings.json`; override per session anytime.

The first interactive launch asks for a session-start Combo preset once (`off`, `lite`, `balanced`, `max`) and remembers it. Defaults apply to fresh sessions only; `/combo`, `/caveman`, or `/rtk` wins within that session. Set it ahead of time instead:

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

## Try before installing

```bash
tersio install --host pi --dry-run    # pi, preview only
```

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

## Check the install

```bash
tersio doctor
```

The `Hosts` section reports each host and the command that adds it:

```text
Hosts
  ✅ Oh My Pi: ok package @krtclcdy/tersio 2.25.4
  ✅ Pi: ok extensions @krtclcdy/tersio 2.25.4
  ✅ OpenCode: ok extensions @krtclcdy/tersio 2.25.4
  ✅ Codex: ok plugin tersio 2.25.4
```

`extensions` means the tree install wrote the files into the host's own directory; `package` means the host registered the npm package. A host you do not use prints `not installed` with its install command and is not counted as a problem.

OpenCode reports the same way as the other two. `tersio doctor --fix extensions` repairs a tree any host left half-written, and it also writes the OpenCode plugin tree and registers it in `opencode.json` when OpenCode is present.

## Also installed

The OMP plugin install and the one-line installer bring two more pieces:

- **RTK binary** — compact shell output, written to `~/.bun/bin/rtk`.
- **Ponytail** — vendored inside Tersio at `extensions/ponytail/`, loaded as a skill by both hosts.

Both routes carry Ponytail inside Tersio: OMP loads the skills from the plugin's own `extensions/ponytail/` tree, and pi gets a local package written from that same copy. RTK is a separate binary: get it with `tersio install` or the one-liner.

## Uninstall

```bash
tersio uninstall              # extensions, registration, Ponytail
tersio uninstall --keep-ponytail
tersio uninstall --remove-rtk # also removes the RTK binary
```

All hosts share one session-defaults file, `~/.tersio/settings.json`, so any uninstall clears it.
