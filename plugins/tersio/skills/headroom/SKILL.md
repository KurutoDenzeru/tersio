---
name: headroom
description: Set or show Tersio's stored Headroom preference in Codex.
---

# Tersio Headroom

Read the text after `$headroom` as the requested value. Empty text or `status` means read the current state.

Call `tersio_modes` with `host: "codex"` and `headroom` set to `on` or `off`. If MCP is unavailable, run `tersio modes headroom <on|off> --host codex`.

The stored preference is what the next install and the dashboard switch read. Moving the endpoint itself needs the proxy running, so say the preference is saved and the route is applied from the dashboard.
