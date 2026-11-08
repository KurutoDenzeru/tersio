---
description: Show Tersio status, usage, help, update, upstream, or dashboard
argument-hint: <status|help|update [target] [--dry-run]|upstream [--offline]|dashboard>
---

<!-- tersio-managed prompt -->
Treat the text after this prompt as the requested action. For empty text or `status`, call `tersio_modes` and `tersio_stats` with `host: "codex"` where supported, then summarize both.
For `help`, explain `/prompts:combo`, `/prompts:caveman`, `/prompts:ponytail`, `/prompts:pstack`, `/prompts:rtk`, and `/prompts:tersio`.
For `update` or `upstream`, run that command with `--host codex` in the shell and report its output verbatim.
For `dashboard`, run `tersio dashboard` in the shell and report the URL.
