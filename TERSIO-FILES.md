# Tersio — files per host

What `tersio install` writes for each host, and whether it is on this machine right
now. Paths come from the same planner the installer and the uninstaller call, so a
row cannot appear here unless the tool would touch it. `~` is your home directory.

---

## Flow

### `tersio install`

1. Ask which agent. Nothing is written or fetched before it is answered.
2. Download the rtk binary — both consumers of it come after.
3. Per host: write the rows below that are not on disk, then clear anything a previous version wrote and this one no longer does.
4. The Oh My Pi layer, when it is in scope: the extension tree, the plugin registration, Ponytail, the mode extensions, the updater, rtk's wiring.

### `tersio uninstall`

1. Ask which agent, from those with something on disk.
2. Print the plan, then confirm, defaulting to No.
3. Remove the layer directories, then each host's files, reporting anything kept because your own content is still in it.

---

## Oh My Pi (OMP) · `--agent omp`

**Rewrite:** rtk-owned extension (rtk init -g --agent omp)

**Modes:** live — `/caveman` `/rtk` `/ponytail` and `/combo` switch mid-session, and the mode text loads itself

| Kind | Path | Note | On this machine |
|---|---|---|---|
| dir | `~/.omp/agent/extensions/caveman-session` | tersio extension tree | no |
| dir | `~/.omp/agent/extensions/rtk-session` | tersio extension tree | yes |
| dir | `~/.omp/agent/extensions/ai-addons-updater` | tersio extension tree | yes |
| dir | `~/.omp/agent/extensions/combo-toggle` | tersio extension tree | yes |
| dir | `~/.omp/agent/extensions/tersio-commands` | tersio extension tree | yes |
| dir | `~/.omp/agent/extensions/shared` | tersio extension tree | yes |
| dir | `~/.omp/agent/extensions/lib` | tersio extension tree | yes |
| dir | `~/.omp/agent/extensions/aaa-combo-boot` | tersio extension tree | no |
| file | `~/.omp/agent/extensions/rtk.ts` | rtk-owned | yes |

---

## Pi · `--agent pi`

**Rewrite:** rtk-owned extension (rtk init -g --agent pi), plus the tree

**Modes:** live — `/caveman` `/rtk` `/ponytail` and `/combo` switch mid-session, and the mode text loads itself

| Kind | Path | Note | On this machine |
|---|---|---|---|
| dir | `~/.pi/agent/extensions/caveman-session` | tersio extension tree | yes |
| dir | `~/.pi/agent/extensions/rtk-session` | tersio extension tree | yes |
| dir | `~/.pi/agent/extensions/ai-addons-updater` | tersio extension tree | yes |
| dir | `~/.pi/agent/extensions/combo-toggle` | tersio extension tree | yes |
| dir | `~/.pi/agent/extensions/tersio-commands` | tersio extension tree | yes |
| dir | `~/.pi/agent/extensions/shared` | tersio extension tree | yes |
| dir | `~/.pi/agent/extensions/lib` | tersio extension tree | yes |
| file | `~/.pi/agent/extensions/rtk.ts` | rtk-owned | yes |

---

## Claude Code · `--agent claude-code`

**Rewrite:** generated hook (tersio writes the rewriter)

**Modes:** static — read once per session; no mid-session switch

| Kind | Path | Note | On this machine |
|---|---|---|---|
| skill | `~/.claude/skills/tersio-caveman/` |  | no |
| skill | `~/.claude/skills/tersio-ponytail/` |  | no |
| skill | `~/.claude/skills/tersio-rtk/` |  | no |
| hook-script | `~/.claude/tersio-rtk-rewrite.mjs` |  | no |
| hook-config | `~/.claude/settings.json` |  | yes |

---

## OpenAI Codex · `--agent codex`

**Rewrite:** generated hook (tersio writes the rewriter)

**Modes:** static — read once per session; no mid-session switch

| Kind | Path | Note | On this machine |
|---|---|---|---|
| skill | `~/.agents/skills/tersio-caveman/` |  | no |
| skill | `~/.agents/skills/tersio-ponytail/` |  | no |
| skill | `~/.agents/skills/tersio-rtk/` |  | no |
| hook-script | `~/.codex/tersio-rtk-rewrite.mjs` |  | no |
| hook-config | `~/.codex/hooks.json` |  | yes |

---

## OpenCode · `--agent opencode`

**Rewrite:** tersio plugin, v2 shape (rtk's own is pre-v2 and refused)

**Modes:** live — `/caveman` `/rtk` `/ponytail` and `/combo` switch mid-session, install-wide rather than per session, and the mode text loads itself

| Kind | Path | Note | On this machine |
|---|---|---|---|
| skill | `~/.config/opencode/skills/tersio-caveman/` |  | no |
| skill | `~/.config/opencode/skills/tersio-ponytail/` |  | no |
| skill | `~/.config/opencode/skills/tersio-rtk/` |  | no |
| file | `~/.config/opencode/plugins/tersio.ts` | tersio plugin, v2 shape | no |

---

## Shared across hosts

| Path | What |
|---|---|
| `~/.agents/skills/tersio-{caveman,ponytail,rtk}/SKILL.md` | the Agent Skills root. Codex writes it; Pi and OpenCode also read it, so removing Codex does not strip Pi of its skills. |
| `~/.bun/bin/rtk` | the rtk binary, shared by every host. |
| `~/.tersio/settings.json` | session-start defaults: combo, caveman, rtk, ponytail. |
| `~/.tersio/agents.json` | the `--agent` selection. |
| `~/.tersio/usage.db` | token and cost ledger.

