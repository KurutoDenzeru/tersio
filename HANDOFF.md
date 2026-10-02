# HANDOFF — Agent-neutral plugin pivot

Status: Tersio runs only on **pi** and **omp** today. Goal: also support **OpenCode, Claude Code, Codex** without forking the mode logic.

## What is already neutral

- Mode rules/text: `extensions/caveman-session/rule.md`, ponytail instructions via `@dietrichgebert/ponytail`, RTK via upstream `rtk.ts`.
- State: `extensions/shared/session-state.ts` (`Symbol.for` bridge, session entries, `reconcileSharedComboEntries`), `/combo` presets, `/tersio` command, usage ledger, dashboard. None of these import pi/omp concretely once `ExtensionApi`/`SessionEntry` types are respected.
- `extensions/shared/types.ts` is the single extension-API shape consumed by all mode extensions.

## What is host-bound

- `extensions/shared/host.ts` — `injectPromptText`, `onHostEvent`, `hostSelect`, `isPiHost` branches.
- `cli/hosts.ts`, `cli/install.ts` — paths under `~/.omp/agent` vs `~/.pi/agent`, config.yml/rtk wiring, manifest handling.
- `package.json` `omp` manifest and the pi install step (`npm:@dietrichgebert/ponytail`, copied extension tree).

## Plan

1. Replace `isPiHost`-style branching inside `host.ts` helpers with a small adapter interface (start from `ExtensionApi` in `types.ts`). Two implementations today (pi, omp) behind one lookup.
2. Grow `cli/hosts.ts` into the registry: `getHostAdapter(env)` → { installPaths, wireConfig(rtkExtensionPath), registerExtensions(list) }. `install`, `doctor`, `update` delegate.
3. Keep mode extensions importing only `types.ts`; no new `pi`/`omp` specifics in `caveman-session`/`rtk-session`/`combo-toggle`.
4. Per agent: provide one thin extension/hook file that maps that agent's hook API onto the adapter. Prompt text, presets, and persistence stay shared.
   - OpenCode: `experimental.chat.system.transform` for instruction injection; plugin entry for commands.
   - Claude Code: SessionStart/UserPromptSubmit hooks with `additionalContext`.
   - Codex: config/instructions injection; command entrypoints per host CLI.
5. Keep `BENCHMARK.md` protocol host-neutral (`<host>` placeholders already there). Each new adapter should rerun the relevant surface checks.

## Invariants to preserve

- Caveman injects the full upstream `rule.md`; only the level header changes.
- On pi, the upstream Ponytail pi-extension is the only prompt injector; Tersio persists `ponytail-mode` entries. On omp, `combo-toggle` injects the exact upstream `getPonytailInstructions` output.
- RTK output compression is the upstream `rtk` binary + `rtk.ts` hook; Tersio only toggles it (`RTK_DISABLED` honored by upstream) and registers `rtk_run`.
- `/ai-addons update ponytail` = npm tarball + sha1 + backup/rollback.
