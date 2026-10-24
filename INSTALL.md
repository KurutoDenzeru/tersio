# Install

Tersio installs into an agent host. Pick the row for the host you use.

| Host | Install | Update | Remove |
|---|---|---|---|
| Any (default) | one-liner below | `tersio update` | `tersio uninstall` |
| [OMP](https://github.com/can1357/oh-my-pi) | `tersio install --host omp` | `tersio update --host omp` | `tersio uninstall --host omp` |
| [pi](https://github.com/earendil-works/pi) | `tersio install --host pi` | `tersio update --host pi` | `tersio uninstall --host pi` |
| [OpenCode](https://opencode.ai) | `tersio install --host opencode` | `tersio update --host opencode` | `tersio uninstall --host opencode` |
| [Codex](https://github.com/openai/codex) | `tersio install --host codex` | `tersio update --host codex` | `tersio uninstall --host codex` |

Host-native equivalents, same code: `omp plugin install @krtclcdy/tersio`, `pi install npm:@krtclcdy/tersio`, `opencode plugin add @krtclcdy/tersio`. Never run both forms for one host, or every command registers twice.

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

Each host loads its files from one place, so the same file never loads twice: `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/` for OMP, `~/.pi/agent/extensions`, `~/.config/opencode/plugins/tersio`, and the Codex plugin cache. The OMP agent tree keeps rtk's own `extensions/rtk.ts` wiring, which `config.yml` registers. `tersio update` without `--host` refreshes OMP.

## Requirements

- OMP, pi, OpenCode, or Codex.
- Node.js 20.12+ with npm, or Bun. The installer prefers Bun when it is present.
- SQLite runs in process where the runtime provides it (Bun, or Node 22.5+); an older Node uses the `sqlite3` binary instead.
- macOS, Linux, or Windows. Install from the environment where the host runs.

## After installing

Restart the host. Backend defaults come from `~/.tersio/settings.json`; override per session anytime.

For Codex, review and trust the Tersio plugin hook in `/hooks`. Codex does not run an untrusted hook.

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
  ✅ Codex: ok extensions @krtclcdy/tersio 2.25.4
```

`extensions` means the tree install wrote the files into the host's own directory; `package` means the host registered the npm package. A host you do not use prints `not installed` with its install command and is not counted as a problem.

OpenCode reports the same way as the other hosts. `tersio doctor --fix extensions` repairs a tree any host left half-written, and it also writes the OpenCode plugin tree and registers it in `opencode.json` when OpenCode is present. `tersio doctor --fix codex` reinstalls or enables the Codex plugin.

## Codex plugin

The installer tries the repository marketplace first:

```bash
codex plugin marketplace add KurutoDenzeru/tersio --sparse .agents/plugins --sparse plugins/tersio
codex plugin add tersio@tersio
```

If that source is unavailable, the installer writes `~/.tersio/codex-plugin/` and adds it to `~/.agents/plugins/marketplace.json`. This local plugin carries its own runtime.

The plugin carries six skills (`$tersio-combo`, `$tersio-caveman`, `$tersio-rtk`, `$tersio-ponytail`, `$tersio-pstack`, and the status skill) and two hooks. The `UserPromptSubmit` hook adds the current mode block before each prompt. The `PreToolUse` hook rewrites eligible shell calls through `rtk` when the RTK default is on; it reads `~/.tersio/settings.json`, so the same defaults work in every host. Codex has no plugin slash commands: invoke a skill with `$skill-name` or pick it in `/skills`.

`tersio update --host codex` keeps the layout already on disk. A bundled install stays bundled. A marketplace install refreshes its marketplace, then runs `codex plugin add` again.

`tersio uninstall --host codex` removes the Tersio plugin and its settings. It keeps `~/.codex/plugins/data/tersio-tersio`, because that directory holds plugin data.

## Also installed

The OMP plugin install and the one-line installer bring two more pieces:

- **RTK binary** — compact shell output, written to `~/.bun/bin/rtk`.
- **Ponytail** — vendored inside Tersio at `extensions/ponytail/`, loaded as a skill by OMP, pi, and OpenCode.

Both routes carry Ponytail inside Tersio: OMP loads the skills from the plugin's own `extensions/ponytail/` tree, and pi gets a local package written from that same copy. RTK is a separate binary: get it with `tersio install` or the one-liner.

## Uninstall

```bash
tersio uninstall              # extensions, registration, Ponytail
tersio uninstall --keep-ponytail
tersio uninstall --remove-rtk # also removes the RTK binary
```

All hosts share one session-defaults file, `~/.tersio/settings.json`, so any uninstall clears it.
