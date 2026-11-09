---
name: ponytail
description: Set or show Tersio Ponytail in Codex. Use with a level such as `$ponytail full`.
---

# Tersio Ponytail

Read the text after `$ponytail` as the requested level. Empty text or `status` means read the current state.

Call `tersio_modes` with `host: "codex"` and `ponytail` set to `off`, `lite`, `full`, or `ultra`. If MCP is unavailable, run `tersio modes ponytail <level> --host codex`.

Report the saved value or the command result verbatim.
