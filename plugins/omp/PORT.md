# Oh My Pi port

**Complete.** OMP was the host this project started as, and it is the one host
with a live extension surface rather than static files.

Reference: <https://omp.sh/docs/plugins>.

## What ships

Five extension directories plus `shared/` and `lib/` under
`~/.omp/agent/extensions/`, each an `index.ts` OMP loads through its plugin
mechanism. Tersio itself is registered as a nested plugin at
`~/.omp/plugins/node_modules/@krtclcdy/tersio`, which is what puts it in
**Settings → Plugins**.

| Extension | Does |
|---|---|
| `caveman-session` | terse-reply mode, prompt injection, `/caveman` |
| `rtk-session` | shell output filtering, `/rtk` |
| `combo-toggle` | one command for all three, `/combo` |
| `tersio-commands` | `/tersio`, `/tersio usage`, `/tersio dashboard` |
| `ai-addons-updater` | `/ai-addons` |
| `shared/`, `lib/` | session bridge, usage and pricing store, installer helpers |

Because these are live, modes switch **mid-session** and inject into the next
turn. `AGENTS.md` and the skills are the frozen fallback the same port writes for
the hosts that have no live surface.

## Notes for anyone editing this port

- The combo state is announced **in the conversation**, not the footer. A
  permanent status row cost a line of screen for a value that moves when someone
  types `/combo`. See `extensions/combo-toggle/index.ts`.
- `aaa-combo-boot` is a retired extension, still in the removal list so old
  installs get cleaned. It is never installed.
- Session defaults live in `~/.tersio/settings.json`, not
  `~/.omp/plugins/omp-plugins.lock.json` — the lock file is OMP's, so a host
  that is not OMP could never write the choice Pi then had to read. The lock
  file is still read as a fallback.

## Source

`extensions/` in this repo. Not moved under `plugins/` — the installer, the Pi
tree wiring, and the package `files` allowlist all resolve those paths, and a
move buys no functionality.
