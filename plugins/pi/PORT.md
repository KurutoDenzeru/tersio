# Pi port

**Complete.** Pi was the second host to get a live extension tree, and it is the
only one that loads TypeScript directly — `~/.pi/agent/extensions/<dir>/index.ts`
through jiti, no build step.

Reference: <https://pi.dev/docs/latest/extensions>.

## What ships

The same seven directories as the OMP port — five extensions plus `shared/` and
`lib/` — under `~/.pi/agent/extensions/`. `/caveman`, `/rtk`, `/ponytail`,
`/combo`, `/tersio` and `/ai-addons` switch mid-session and inject into every
turn. `AGENTS.md` and the skills are the frozen fallback.

rtk's own `rtk.ts` is **not** ours: `rtk init -g --agent pi` writes it, rtk owns
the format, and uninstall leaves it alone.

## Where it diverges from the OMP port, and why

The two ports share the mode text and the state machine. They do not share the
modules, because Pi's ExtensionAPI differs in five places that matter:

| OMP | Pi | Why it matters |
|---|---|---|
| return a replacement `systemPrompt` | write `event.systemPromptOptions.sections` | Pi's prompt is rendered and read-only; injection is a section write, and each mode owns one **sealed** section so two extensions cannot overwrite each other |
| `pi.zod` schema helpers | plain JSON-Schema object | the tree must load with no `node_modules` in the config dir |
| return `{isError}` on a failed tool | throw | returning `isError` is not Pi's failure contract |
| `session_branch` event | `session_start` + `session_tree` | `pi.cwd` and `session_branch` do not exist, so restore hangs off the two that fire when the active conversation changes |
| `pi.setLabel` | dropped | Pi's `setLabel(entryId, label)` names a *session entry* for bookmarks; it has no "name this extension" equivalent |

`extensions/shared/omp-prompt.ts` isolates the one place the hosts genuinely
disagree about prompt shape, so the host-agnostic session state stays neutral and
one file owns the difference.

## Source

`extensions/pi/` in this repo, not moved under `plugins/` — the installer
resolves those paths and a move buys no functionality.
