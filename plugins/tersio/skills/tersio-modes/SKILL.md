---
name: tersio-modes
description: Read or change Tersio's session-start modes and local usage stats in Codex. Use when the user asks for Caveman, Ponytail, pstack, Combo, token usage, session history, or Tersio status.
---

# Tersio modes

Use Tersio's MCP tools instead of editing `~/.tersio/settings.json`.
The `combo`, `caveman`, `ponytail`, `pstack`, `rtk`, and `tersio` skills are the discoverable per-command shortcuts in Codex.

1. Call `tersio_modes` with no arguments to show the current defaults.
2. To change a mode, pass exactly one of:
   - `combo`: `off`, `lite`, `balanced`, or `max`
   - `caveman`: `off`, `lite`, `full`, `ultra`, `megacave-lite`, `megacave-full`, or `megacave-ultra`
   - `ponytail`: `off`, `lite`, `full`, or `ultra`
   - `pstack`: `on` or `off`
3. Pass `host: "codex"` when the user wants the change scoped to Codex only.
4. Call `tersio_stats` for usage, `tersio_sessions` for recent sessions, or `tersio_activity` for recent Tersio changes.

In Codex v1, RTK and Headroom are not wired by the Tersio plugin. Say that plainly instead of claiming either mode changes Codex traffic.
