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
tersio install --agent claude-code,cursor
tersio doctor
```

`--agent` is repeatable and comma-separated. Omit it to auto-detect the agents
already on your machine. The selection is saved to `~/.tersio/agents.json` and
reused by every later `install`, `reinstall`, and `update`.

## The three classes of host

Not every agent can be wired the same way, and the difference is worth knowing
before you pick one.

| Class | What you get | Hosts |
|---|---|---|
| **Hook** | Rules, skills, and a real auto-rewrite. Tersio generates a small rewriter script plus a hook entry in the agent's own config | Claude Code, Codex, Cursor |
| **Extension** | Rules and skills, with the rewrite owned by the agent or by rtk as a real extension file | Oh My Pi, Pi, OpenCode |

Not supported: Gemini CLI, Antigravity CLI, OpenClaw, Hermes, Grok Build, GitHub Copilot CLI, and Command Code. `tersio install` never writes to them, and `tersio uninstall` never removes anything it did not write.

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

### Cursor — `cursor`

```text
~/.cursor/rules/tersio.mdc
~/.cursor/skills/tersio-{caveman,ponytail,rtk}/SKILL.md
~/.cursor/hooks.json
~/.cursor/tersio-rtk-rewrite.mjs
```

Cursor ignores a rule file without frontmatter, so `tersio.mdc` is written with
the required `---` block.

### Oh My Pi — `omp`

Rules and skills are written by the OMP plugin; the rewrite is rtk's own
extension, written by `rtk init -g --agent omp`. OMP is the reference host and
the only one with live mid-session switching, the Combo bar, and subagent
inheritance.

### Pi — `pi`

```text
~/.pi/agent/AGENTS.md
~/.pi/agent/skills/tersio-{caveman,ponytail,rtk}/SKILL.md
```

The rewrite is rtk's own extension at `~/.pi/agent/extensions/rtk.ts`, written by
`rtk init -g --agent pi`. rtk owns that format, so a Tersio release is not needed
when it changes.

### OpenCode — `opencode`

Nothing is written yet. `rtk init` still emits a pre-v2 plugin that current
OpenCode refuses to load ([rtk-ai/rtk#3463](https://github.com/rtk-ai/rtk/issues/3463)),
so Tersio has to ship its own plugin. That module is not in this release.

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
  Tersio's block is removed; a file you also write to is left in place.
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
tersio install --agent cursor --dry-run
```

## Oh My Pi extras

OMP-only, because no other host has a portable equivalent:

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Then in a session: `/combo balanced`, or `/caveman full`, `/rtk on`,
`/ponytail full`. See the [README](./README.md#-commands-reference) for the full
command table.
