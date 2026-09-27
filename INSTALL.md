# Installing Tersio into your coding agents

Tersio writes the same three modes into whichever agents you already use: the
**rules pack** (Caveman, Ponytail, RTK) and a **skill** per mode. Where the agent
documents a way to intercept a shell command, it also gets a **rewrite hook** so
`git status` becomes `rtk git status` without the model having to remember.

Nothing is shared between agents. Every file lands inside that agent's own
config directory, and Tersio never rewrites a file you own — it edits only the
span between `<!-- tersio:start -->` and `<!-- tersio:end -->`.

## Quick start

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
tersio install --agent claude-code,codex
tersio doctor
```

`--agent` is repeatable and comma-separated. Omit it to auto-detect the agents
already on your machine. The selection is saved to `~/.tersio/agents.json` and
reused by every later `install` and `update`.

## Two classes of host

Not every agent can be wired the same way, and the difference is worth knowing
before you pick one.

| Class | What you get | Hosts |
|---|---|---|
| **Hook** | Rules, skills, and a real auto-rewrite. Tersio generates a small rewriter script plus a hook entry in the agent's own config | Claude Code, Codex |
| **Extension** | Rules and skills, with the rewrite owned by the agent or by rtk as a real extension file | Oh My Pi, Pi, OpenCode |

Claude Code and Codex both have plugin systems that could carry the hook and
skills as one installable unit. Tersio does not use them yet, and the reasons
differ per host — see [Plugin ports](#plugin-ports).

Not supported: Gemini CLI, Antigravity CLI, OpenClaw, Hermes, Grok Build, GitHub Copilot CLI, Command Code, and Cursor. `tersio install` never writes to them, and `tersio uninstall` never removes anything it did not write.

`tersio doctor` reports which class each selected host is in, so you never have
to take this table on faith.

## What each host gets

### Claude Code — `claude-code`

```text
~/.claude/CLAUDE.md                              rules block, merged
~/.claude/skills/tersio-{caveman,ponytail,rtk}/SKILL.md
~/.claude/settings.json                          PreToolUse entry, merged
~/.claude/tersio-rtk-rewrite.mjs                 the rewriter
```

`CLAUDE.md` and `settings.json` are yours; Tersio edits only its own block and
its own hook entry, and uninstall removes exactly those.

A plugin under `~/.claude/skills/` would carry the skills and the hook as one
directory, auto-loading with no install step. Not used yet — see
[Plugin ports](#plugin-ports).

### OpenAI Codex — `codex`

```text
~/.codex/AGENTS.md
~/.agents/skills/tersio-{caveman,ponytail,rtk}/SKILL.md
~/.codex/hooks.json
~/.codex/tersio-rtk-rewrite.mjs
```

`~/.agents/skills/` is the shared Agent Skills directory, so these also load in any
other agent that reads it. `CODEX_HOME` relocates `~/.codex/`; the shared skills
directory is deliberately *not* moved with it.

Codex has a plugin system that would carry the skills and the hook as one
unit, and it would let the rewriter resolve through `PLUGIN_ROOT` instead of a
path baked into `hooks.json`. Not used yet — see
[Plugin ports](#plugin-ports).

### Oh My Pi — `omp`

Rules and skills are written by the OMP plugin; the rewrite is rtk's own
extension, written by `rtk init -g --agent omp`.

OMP is the reference host for the live-session tier: mid-session mode switching,
the Combo bar, and subagent inheritance. Pi gets the same tier through its own
extension tree, written against its own ExtensionAPI — same commands, same
state, different prompt plumbing. That is a capability difference, not a
primacy one, and it exists because these two hosts have an extension API that
can change state mid-session and the other three do not. Nothing else in
Tersio is host-specific: the rules, the skills, the rewrite, the CLI, the
dashboard, and the ledger are the same code on every host.

### Pi — `pi`

```text
~/.pi/agent/AGENTS.md
~/.pi/agent/skills/tersio-{caveman,ponytail,rtk}/SKILL.md
~/.pi/agent/extensions/{caveman-session,rtk-session,combo-toggle,tersio-commands,ai-addons-updater}/index.ts
~/.pi/agent/extensions/{shared,lib}/
```

The rewrite is rtk's own extension at `~/.pi/agent/extensions/rtk.ts`, written by
`rtk init -g --agent pi`. rtk owns that format, so a Tersio release is not needed
when it changes.

The live modes are the extension tree Tersio writes beside it, from
`extensions/pi/`. It is the same layer OMP gets, laid out the way Pi loads it:
one directory per extension, each with an `index.ts` Pi picks up through jiti at
`<agent-dir>/extensions/<dir>/index.ts`, with `shared/` and `lib/` beside them
imported by the extension modules. So `/caveman`, `/rtk`, `/ponytail`, and
`/combo` switch modes mid-session, `/tersio` reports status, `/ai-addons`
updates the add-ons, and the active modes inject into every turn.

The modules are written against Pi's ExtensionAPI, not a copy of OMP's. The
differences that matter: modes are injected by writing
`event.systemPromptOptions.sections` rather than by returning a replacement
prompt, each mode owns one sealed section name, a failed tool result is thrown
rather than returned, and there is no `session_branch` event, so mode restore
hangs off `session_start` and `session_tree`.

Uninstalling Pi removes the whole tree with the rules and skills above. rtk's
own `rtk.ts` is removed too when Pi is selected, but the shared rtk binary is
only removed with `--remove-rtk`.

### OpenCode — `opencode`

```text
~/.config/opencode/plugins/tersio-rtk.ts
~/.config/opencode/AGENTS.md
```

The rewrite is a real OpenCode plugin, written by Tersio. OpenCode auto-discovers
`.ts` and `.js` files from that directory, so it loads by being placed there —
no config entry and no marketplace. It uses the v2 shape (`Plugin.define` with
`id` and `setup(ctx)`, hooks registered through `ctx.tool.hook('execute.before')`)
because `rtk init --opencode` still emits a pre-v2 plugin that current OpenCode
refuses to load ([rtk-ai/rtk#3463](https://github.com/rtk-ai/rtk/issues/3463)).

No skills are written. OpenCode documents no *global* skills directory — skills
are project-scoped at `.opencode/skills/` — so that capability is left unclaimed
rather than pointed at an invented path.

## Plugin ports

Each host gets its plugin system or its extension API. Where that stands, and
what a plugin port would change, is one document per host under
[`plugins/`](./plugins):

| Host | Port | Notes |
|---|---|---|
| [Oh My Pi](./plugins/omp/PORT.md) | complete | five extensions plus `shared/` and `lib/`; live mode switching |
| [Pi](./plugins/pi/PORT.md) | complete | the same tree written against Pi's own ExtensionAPI |
| [OpenCode](./plugins/opencode/PORT.md) | complete | a real plugin module, auto-discovered |
| [Claude Code](./plugins/claude-code/PORT.md) | **portable now** | a plugin directory auto-loads with no install step; the blocker is the double-fire risk with an existing `settings.json` hook |
| [Codex](./plugins/codex/PORT.md) | plugin available, **not the default** | installing one needs a marketplace plus a hook trust step, where the static hook is a silent file write |

The two hook hosts are deliberately not ported yet. Claude Code's port is a
directory copy and is worth doing; Codex's would make the install a user action
that a CLI cannot complete silently. Neither changes what a host gets today —
rules, skills and a working rewrite — so porting is an install-shape
improvement, not a capability one.

## Merge and removal rules

These hold for every host, and they are enforced by tests:

- **Never clobber.** Instruction files and hook configs you also own are edited
  in place. Only the marked block, or the hook entry carrying Tersio's marker,
  is touched.
- **Idempotent.** Running `install` twice rewrites nothing the second time.
- **Fail open.** A rewriter that errors, times out, or cannot find rtk leaves
  your original command running. It never blocks a tool call, which matters most
  on the fail-closed hosts.
- **Uninstall is precise.** `tersio uninstall --agent <id>` strips the marked
  block, deletes files Tersio created outright, and reports anything it kept
  because your own content is still in it. A file that held nothing but
  Tersio's block is removed; a file you also write to is left in place. Before
  removing anything it prints the plan: each selected agent's files grouped
  under that agent, and only files actually on disk are named.

  The menu offers only the agents that have something on disk, and takes one at
  a time. An agent Tersio never wrote to is not listed: there would be nothing
  to remove, and a `Claude Code — 0 files` row turns a one-agent decision into
  a five-agent one. A second row clears every installed agent at once when
  there is more than one, and it sits last, so the highlighted row — what a
  bare Enter takes — is a single agent. The confirm after it still defaults to
  No. The Oh My Pi extensions and the Ponytail package go by picking **Oh My Pi
  (OMP)** in that same menu, not by a separate question. `--keep-omp-layer`
  does the same for scripts. `install` asks the same way, one agent per run,
  with an **All detected** row at the end for the machine-wide case.
- **Shared directories stay.** Codex and Pi use the shared `~/.agents/skills/` convention.
  Both write the same files, so the content is identical either way and
  uninstall never removes the directory itself.

## Verifying

```bash
tersio doctor
```

One row per selected host, folded into the summary tally. A row reports the
rewrite path the host actually got, and names the install command when something
is missing. To see what would change without writing anything:

```bash
tersio install --agent codex --dry-run
```

## Oh My Pi extras

OMP-only, because no other host has a portable equivalent:

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Then in a session: `/combo balanced`, or `/caveman full`, `/rtk on`,
`/ponytail full`. See the [README](./README.md#-commands-reference) for the full
command table.
