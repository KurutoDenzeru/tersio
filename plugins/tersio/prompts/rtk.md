---
description: Set the stored Tersio RTK preference for Codex
argument-hint: <on|off|status>
---

<!-- tersio-managed prompt -->
Treat the text after this prompt as the requested value. If it is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the RTK value.
Otherwise call `tersio_modes` with `host: "codex"` and `rtk` set to that value, then report the result verbatim.
Codex does not currently rewrite Bash through Tersio's RTK mode, so say the preference is stored but RTK rewriting is unavailable on this host.
If the MCP tool is unavailable, run `tersio modes rtk <on|off> --host codex` in the shell instead.
