---
description: Set or show Tersio Ponytail for Codex
argument-hint: <off|lite|full|ultra|status>
---

<!-- tersio-managed prompt -->
Treat the text after this prompt as the requested level. If it is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the Ponytail value.
Otherwise call `tersio_modes` with `host: "codex"` and `ponytail` set to that level, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes ponytail <level> --host codex` in the shell instead.
