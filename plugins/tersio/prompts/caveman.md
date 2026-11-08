---
description: Set or show Tersio Caveman for Codex
argument-hint: <off|lite|full|ultra|megacave-lite|megacave-full|megacave-ultra|status>
---

<!-- tersio-managed prompt -->
Treat the text after this prompt as the requested level. If it is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the Caveman value.
Otherwise call `tersio_modes` with `host: "codex"` and `caveman` set to that level, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes caveman <level> --host codex` in the shell instead.
