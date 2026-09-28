# Tersio — files per host

What `tersio install` writes for each host, and whether it is on this machine right
now. Paths come from the same lists the installer and the uninstaller use, so a
row cannot appear here unless the tool would touch it. `~` is your home directory.

Two hosts are supported: Oh My Pi and Pi. Both are extension-tree hosts — the
modes arrive from a live extension that injects them every turn, and the shell
rewrite is rtk's own module. Neither writes a rules file or a skills directory.

---

## Flow

### `tersio install`

1. Ask which agent. Nothing is written or fetched before it is answered.
2. Download the rtk binary — both consumers of it come after.
3. Per host: clear anything a previous version wrote and this one no longer does, then hand rtk the rewrite.
4. Pi's extension tree, and the Oh My Pi layer when it is in scope: the plugin registration, Ponytail, the mode extensions, the updater, rtk's wiring.

### `tersio uninstall`

1. Ask which agent, from those with something on disk.
2. Print the plan, then confirm, defaulting to No.
3. Remove each host's layer directories and rtk wiring, then the earlier-release paths, reporting anything kept because your own content is still in it.

---

## Oh My Pi (OMP) · `--agent omp`

**Rewrite:** rtk-owned extension (`rtk init -g --agent omp`)

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
| dir | `~/.omp/agent/extensions/aaa-combo-boot` | retired, removed but never installed | no |
| file | `~/.omp/agent/extensions/rtk.ts` | rtk-owned | yes |

---

## Pi · `--agent pi`

**Rewrite:** rtk-owned extension (`rtk init -g --agent pi`), plus the tree

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

## Retired paths

Written by an earlier release, listed here because `tersio install` and
`tersio uninstall` both clear them. Only the marked block comes out of a merged
file, so your own text survives.

| Kind | Path | Note | On this machine |
|---|---|---|---|
| merged | `~/.omp/agent/AGENTS.md` | our marked block only | yes |
| dir | `~/.omp/agent/skills/tersio-{caveman,ponytail,rtk}` | ours outright | no |
| merged | `~/.pi/agent/AGENTS.md` | our marked block only | yes |
| dir | `~/.pi/agent/skills/tersio-{caveman,ponytail,rtk}` | ours outright | no |

---

## Shared across hosts

| Path | What |
|---|---|
| `~/.bun/bin/rtk` | the rtk binary, shared by every host. |
| `~/.tersio/settings.json` | session-start defaults: combo, caveman, rtk, ponytail. |
| `~/.tersio/agents.json` | the `--agent` selection. |
| `~/.tersio/usage.db` | token and cost ledger. |
