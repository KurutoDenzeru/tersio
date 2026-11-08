---
description: Set or show Tersio Caveman for Codex
argument-hint: <off|lite|full|ultra|megacave-lite|megacave-full|megacave-ultra|status>
---

<!-- tersio-managed prompt -->
If `$ARGUMENTS` is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the Caveman value.
Otherwise call `tersio_modes` with `host: "codex"` and `caveman: "$1"`, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes caveman "$1" --host codex` in the shell instead.
