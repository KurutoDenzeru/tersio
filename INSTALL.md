# Installing Tersio into your coding agents

Tersio writes the same three modes — **Caveman**, **Ponytail**, **RTK** — into
whichever agents you already use: the **rules pack** and a **skill** per mode.
Where an agent documents a way to intercept a shell command, it also gets a
**rewrite hook**, so `git status` becomes `rtk git status` without the model
having to remember.

Nothing is shared between agents except the `~/.agents/skills/` convention that
Codex and Pi both read. Every file lands inside that agent's own config
directory, and Tersio never rewrites a file you own — it edits only the span
between `<!-- tersio:start -->` and `<!-- tersio:end -->`.

## Quick start

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
tersio install --agent claude-code,codex
tersio doctor
```

`--agent` is repeatable and comma-separated. Omit it to auto-detect the agents
already on your machine. The selection is saved to `~/.tersio/agents.json` and
reused by every later `install` and `update`.

## Installing each agent

`tersio install` writes the files directly, and that is the supported path for
every host. Each agent also has its own package tooling, which is the
alternative if you prefer it — `tersio install` prints this block for the hosts
it touched.

| Agent | With Tersio | Native install | Notes |
|---|---|---|---|
| Claude Code | `tersio install --agent claude-code` | *held* | no native command until the [plugin port](#plugin-ports) lands |
| OpenAI Codex | `tersio install --agent codex` | *held* | no native command until the [plugin port](#plugin-ports) lands. `CODEX_HOME` relocates `~/.codex/`; the shared skills directory stays put |
| Pi | `tersio install --agent pi` | `pi install npm:@krtclcdy/tersio` | reads the `pi` manifest in `package.json` |
| Oh My Pi | `tersio install --agent omp` | `omp install @krtclcdy/tersio` | the native form installs the plugin and its bundled Ponytail dependency |
| OpenCode | `tersio install --agent opencode` | *(none)* | the plugin in `~/.config/opencode/plugins/` loads at startup, so there is nothing to install |

Not supported: Gemini CLI, Antigravity CLI, OpenClaw, Hermes, Grok Build, GitHub
Copilot CLI, Command Code, and Cursor. `tersio install` never writes to them, and
`tersio uninstall` never removes anything it did not write.

## Two classes of host

| Class | What you get | Hosts |
|---|---|---|
| **Hook** | Rules, skills, and a real auto-rewrite: Tersio generates a small rewriter script plus a hook entry in the agent's own config | Claude Code, Codex |
| **Extension** | Live modes from an extension tree, with the rewrite owned by the agent or by rtk | Oh My Pi, Pi, OpenCode |

`tersio doctor` reports which class each host is in, so you never have to take
this table on faith.

## Plugin ports

Every host has its own plugin system, and three already have a live tier.

| Host | Port | Notes |
|---|---|---|
| Oh My Pi | complete | five extensions plus `shared/` and `lib/`, injecting the modes every turn |
| Pi | complete | the same tree, written against Pi's own ExtensionAPI rather than a copy of OMP's |
| OpenCode | complete | a real v2 plugin at `~/.config/opencode/plugins/`, auto-discovered; no install command |
| Claude Code | **portable now, not adopted** | a plugin under `~/.claude/skills/` auto-loads with no install step, its `hooks/hooks.json` takes the same shape as the `settings.json` key, and its skills run as commands. The sharp edge: hooks carry no namespace, so a plugin hook and the existing `settings.json` entry would both fire, and the migration has to strip the old one in the same run |
| Codex | plugin available, **not the default** | the primitives exist, but installing goes through `codex plugin marketplace add` and its hooks are non-managed: installing does not trust them, the user reviews each one. A CLI cannot complete that silently |

Neither pending port changes what a host gets today, so porting is an
install-shape improvement rather than a capability one.

## Merge and removal rules

Enforced by tests:

- **Never clobber.** Instruction files and hook configs you also own are edited
  in place. Only the marked block, or the hook entry carrying Tersio's marker, is
  touched.
- **Idempotent.** Running `install` twice rewrites nothing the second time.
- **Fail open.** A rewriter that errors, times out, or cannot find rtk leaves
  your original command running. It never blocks a tool call, which matters most
  on the fail-closed hosts.
- **Uninstall is precise.** `tersio uninstall --agent <id>` strips the marked
  block, deletes files Tersio created outright, and reports anything it kept
  because your own content is still in it. It prints the plan before removing
  anything, naming only files actually on disk, grouped by agent.

  The menu offers only agents that have something on disk and takes one at a
  time; a second row clears every installed agent at once, placed last so the
  highlighted row — what a bare Enter takes — is a single agent. The confirm
  defaults to No. Picking **Oh My Pi (OMP)** there also removes the extensions
  and the Ponytail package, in that same menu. `--keep-omp-layer` does the same
  for scripts. `install` asks the same way, with an **All detected** row last.
- **Shared directories stay.** Codex and Pi write the same
  `~/.agents/skills/` files, so the content is identical either way and uninstall
  never removes the directory itself.

## Verifying

```bash
tersio doctor
tersio install --agent codex --dry-run
```

One row per selected host, folded into the summary tally. A row reports the
rewrite path the host actually got, and names the install command when something
is missing.

## Oh My Pi extras

OMP-only, because no other host has a portable equivalent:

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Then in a session: `/combo balanced`, or `/caveman full`, `/rtk on`,
`/ponytail full`. See the [README](./README.md#-commands-reference) for the full
command table.
