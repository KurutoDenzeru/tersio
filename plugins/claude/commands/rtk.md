---
description: Set the stored Tersio RTK preference - on, off
argument-hint: [on|off]
allowed-tools: Bash(tersio modes:*)
---

Run `tersio modes rtk $ARGUMENTS --host claude` and report its line verbatim.

Then say Claude Code rewrites eligible Bash calls through the `rtk hook claude` PreToolUse hook. Turning RTK off removes that hook from `~/.claude/settings.json`; turning it on restores it.
