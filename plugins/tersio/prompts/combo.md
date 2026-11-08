---
description: Set or show the Tersio Combo preset for Codex
argument-hint: <off|lite|balanced|max|status|help>
---

<!-- tersio-managed prompt -->
If `$ARGUMENTS` is empty or `status`, call the `tersio_modes` MCP tool with `host: "codex"` and report the result.
If `$ARGUMENTS` is `help`, list the presets off, lite, balanced, and max and change nothing.
Otherwise call `tersio_modes` with `host: "codex"` and `combo: "$1"`, then report the result verbatim.
If the MCP tool is unavailable, run `tersio modes combo "$1" --host codex` in the shell instead.
