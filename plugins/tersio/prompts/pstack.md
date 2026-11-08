---
description: Set or show Tersio pstack for Codex
argument-hint: <on|off|status>
---

<!-- tersio-managed prompt -->
Treat the text after this prompt as the requested value. If it is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the pstack value.
Otherwise call `tersio_modes` with `host: "codex"` and `pstack` set to that value, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes pstack <on|off> --host codex` in the shell instead.
