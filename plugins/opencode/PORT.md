# OpenCode port

**Complete.** OpenCode was the third host to get a real plugin, and it needed
one written from scratch rather than generated.

Reference: <https://opencode.ai/v2/docs/plugins/>.

## What ships

`~/.config/opencode/plugins/tersio-rtk.ts`. OpenCode auto-discovers `.ts` and
`.js` files and package directories from the global plugins directory, so the
file is installed by being placed there — no config entry, no marketplace. Rules
go to `~/.config/opencode/AGENTS.md`.

**No skills.** OpenCode documents no *global* skills directory; skills are
project-scoped at `.opencode/skills/`. The registry leaves the skills flag
unclaimed for this host rather than inventing a path, so the doctor row shows
rules and rewrite only.

## Why Tersio ships its own plugin

`rtk init --opencode` still emits a **pre-v2** plugin that current OpenCode
refuses to load ([rtk-ai/rtk#3463](https://github.com/rtk-ai/rtk/issues/3463)).
Tersio therefore writes the v2 shape itself:

- a `Plugin.define`-style definition with `id` and `setup(ctx)`
- hooks registered through `ctx.tool.hook('execute.before')`, because OpenCode's
  documented hook surface cannot replace a tool input

Types in that file are **structural**, not imported. It is loaded from a config
directory with no `node_modules`, so nothing may be resolved at load time. A test
asserts every import is a node builtin and that none of the three pre-v2 shapes
reappear — the failure mode this guards against is a plugin that installs
cleanly and then does nothing.

## Also covered

The usage tracker reads OpenCode message files
(`opencode/<provider>/<model>`), so sessions run here reach `tersio usage` and
the dashboard. Those messages carry no tool parts, so there is no bash-adoption
statistic for this host — the row is omitted rather than reported as zero.

## Source

`extensions/opencode/rtk-plugin.ts`, wired by `cli/opencode-wiring.ts`.
