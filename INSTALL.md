# Install

Tersio installs into an agent host. Pick the row for the host you use.

| Host | Install | Update | Remove |
|---|---|---|---|
| Any (default) | one-liner below | `tersio update` | `tersio uninstall` |
| [OMP](https://github.com/can1357/oh-my-pi) | `omp plugin install @krtclcdy/tersio` | `omp` (or `tersio update`) | `omp plugin remove @krtclcdy/tersio`, then `tersio uninstall` |
| [pi](https://github.com/earendil-works/pi) | `tersio install --host pi` | `tersio install --host pi` | `tersio uninstall --host pi` |
| [OpenCode](https://opencode.ai) | `tersio install --host opencode` | `tersio install --host opencode` | `tersio uninstall --host opencode` |

The default one-liner installs the CLI and runs the setup menus (scope + Combo preset) in the same pass:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

All three host rows write the same extension tree into that agent's own directory: `~/.omp/agent/extensions`, `~/.pi/agent/extensions` (which pi auto-discovers), and `~/.config/opencode/plugins/tersio` (registered in `opencode.json`). The npm package keeps the `pi` and `pi-package` keywords, so Tersio is listed in the [pi package gallery](https://pi.dev/packages); `pi install npm:@krtclcdy/tersio` works too and finds the same `extensions/` by convention. See the [pi package docs](https://pi.dev/docs/latest/packages).

## Requirements

- OMP, pi, or OpenCode.
- Node.js 20.12+ with npm.
- macOS, Linux, or WSL. Install from the environment where the host runs.

## After installing

Restart the host, then pick a preset:

```text
/combo balanced
```

Individual toggles: `/caveman full` · `/rtk on` · `/rtk off` · `/ponytail full`. Everything starts off until you enable it.

The first interactive launch asks for a session-start Combo preset once (`off`, `medium`, `balanced`, `max`) and remembers it. Set it ahead of time instead:

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Defaults apply to fresh sessions only. Anything you set with `/combo`, `/caveman`, or `/rtk` wins for that session.

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
