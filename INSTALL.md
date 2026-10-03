# Install

Tersio installs into an agent host. Pick the row for the host you use.

| Host | Install | Update | Remove |
|---|---|---|---|
| Any (default) | one-liner below | `tersio update` | `tersio uninstall` |
| [OMP](https://github.com/can1357/oh-my-pi) | `tersio install --host omp` | `tersio update --host omp` | `tersio uninstall --host omp` |
| [pi](https://github.com/earendil-works/pi) | `tersio install --host pi` | `tersio update --host pi` | `tersio uninstall --host pi` |
| [OpenCode](https://opencode.ai) | `tersio install --host opencode` | `tersio update --host opencode` | `tersio uninstall --host opencode` |

Host-native equivalents, same code: `omp plugin install @krtclcdy/tersio`, `pi install npm:@krtclcdy/tersio`, `opencode plugin add @krtclcdy/tersio`. Never run both forms for one host, or every command registers twice.

OpenCode users who installed via `opencode plugin add` update and remove through `opencode plugin update` / `opencode plugin remove` instead.

The default one-liner installs the CLI and runs the setup menus (scope + Combo preset) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

All three hosts load the same tree from their own directory: `~/.omp/agent/extensions`, `~/.pi/agent/extensions`, `~/.config/opencode/plugins/tersio`. `tersio update` without `--host` refreshes OMP.

## Requirements

- OMP, pi, or OpenCode.
- Node.js 20.12+ with npm.
- macOS, Linux, or WSL. Install from the environment where the host runs.

## After installing

Restart the host. Backend defaults come from `~/.tersio/settings.json`; override per session anytime.

The first interactive launch asks for a session-start Combo preset once (`off`, `medium`, `balanced`, `max`) and remembers it. Defaults apply to fresh sessions only; `/combo`, `/caveman`, or `/rtk` wins within that session. Set it ahead of time instead:

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
  ✅ OMP: ok plugin @krtclcdy/tersio 2.23.0
  ✅ Pi: ok npm:@krtclcdy/tersio 2.23.0
```

A host you do not use prints `not installed` with its install command and is not counted as a problem.

## Also installed

The OMP plugin install and the one-line installer bring two more pieces:

- **RTK binary** — compact shell output, written to `~/.bun/bin/rtk`.
- **Ponytail** — bundled as a Tersio dependency, loaded as a skill by both hosts.

Both routes install Ponytail: OMP as a nested plugin dependency, pi as `npm:@dietrichgebert/ponytail` (with a skills copy as the offline fallback). RTK is a separate binary: get it with `tersio install` or the one-liner.

## Uninstall

```bash
tersio uninstall              # extensions, registration, Ponytail
tersio uninstall --keep-ponytail
tersio uninstall --remove-rtk # also removes the RTK binary
```

All hosts share one session-defaults file, `~/.tersio/settings.json`, so any uninstall clears it.
