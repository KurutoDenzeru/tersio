# Installing Tersio into your coding agents

Tersio writes the same three modes — **Caveman**, **Ponytail**, **RTK** — into the
two agents it supports, **Oh My Pi** and **Pi**. Both are extension-tree hosts: an
extension injects the modes on every turn, and the shell rewrite comes from rtk's
own module, so `git status` becomes `rtk git status` without the model having to
remember.

Tersio writes no rules file into either host, and never rewrites a file you own.
The one file it still touches is a global `AGENTS.md` an **earlier** release
merged into; that marked span is removed on install and uninstall, and your own
text around it is left alone.

## Quick start

```bash
curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
tersio install --agent omp,pi
tersio doctor
```

`--agent` is repeatable and comma-separated. Omit it to auto-detect the agents
already on your machine. The selection is saved to `~/.tersio/agents.json` and
reused by every later `install` and `update`.

## Installing each host

`tersio install` writes the files directly, and that is the supported path for
both hosts. Each host also has its own package tooling, which is the alternative
if you prefer it — `tersio install` prints this block for the hosts it touched.

| Agent | With Tersio | Native install | Notes |
|---|---|---|---|
| Oh My Pi | `tersio install --agent omp` | `omp install @krtclcdy/tersio` | the native form installs the plugin and its bundled Ponytail dependency |
| Pi | `tersio install --agent pi` | `pi install npm:@krtclcdy/tersio` | reads the `pi` manifest in `package.json`; `PI_CODING_AGENT_DIR` relocates `~/.pi/agent/` |

Not supported: Claude Code, OpenAI Codex, OpenCode, Gemini CLI, Antigravity CLI,
OpenClaw, Hermes, Grok Build, GitHub Copilot CLI, Command Code, and Cursor.
`tersio install` never writes to them, and `tersio uninstall` never removes
anything it did not write.

## What each host gets

| Host | Delivered by | Live modes | RTK rewrite |
|---|---|---|---|
| Oh My Pi | 7-directory extension tree | ✅ per session | ✅ `rtk init -g --agent omp` |
| Pi | 7-directory extension tree | ✅ per session | ✅ `rtk init -g --agent pi` |

Both inject the modes every turn, so a static copy is not written: it would
duplicate the injection and — being always-on — would outlive `/combo off`,
leaving a mode on with no way to turn it off. The rewrite is rtk's own module
because rtk owns that format, so upgrading rtk needs no Tersio release.
`tersio doctor` names the mechanism and the paths for each host.

## Merge and removal rules

Enforced by tests:

- **Never clobber.** A merged file is edited in place; only the span between
  `<!-- tersio:start -->` and `<!-- tersio:end -->` is touched.
- **Idempotent.** Running `install` twice rewrites nothing the second time.
- **Earlier releases are cleaned up.** Paths an earlier version wrote and this
  one no longer does are removed on install *and* uninstall, so a directory we
  created outright goes, and a user's own `AGENTS.md` keeps its text.
- **Uninstall is precise.** `tersio uninstall --agent <id>` prints the plan
  before removing anything, naming only what is actually on disk.

  The menu offers only hosts that have something on disk and takes one at a
  time; a second row clears every installed host at once, placed last so the
  highlighted row — what a bare Enter takes — is a single host. The confirm
  defaults to No. Picking **Oh My Pi (OMP)** there also removes the extensions
  and the Ponytail package, in that same menu. `--keep-omp-layer` does the same
  for scripts. `install` asks the same way, with an **All detected** row last.

## Verifying

```bash
tersio doctor
tersio install --agent pi --dry-run
```

One row per selected host, folded into the summary tally. A row counts the
extension directories the host owns, names its binary path and version, and names
the install command when something is missing.

## Oh My Pi extras

```bash
tersio install --combo-default balanced --caveman-default lite --rtk-default on
```

Then in a session: `/combo balanced`, or `/caveman full`, `/rtk on`,
`/ponytail full`. See the [README](./README.md#-commands-reference) for the full
command table.
