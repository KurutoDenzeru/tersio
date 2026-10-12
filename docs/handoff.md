# Handoff — Tersio add-on install state on OMP

Status: **resolved**. Every add-on works. The install-tree drift and the open risk are closed.

Date: 2026-10-11. Host: darwin 25.6.0 arm64. OMP 18.9.2. Tersio 2.25.4 (installed).

## What works, with the check that proves it

| Add-on | State | Proof |
|---|---|---|
| Tersio CLI | working | `bun run build` 386ms, 411 tests over 58 files, `tersio install --host omp --dry-run --yes` reports its writes |
| RTK | working | `rtk 0.51.0` at `~/.bun/bin/rtk`. The wiring `~/.omp/agent/extensions/rtk.ts` stays in the agent tree, where `config.yml` registers it. |
| Ponytail | working | Prompt carries `🦥 PONYTAIL MODE ACTIVE — level: ultra`. Package at `~/.omp/plugins/node_modules/@dietrichgebert/ponytail`. |
| Caveman | working | Prompt carries the `rule-ultra.md` body verbatim. The rules live only in the plugin tree, which is the copy the manifest loads. |

RTK compaction covers proxied command forms only: `ls`, `find`, `tree`, `git`, `grep`, `gh`. A plain pipeline such as `printf | awk` returns full output. This is by design, not a fault. `cfg://rtk` returns `Unknown setting` because RTK is not an omp cfg namespace.

## How the install loads now

omp merges the plugin manifest with the extension dir it discovers by default (`disableExtensionDiscovery` defaults to `merge`; `--no-extensions` turns discovery off). So one extension file in one place per host:

- OMP mode extensions load from `~/.omp/plugins/node_modules/@krtclcdy/tersio/extensions/`, which `omp.extensions` declares.
- The OMP agent tree keeps only rtk's own `extensions/rtk.ts`, registered by path in `~/.omp/agent/config.yml`.
- pi and OpenCode keep their own trees, unchanged.

`cli/install.ts` now writes every OMP mode extension into the plugin tree and drops the agent-tree copies an older build wrote. The fallback stays: a plugin registration that fails still writes the agent tree, so an offline install loads its add-ons, and that path leaves the retired copies alone.

## The drift, closed

`~/.omp/agent/extensions/` held 7 Tersio directories with no `caveman-session`. Both trees loaded, so five extensions ran twice and the agent-tree `ai-addons-updater` copy could not resolve its rule bodies.

The drop list is `RETIRED_OMP_AGENT_DIRS` in `cli/install.ts`: `caveman-session`, `rtk-session`, `rtk-filter`, `combo-toggle`, `tersio-commands`, `ai-addons-updater`, `shared`, `lib`. `rtk.ts` and every foreign directory stay. Verified on a throwaway home:

- Dry run: reports the removal and writes nothing.
- Real run with the plugin present: the 7 stale directories are gone, `rtk.ts` and a foreign `herdr/` directory survive, `config.yml` is untouched.
- A registration that fails keeps the agent tree as the working fallback.

Docs now name the same layout: `README.md` (host table plus a note on the merge), `INSTALL.md`, and `docs/ARCHITECTURE.md` (the installer node, plus the single-owner invariant). Earlier docs claimed the agent tree; that was the drift.

## The open risk, closed

The retired agent-tree copy resolved `cavemanRule()` to `~/.omp/agent/extensions/caveman-session/`, which never existed. Two changes remove the failure path:

1. `cli/install.ts` deletes that copy, so it stops loading.
2. `extensions/ai-addons-updater/index.ts` resolves each rule from its sibling first and falls back to the OMP plugin install, so a copy without a sibling writes to the tree the manifest actually reads.

`test/extensions/server-sessions.test.ts` fires the hook with the real payload shape, which is what the same mistake taught, and it is unchanged by this fix.

## Verification performed

- `bun run build`, `bun run lint`, `bun run test` at repo root: 58 files, 411 tests, all green.
- `bunx tsc --noEmit` at repo root and in `dashboard/app`: no errors.
- `tersio install --host omp --dry-run --yes --verbose` against a throwaway home: every mode extension writes to the plugin tree, and the retired-copy step reports.
- A throwaway-home smoke run of the real install in three states: fresh, offline, and plugin-registered.
- `omp plugin list` is the runtime command that lists what the host resolved, if a live double load ever needs confirming again.
