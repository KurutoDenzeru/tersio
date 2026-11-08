---
name: combo
description: Set or show Tersio Combo in Codex. Use with a level such as `$combo lite`.
---

# Tersio Combo

Read the text after `$combo` as the requested level. Empty text or `status` means read the current state.

1. Call `tersio_modes` with `host: "codex"` and no mode fields to show the current defaults.
2. To change it, call `tersio_modes` with `host: "codex"` and `combo` set to `off`, `lite`, `balanced`, or `max`.
3. If MCP is unavailable, run `tersio modes combo <level> --host codex`.

Report the saved value or the command result verbatim.
