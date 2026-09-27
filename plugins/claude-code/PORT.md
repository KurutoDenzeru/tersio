# Claude Code port

**State: portable now.** Claude Code has a real plugin system, and one detail
makes it a better fit than the files we write today — a plugin directory under
`~/.claude/skills/` **auto-loads in every session with no install step and no
marketplace**. It is a directory copy, which is the same shape the Pi and OMP
layers already use.

Reference: <https://code.claude.com/docs/en/plugins> and
[/plugins/create](https://code.claude.com/docs/en/plugins/create).

## What ships today (static)

| Artifact | Path | Owner |
|---|---|---|
| rules block | `~/.claude/CLAUDE.md`, between `<!-- tersio:start -->` and `<!-- tersio:end -->` | user file, merged |
| skills | `~/.claude/skills/tersio-{caveman,ponytail,rtk}/SKILL.md` | tersio |
| rewrite script | `~/.claude/tersio-rtk-rewrite.mjs` | tersio |
| hook entry | `~/.claude/settings.json` → `hooks.PreToolUse`, matcher `Bash` | user file, merged |

## What a plugin changes

A plugin is a directory with `.claude-plugin/plugin.json` and fixed component
directories: `skills/<name>/SKILL.md`, `agents/`, `hooks/hooks.json`, `.mcp.json`.
`hooks/hooks.json` holds a top-level `"hooks"` key with the same shape as the
one in `settings.json`, so the rewriter entry ports across unchanged.

```text
~/.claude/skills/tersio/
├── .claude-plugin/plugin.json
├── skills/{caveman,ponytail,rtk}/SKILL.md
├── hooks/hooks.json
└── scripts/rtk-rewrite.mjs
```

```json
{
  "name": "tersio",
  "version": "2.23.0",
  "description": "Terse replies, minimum correct code, and RTK shell output"
}
```

Three real gains: the whole thing is one directory to write and one to remove;
`hooks/hooks.json` can point at `${CLAUDE_PLUGIN_ROOT}/scripts/…`, so the
absolute path into someone's home directory stops being baked into config; and
`claude plugin validate <path>` checks the manifest before it ships.

## Three costs to weigh

1. **Hooks do not carry a namespace.** The docs are explicit: a hook present in
   both `settings.json` and `hooks/hooks.json` runs twice on every fire. The
   rewriter would run `rtk rewrite` twice per Bash call. Migration must strip our
   entry from `settings.json` in the same run that writes the plugin, and doctor
   has to treat "entry in both places" as a defect, not a redundancy.
2. **Skill names change.** Plugin skills are prefixed: `/tersio:caveman`, not
   `/caveman`. The OMP and Pi surfaces keep the bare names, so the same mode has
   two spellings across hosts. That is a documentation and muscle-memory cost,
   not a correctness one.
3. **Context cost.** Every skill's name and description sit in context on every
   turn, whether or not it runs. Three skills is a small constant, and it is the
   same cost as today's three skill directories.

## Plan

1. `cli/claude-code-plugin.ts` — render the plugin tree, next to the existing
   `cli/pi-wiring.ts`, which already does exactly this shape for Pi.
2. Installer: when `claude-code` is selected, write the plugin tree instead of
   the four static artifacts. Keep the `CLAUDE.md` rules block — the plugin does
   not replace a global instructions file.
3. Uninstall: remove the plugin directory, and strip our `settings.json` entry
   if an older install left one. Both halves or the rewriter double-fires.
4. Doctor: report the plugin directory, not the four files, and add a check for
   the duplicate hook.
5. Keep the static path behind a flag for one release, then delete it. Two
   supported layouts for one host is the thing this registry exists to avoid.

## Not doing

- `.mcp.json` — an MCP server would be a second rewrite channel next to the
  hook, for the same outcome. One is enough until the hook stops working.
- Publishing to a marketplace. This is a user-scope install; a marketplace is
  for distributing to other people.
