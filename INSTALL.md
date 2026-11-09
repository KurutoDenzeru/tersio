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

## Native installs

Each host can install Tersio by itself, without the Tersio CLI. Pick one route per host, not both.

**Oh My Pi**

```bash
omp plugin install @krtclcdy/tersio
```

**pi**

```bash
pi install npm:@krtclcdy/tersio
```

**OpenCode**

```bash
opencode plugin add @krtclcdy/tersio
```

Update with `opencode plugin update`, remove with `opencode plugin remove`.

**Pi-in-go (PiG)**

```bash
pig install npm:@krtclcdy/tersio
```

**DeepSeek Harness**

```bash
dsh plugin --profile web add npm:@krtclcdy/tersio
```

The desktop app uses its own Plugins pane: **Add plugin** → paste `@krtclcdy/tersio` → restart the app.

**Codex**

```bash
codex plugin marketplace add KurutoDenzeru/tersio
codex plugin add tersio@tersio
```

In the Codex app, **Add plugin marketplace** asks for the same values: source `KurutoDenzeru/tersio`, Git ref `main`, sparse paths `.agents/plugins` and `plugins/tersio`.

This route installs the plugin, its seven skills, and the MCP server. It installs no prompt hook, because current Codex dropped plugin-declared hooks, so `/combo lite` reaches the model there. Use `tersio install --host codex` when you want the slash commands to answer instantly, then approve the Tersio hook in `/hooks` after restarting.

Codex does not wire RTK yet. Headroom is wired by `tersio install`, which runs `headroom init codex` for you.

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
