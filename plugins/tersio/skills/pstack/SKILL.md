---
name: pstack
description: Set or show Tersio pstack in Codex. Use with `$pstack on`, `$pstack off`, or `$pstack status`.
---

# Tersio pstack

Read the text after `$pstack` as the requested value. Empty text or `status` means read the current state.

Call `tersio_modes` with `host: "codex"` and `pstack` set to `on` or `off`. If MCP is unavailable, run `tersio modes pstack <on|off> --host codex`.

Report the saved value or the command result verbatim.
