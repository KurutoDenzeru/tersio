---
name: caveman
description: Set or show Tersio Caveman in Codex. Use with a level such as `$caveman lite`.
---

# Tersio Caveman

Read the text after `$caveman` as the requested level. Empty text or `status` means read the current state.

Call `tersio_modes` with `host: "codex"` and `caveman` set to `off`, `lite`, `full`, `ultra`, `megacave-lite`, `megacave-full`, or `megacave-ultra`. If MCP is unavailable, run `tersio modes caveman <level> --host codex`.

Report the saved value or the command result verbatim.
