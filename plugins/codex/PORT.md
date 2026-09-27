# OpenAI Codex port

**State: the plugin system exists and is a good fit, but its install path is a
marketplace, not a directory copy.** That is the whole decision here, and it is
why the recommendation at the bottom is to keep the static hook as the default.

References: <https://developers.openai.com/plugins/build/plugins>,
<https://developers.openai.com/codex/plugins>, and
<https://learn.chatgpt.com/docs/hooks>.

## What ships today (static)

| Artifact | Path | Owner |
|---|---|---|
| rules block | `~/.codex/AGENTS.md`, marked span | user file, merged |
| skills | `~/.agents/skills/tersio-{caveman,ponytail,rtk}/SKILL.md` | tersio, shared root with Pi |
| rewrite script | `~/.codex/tersio-rtk-rewrite.mjs` | tersio |
| hook entry | `~/.codex/hooks.json` → `hooks.PreToolUse`, matcher `^Bash$` | tersio-named file |

## What a plugin changes

Codex accepts a portable manifest at the plugin root, with `.codex-plugin/plugin.json`
as a compatibility fallback, and discovers `skills/` and `hooks/hooks.json` by
default. Hook commands get `PLUGIN_ROOT` and `PLUGIN_DATA`.

```text
tersio/
├── plugin.json                     # portable, $schema agent-plugins.org 1.0.0
├── skills/{caveman,ponytail,rtk}/SKILL.md
└── hooks/
    ├── hooks.json
    └── rtk-rewrite.mjs
```

Two things make this better than what we write now:

- **The same hook script serves both hosts.** Codex sets `CLAUDE_PLUGIN_ROOT` and
  `CLAUDE_PLUGIN_DATA` for compatibility with existing plugin hooks, and plugin
  hooks use the same event schema as the `PreToolUse` entry in `hooks.json` today.
  One rewriter, one `hooks.json`, two manifests.
- **No absolute path in config.** `node ${PLUGIN_ROOT}/hooks/rtk-rewrite.mjs`
  resolves against the installed plugin instead of a path baked into a user's
  home directory at install time.

## Why it is not the default yet

1. **Install is marketplace-driven.** There is no documented "copy a directory
   into `~/.codex/`" path. A local plugin is reached through
   `codex plugin marketplace add <source>` and then installing it from the
   Plugins Directory, with user-level choices recorded in `~/.codex/config.toml`.
   That is a user action per machine, where the static path is a silent file
   write. Tersio's whole install story is "run it and it is wired".
2. **Hooks need a trust step.** Installing or enabling a plugin does not trust
   its hooks: Codex treats plugin-bundled hooks as non-managed and skips them
   until the user reviews the current hook definition. A silent installer cannot
   complete that, so a plugin-only Codex install can end up looking installed
   while the rewriter never runs.
3. **Bundle-plugin hooks are newer than the rest of the surface** and were
   shipped behind a feature flag. Depending on it makes the install
   version-sensitive in a way the static path is not.

## Plan

Do the plugin **and** keep the static hook, with the static one the default:

1. `cli/codex-plugin.ts` — render the same tree as the Claude port, with a
   Codex manifest and the same `hooks/hooks.json`. Share the skill bodies and
   the rewriter between the two ports rather than emitting them twice.
2. Ship the plugin in the npm package and have the installer write it to
   `~/.agents/plugins/marketplace.json` alongside the plugin folder, so a user
   who wants the plugin path has one command to add the source. Record in doctor
   that the install is not complete until the plugin is installed and its hook
   trusted, rather than reporting it as wired.
3. Add the double-fire check: our `hooks.json` entry plus the plugin's
   `hooks/hooks.json` means `rtk rewrite` runs twice per Bash call. Same defect
   as the Claude port, same fix — strip one.
4. Revisit when Codex ships a user-scope install that needs no marketplace. The
   manifest and hook are written once; only the installer call site changes.

## Not doing

- Submitting to the universal plugin directory. That is a distribution decision
  for a package with public reach, not a step in a CLI installer.
- An MCP server for the rewrite. The hook already does it with no process
  standing up.
