---
name: tersio-rtk
description: Use when the user wants to enable or disable RTK condensed shell output. RTK removes noise from command results while keeping every signal.
---

# Tersio RTK

Toggle RTK (Rewrite Token Killer) for compact shell output:
- `off`: no compression; run commands as-is
- `on`: condensed output, all signals kept, costly noise dropped

RTK handles searches (grep, rg), listings (ls, find), reads (cat, head), package runs (bun, npm, pnpm), version control (git, gh), containers (docker, kubectl), cloud CLIs (aws), build tools (maven, gradle), linters (eslint, prettier), and more.

**How to use:** Call the `tersio_modes` MCP tool with the `rtk` argument:
```json
{
  "name": "tersio_modes",
  "arguments": { "rtk": "on" }
}
```

This changes session-start defaults only. Current sessions continue with existing modes until restart.

The response states the new state (`on` or `off`) and confirms that defaults were saved to `~/.tersio/settings.json`.
