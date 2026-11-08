---
description: Set or show Tersio pstack for Codex
argument-hint: <on|off|status>
---

<!-- tersio-managed prompt -->
If `$ARGUMENTS` is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the pstack value.
Otherwise call `tersio_modes` with `host: "codex"` and `pstack: "$1"`, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes pstack "$1" --host codex` in the shell instead.
