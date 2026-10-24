---
name: tersio-combo
description: Use when the user wants to apply a Tersio Combo preset (lite, balanced, max) or check current preset level. Sets caveman, RTK, and Ponytail together.
---

# Tersio Combo

Apply one of these presets to set Caveman, RTK, and Ponytail together:
- `off`: disables all three modes
- `lite`: caveman=lite, rtk=on, ponytail=lite
- `balanced`: caveman=full, rtk=on, ponytail=full
- `max`: caveman=ultra, rtk=on, ponytail=ultra

pstack stays unchanged by any preset; toggle it separately with `/tersio-pstack`.

**How to use:** Call the `tersio_modes` MCP tool with the `combo` argument:
```json
{
  "name": "tersio_modes",
  "arguments": { "combo": "lite" }
}
```

This changes session-start defaults only. Current sessions continue with existing modes until restart.

The response states the new level and lists active modes in shorthand form. It confirms that defaults were saved to `~/.tersio/settings.json`.
