---
name: tersio-caveman
description: Use when the user wants to set or check Caveman reply length (lite, full, ultra, megacave-lite, megacave-full, megacave-ultra). Makes replies terse and direct.
---

# Tersio Caveman

Set one of these levels for shorter AI replies:
- `off`: disables terse mode
- `lite`: minimal filler, keeps core explanations
- `full`: no greetings, hedges, or recaps; answer first
- `ultra`: extreme brevity while preserving exact commands and errors
- `megacave-lite`, `megacave-full`, `megacave-ultra`: specialized variants

**How to use:** Call the `tersio_modes` MCP tool with the `caveman` argument:
```json
{
  "name": "tersio_modes",
  "arguments": { "caveman": "full" }
}
```

This changes session-start defaults only. Current sessions continue with existing modes until restart.

The response states the new level and confirms that defaults were saved to `~/.tersio/settings.json`.
