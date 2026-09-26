# Installing Tersio

Tersio is one CLI that installs into every coding agent you use. You pick your agents once; the CLI writes each host's own format, hook protocol, and config path.

- [What gets installed](#what-gets-installed)
- [Requirements](#requirements)
- [Install](#install)
- [Choosing agents](#choosing-agents)
- [After installing](#after-installing)
- [Changing your agents later](#changing-your-agents-later)
- [Updating](#updating)
- [Removing](#removing)
- [Automation and CI](#automation-and-ci)
- [Verify the install](#verify-the-install)
- [Troubleshooting](#troubleshooting)

## What gets installed

Three behaviors, ported to each agent:

| Behavior | What it does | Where it comes from |
|---|---|---|
| **Caveman** | Terse replies | Instruction text (rules pack or skill) |
| **Ponytail** | Minimal code decisions | Instruction text (rules pack or skill) |
| **RTK** | Filters noisy shell output before the model reads it | A real binary plus a shell-rewrite hook |

RTK needs a binary (`~/.bun/bin/rtk`) and a hook that each agent runs before a shell command. The CLI downloads the binary once and writes each host's hook in that host's own dialect.

Most agents also expose the modes as slash commands, but in two different ways. **Runtime toggle** (Oh My Pi, and OpenCode through prompt commands) means the command changes something the host itself consults, so the mode holds until changed. **Prompt command** (Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor, Grok Build, Hermes, OpenClaw) means the command injects the mode text into the conversation, so it applies to that turn onward but is not a switch anything else can read. What does **not** port anywhere is the live Combo state bridge and the status bar: those are Oh My Pi features with no equivalent in any other host.

## Requirements

- **Node.js 20.12+** with npm
- At least one supported agent

Nothing else. The RTK binary is downloaded and checksum-verified for you.

## Install

**macOS, Linux, WSL — one line.** This installs the CLI via npm, then runs the installer, which asks which agents to install for:

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
```

**Already have the CLI, or prefer npm:**

```bash
npm install -g @krtclcdy/tersio
tersio install
```

**One-off, no global install:**

```bash
npm exec --yes --prefer-online --package=@krtclcdy/tersio@latest -- tersio install
```

## Choosing agents

The installer asks once:

```text
◆  Install for which coding agents?
│  ◉ Oh My Pi              rules pack · skills · rtk auto-rewrite
│  ◉ OpenCode              rules pack · skills · rtk auto-rewrite
│  ◉ Claude Code           rules pack · skills · rtk auto-rewrite
│  ◉ OpenAI Codex          rules pack · skills · rtk auto-rewrite
│  ◉ Gemini CLI            rules pack · skills · rtk auto-rewrite
│  ◉ GitHub Copilot CLI    rules pack · skills · rtk auto-rewrite
│  ◉ Cursor                rules pack · skills · rtk auto-rewrite
│  ◉ Grok Build            rules pack · skills · rtk auto-rewrite
│  ◉ Pi                    rules pack · skills · rtk auto-rewrite
│  ◉ OpenClaw              rules pack · skills · rtk guidance only
│  ◉ Hermes                skills · rtk auto-rewrite
```

Space toggles, arrows move, Enter confirms.

### Skip the prompt

Pass `--agent` with one or more ids:

```bash
tersio install --agent omp,opencode
tersio install --agent claude-code
tersio install --agent omp --agent cursor
```

Valid ids: `omp`, `opencode`, `claude-code`, `codex`, `gemini-cli`, `copilot-cli`, `cursor`, `grok-build`, `pi`, `openclaw`, `hermes`.

### What each agent gets

| Agent | id | Rules file | Skills | RTK auto-rewrite |
|---|---|---|---|---|
| Oh My Pi | `omp` | — (live extension) | ✅ | ✅ |
| OpenCode | `opencode` | `AGENTS.md` | ✅ | ✅ |
| Claude Code | `claude-code` | `CLAUDE.md` | ✅ | ✅ |
| OpenAI Codex | `codex` | `AGENTS.md` | ✅ | ✅ |
| Gemini CLI | `gemini-cli` | `GEMINI.md` | ✅ | ✅ |
| GitHub Copilot CLI | `copilot-cli` | `copilot-instructions.md` | ✅ | ✅ |
| Cursor | `cursor` | `rules/tersio.mdc` | ✅ | ✅ |
| Grok Build | `grok-build` | `rules/tersio.md` | ✅ | ✅ |
| Pi | `pi` | `AGENTS.md` | ✅ | ✅ (rtk-owned extension) |
| OpenClaw | `openclaw` | `AGENTS.md` | ✅ | — guidance only |
| Hermes | `hermes` | — (none global) | ✅ | ✅ |

Two agents get something different on purpose:

- **Hermes** has no user-global instruction file at all — `SOUL.md` is its only global context file, and `AGENTS.md` is project-scoped. So its modes arrive as skills.
- **OpenClaw** can rewrite tool arguments only from a native TypeScript plugin, so it gets RTK guidance rather than a static hook. Shell commands still pass through, just without automatic rewriting.

### Your agent's own config location

The CLI honors each tool's relocation variable:

| Agent | Config dir | Override |
|---|---|---|
| Oh My Pi | `~/.omp` | — |
| OpenCode | `~/.config/opencode` | — (see note) |
| Claude Code | `~/.claude` | — |
| OpenAI Codex | `~/.codex` | `CODEX_HOME` |
| Gemini CLI | `~/.gemini` | — |
| GitHub Copilot CLI | `~/.copilot` | `COPILOT_HOME` |
| Cursor | `~/.cursor` | `CURSOR_CONFIG_DIR` |
| Grok Build | `~/.grok` | `GROK_HOME` |
| Pi | `~/.pi/agent` | `PI_CODING_AGENT_DIR` |
| OpenClaw | `~/.openclaw` | `OPENCLAW_STATE_DIR` |
| Hermes | `~/.hermes` | `HERMES_HOME` |

OpenCode itself resolves its config directory through `XDG_CONFIG_HOME` on some platforms. Tersio writes to and auto-detects `~/.config/opencode`, so if you have relocated it, create that directory or pass `--agent opencode` explicitly.

### Session defaults (Oh My Pi)

Oh My Pi also asks for a session-start Combo preset, which controls what each new session starts with:

```bash
tersio install --combo-default balanced
```

| Preset | Caveman | RTK | Ponytail |
|---|---|---|---|
| `off` | off | off | off |
| `medium` | lite | on | lite |
| `balanced` | full | on | full |
| `max` | ultra | on | ultra |

Per-mode overrides win over the preset: `--caveman-default`, `--rtk-default`, `--ponytail-default`.

Defaults apply to fresh sessions only — anything you set later with `/combo`, `/caveman`, or `/rtk` persists and wins.

## After installing

1. **Restart every agent you installed.** Each host reads its config at startup.
2. **Enable a mode.** In Oh My Pi:

   ```text
   /combo balanced
   ```

   Individual toggles: `/caveman full` · `/rtk on` · `/ponytail full`. Everything starts off until you enable it.

3. **Other agents** read their rules file at session start. Start a new session to pick up changes.

Check it worked:

```bash
tersio doctor
```

## Changing your agents later

```bash
tersio settings agents
```

Or non-interactively:

```bash
tersio settings --agent omp,claude-code
```

Then run `tersio install` to apply. The selection persists in `~/.tersio/agents.json` and is reused by every later install, reinstall, and update.

`tersio settings` with no arguments walks through every setting interactively.

## Updating

```bash
tersio update
```

Refreshes the CLI and re-runs the installer for your stored agent selection — so a new agent support, a new host format, or an updated RTK binary all arrive on one command. You are not re-prompted.

Refresh one add-on:

```bash
tersio update rtk
tersio update caveman
```

Preview first with `--dry-run`.

## Removing

```bash
tersio uninstall
```

Removes the extensions, the plugin registration, and every selected agent's files. Outside Oh My Pi this is non-destructive: instruction files keep their content and lose only the marked `tersio` block, hook configs keep every hook except ours, and the skill directories Tersio created are removed. The `.bak` files stay.

| Flag | Effect |
|---|---|
| `--remove-rtk` | Also remove the RTK binary and every RTK hook |
| `--keep-ponytail` | Keep the Ponytail package |
| `--dry-run` | Show what would be removed, change nothing |

## Automation and CI

Non-interactive runs never prompt. They auto-detect instead: every agent whose config directory already exists is included, so an agent you never installed never gets a directory created for it.

```bash
tersio install --yes --agent omp,opencode    # explicit, best for CI
tersio install --yes                          # auto-detect
```

Set session defaults without prompting:

```bash
tersio install --yes --agent omp --combo-default balanced
```

## Verify the install

```bash
tersio doctor
```

Reports the CLI, the shared add-ons, and one row per selected agent:

```text
Add-ons
  ✅ RTK binary: ok rtk 0.50.0 (updated just now)
  ✅ Claude Code rules: ok /…/.claude/CLAUDE.md
  ✅ Claude Code rtk hook: ok /…/.claude/settings.json
  ✅ Cursor rules: ok /…/.cursor/rules/tersio.mdc
  ✅ Cursor rtk hook: ok /…/.cursor/hooks.json
  ✅ Hermes skills: ok /…/.hermes/skills/tersio-rtk/SKILL.md
  Summary: 34 checks — ✅ 34 ok, ⚠️ 0 warn, ❌ 0 missing
```

Only selected agents are checked, so opting out leaves no permanent warning.

Repair problems:

```bash
tersio doctor --fix            # repair everything it can
tersio doctor --fix rtk        # one scope
tersio doctor --fix --dry-run  # preview
```

See usage and measured savings:

```bash
tersio usage
tersio dashboard --open
```

## Troubleshooting

**RTK commands are not being rewritten.** Run `tersio doctor` and check that agent's `rtk hook` row. Two limits apply everywhere: RTK only rewrites **shell commands**, so an agent's native file and search tools stay unmetered; and a compound command like `echo x && git status` has no single RTK equivalent, so it passes through unchanged.

**A command shows output but no savings.** `rtk gain` lists what was actually rewritten and metered. If a command is missing from that list, RTK had no equivalent for it.

**RTK binary not executable.** `chmod +x ~/.bun/bin/rtk` on Linux and macOS, then `tersio doctor`.

**An agent I did not select is not installed.** Expected. Only selected agents are written — change the selection with `tersio settings agents`.

**Changes are not showing up.** Restart the agent. Most hosts read their instruction file and hooks only at startup.

**OpenCode commands are not rewritten.** OpenCode needs its own plugin because `rtk init -g --opencode` still emits a file OpenCode refuses to load ([rtk#3463](https://github.com/rtk-ai/rtk/issues/3463), [rtk#3898](https://github.com/rtk-ai/rtk/issues/3898)). `tersio install` writes a compatible one instead. Set `TERSIO_RTK=off` to disable the hook.

**Windows or WSL.** Install from the environment where your agent runs — the two have separate homes. Inside WSL, `command -v npm` must resolve to a Linux path, not `/mnt/c/`.

## See also

- [README](./README.md) — what the modes do, benchmarks, and the full agent matrix
- [BENCHMARK.md](./BENCHMARK.md) — measurement protocol and caveats
- [Contributing.md](./Contributing.md) — development workflow
