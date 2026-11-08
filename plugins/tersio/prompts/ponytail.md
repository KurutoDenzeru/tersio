---
description: Set or show Tersio Ponytail for Codex
argument-hint: <off|lite|full|ultra|status>
---

<!-- tersio-managed prompt -->
If `$ARGUMENTS` is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the Ponytail value.
Otherwise call `tersio_modes` with `host: "codex"` and `ponytail: "$1"`, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes ponytail "$1" --host codex` in the shell instead.
