# Handoff — Tersio add-on install state on OMP

Status: **no live fault**. Every add-on works. One install-tree drift and one open risk remain.

Date: 2026-10-10. Host: darwin 25.6.0 arm64. OMP 18.8.7. Tersio 2.25.4 (installed).

## What works, with the check that proves it

| Add-on | State | Proof |
|---|---|---|
| Tersio CLI | working | `bun run build` 428ms, 412 tests over 57 files, `tersio dashboard` served port 3915 |
| RTK | working | `rtk 0.51.0` at `~/.bun/bin/rtk`. `[retriever] mode = "tee"`, `tee_max_files = 20`. `xd://rtk_run` with `{"args":["ls","<dir>"]}` returned a condensed list plus `... (124 more)` and a tee-log pointer. A tee log lands per proxied call. |
| Ponytail | working | Prompt carries `🦥 PONYTAIL MODE ACTIVE — level: ultra`, the exact string `extensions/combo-toggle/index.ts:42` builds. Package at `~/.omp/plugins/node_modules/@dietrichgebert/ponytail`. |
| Caveman | working | Prompt carries `extensions/caveman-session/rule-ultra.md` verbatim (`Payload only`, `Never cut: code, commands, paths, API names, error strings`). `caveman-session/index.ts:12` maps `ultra` to that file. |

RTK compaction covers proxied command forms only: `ls`, `find`, `tree`, `git`, `grep`, `gh`. A plain pipeline such as `printf | awk` returns full output. This is by design, not a fault. `cfg://rtk` returns `Unknown setting` because RTK is not an omp cfg namespace.

## The install drift

`~/.omp/agent/extensions/` holds 7 directories: `ai-addons-updater`, `combo-toggle`, `lib`, `rtk-filter`, `rtk-session`, `shared`, `tersio-commands`. It has no `caveman-session`.

`README.md:170` documents the OMP install path as
`~/.omp/agent/extensions/{caveman-session,rtk-session,combo-toggle,tersio-commands,ai-addons-updater}/`.
The documented tree and the actual tree disagree.

The live code does not run from the agent tree. The OMP plugin manifest at
`~/.omp/plugins/node_modules/@krtclcdy/tersio/package.json` declares `omp.extensions` as
`caveman-session`, `rtk-session`, `rtk-filter`, `combo-toggle`, `tersio-commands`.
Those five load from the plugin tree. The caveman rules sit beside them:

```
~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/caveman-session/
  index.ts 5.5K   rule.md 5.9K   rule-ultra.md 2.5K   rule-megacave.md 2.8K
  rule-ultra.md.bak 2.2K   rule-megacave.md.bak 2.6K
```

`docs/ARCHITECTURE.md:110` already calls the agent copy retired:
"Doctor and updater inspect that installed plugin path, not the retired agent copy."
So the drift is a doc and install-script drift, not a runtime fault.

The published manifest drops `ai-addons-updater` from `omp.extensions`, though the repo
`package.json:47` lists it. The updater still runs because `tersio-commands/index.ts:12`
imports `checkAddonsSummary` and `runAddonUpdate` from `../ai-addons-updater/index.ts`
directly. The updater therefore executes from the plugin tree, and its
`EXTENSION_DIR` resolves to the plugin dir, so `cavemanRule()` at
`ai-addons-updater/index.ts:35` lands on the existing plugin-tree rules. Correct today,
but it rides on an unpublished manifest entry plus a relative import.

## Open risk

If omp auto-discovers `<agent-dir>/extensions` in addition to the plugin manifest, the
byte-identical agent-tree copy of `ai-addons-updater/index.ts` also registers `/ai-addons`.
That copy resolves `cavemanRule()` to `~/.omp/agent/extensions/caveman-session/`, which does
not exist, so `/ai-addons update caveman` from that copy would write to a missing tree or fail.

Settle it with:

```
grep -n "caveman\|registerCommand" ~/.omp/agent/extensions/tersio-commands/index.ts
tersio doctor --extensions    # or the equivalent doctor probe that lists loaded extension paths
```

If the agent tree is not loaded, close this item by fixing `README.md:170` and the installer
so the documented OMP path names the plugin tree. If it is loaded, either copy
`caveman-session` into the agent tree during install, or make `ai-addons-updater` resolve the
plugin tree rather than its own directory.

## Verification performed, with no changes made

- `bun run build` and `bun run test` at repo root.
- `shasum` on both `ai-addons-updater/index.ts` copies: identical,
  `edb42b1d40b8b5e71706e2c7f35b5a1c2ff72fa1`.
- `ls -la` on both extension trees, the plugin caveman-session directory, and the ponytail package.
- Read of `~/.omp/plugins/node_modules/@krtclcdy/tersio/package.json:31-41` for the manifest list.
- `xd://rtk_run` with a valid `args` payload to confirm compaction and tee logging.

No files were edited. Nothing was committed. `/ai-addons` was not executed, so no add-on was
re-downloaded or rewritten.
