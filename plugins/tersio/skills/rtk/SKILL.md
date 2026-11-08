---
name: rtk
description: Set or show Tersio's stored RTK preference in Codex.
---

# Tersio RTK

Read the text after `$rtk` as the requested value. Empty text or `status` means read the current state.

Call `tersio_modes` with `host: "codex"` and `rtk` set to `on` or `off`. If MCP is unavailable, run `tersio modes rtk <on|off> --host codex`.

Codex v1 does not rewrite Bash through Tersio's RTK integration, so say the preference is stored but RTK rewriting is unavailable on this host.
