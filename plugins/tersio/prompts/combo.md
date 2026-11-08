---
description: Set or show the Tersio Combo preset for Codex
argument-hint: <off|lite|balanced|max|status|help>
---

<!-- tersio-managed prompt -->
Treat the text after this prompt as the requested value. If it is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the result.
If the value is `help`, list the presets off, lite, balanced, and max and change nothing.
Otherwise call `tersio_modes` with `host: "codex"` and `combo` set to that value, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes combo <value> --host codex` in the shell instead.
