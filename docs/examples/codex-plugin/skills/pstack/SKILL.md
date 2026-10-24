---
name: tersio-pstack
description: Use when the user wants to enable pstack rigor mode. Applies design principles at each decision point with an approach, check, and design.
---

# Tersio PStack

Toggle pstack rigor mode (opt-in):
- `off`: normal mode; no design enforcement
- `on`: rigorous approach with design principles active

pstack applies a consistent methodology at decision points: it states the approach, runs a checklist, and makes explicit design choices. This is separate from Combo presets; use `/tersio-combo` or other modes independently.

**How to use:** Call the `tersio_modes` MCP tool with the `pstack` argument:
```json
{
  "name": "tersio_modes",
  "arguments": { "pstack": "on" }
}
```

This changes session-start defaults only. Current sessions continue with existing modes until restart.

The response states the new state (`on` or `off`) and confirms that defaults were saved to `~/.tersio/settings.json`.
