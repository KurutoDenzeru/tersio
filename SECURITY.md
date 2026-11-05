# Security Policy

## Supported versions

Only the latest published release receives fixes. Check yours with `tersio version`.

| Version | Supported |
|---|---|
| latest release | yes |
| anything older | no |

## Reporting a vulnerability

Open a [private security advisory](https://github.com/KurutoDenzeru/tersio/security/advisories/new) rather than a public issue.

Include the version, the host you ran on (`omp` or `pi`), the platform, and the steps to reproduce. Please do not include anything that would identify you beyond what the advisory form already collects.

You can expect an acknowledgement within 3 working days and an assessment within 10. If a fix is needed we will agree a disclosure date with you before publishing anything.

## What Tersio downloads, and how it is verified

Tersio fetches one thing from the network during install:

| What | From | Verified by |
|---|---|---|
| `install.sh`, `install.ps1` | this repo's GitHub Release, `releases/latest/download/<file>` | HTTPS to `github.com` |
| the `ponytail` package | the npm registry | npm's integrity check on the published tarball |

Tersio does not download, replace, or delete the `rtk` binary. rtk ships its own installer and its own checksums; Tersio only detects the binary and binds it into an agent with rtk's own `rtk init` command. Install, `doctor --fix`, `uninstall`, and the dashboard therefore never write to a path rtk owns.

## Data

Nothing you use leaves your machine. The usage ledger, price cache, and settings live in `~/.tersio/`. The Dashboard binds to `127.0.0.1` only, so it is not reachable from your network.

The one outbound request Tersio makes on its own is a currency-rate lookup, used to convert spend reports: the Dashboard fetches `https://api.frankfurter.app/latest?from=USD`. It sends no local data.