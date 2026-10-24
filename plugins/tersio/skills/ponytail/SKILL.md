---
name: tersio-ponytail
description: Use when the user wants to set Ponytail code leanliness (lite, full, ultra). Removes unnecessary features, options, and abstractions.
---

# Tersio Ponytail

Set one of these levels for minimal correct code:
- `off`: no lean mode
- `lite`: remove obvious noise, keep readability
- `full`: YAGNI; shortest diff that works
- `ultra`: extreme minimalism; delete or reuse before adding

**How to use:** Call the `tersio_modes` MCP tool with the `ponytail` argument:
```json
{
  "name": "tersio_modes",
  "arguments": { "ponytail": "full" }
}
```

This changes session-start defaults only. Current sessions continue with existing modes until restart.

The response states the new level and confirms that defaults were saved to `~/.tersio/settings.json`.
