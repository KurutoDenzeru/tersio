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
## What is stored, and what is not

The ledger in `~/.tersio/usage.db` records, per assistant message: timestamp, model id, token counts, cost, duration, status, and the transcript path it came from. It also keeps a short first line of an error message (180 characters) and the names of tools a turn called.

It never stores prompt text, completion text, file contents, or tool arguments and results.

Paths and labels are personal data when they identify a person, and a home directory often does: `~/.tersio/usage.db` holds absolute transcript paths that include your username. Treat the file as personal data and protect it as such. It is created with mode `0600`; the dashboard binds to loopback only.

## Outbound requests

Tersio runs entirely on your machine. It is not a service, it has no backend, and no account exists to tie data to.

| Request | When | What leaves your machine |
|---|---|---|
| `api.frankfurter.app/latest?from=USD` | A dashboard visit, to convert spend currency | The request itself. No ledger data, no identifiers. |
| `raw.githubusercontent.com/BerriAI/litellm` | A price refresh | The request itself. |
| GitHub Releases, the npm registry | `install`, `update` | Standard HTTP metadata. |
| A remote you configure | Only if you set up Sync and supply a passphrase | A sealed backup, encrypted with your passphrase before it uploads. |

CodeGraph and Headroom are separate upstream projects Tersio binds to. Both are started with their telemetry disabled. Their own network behaviour is theirs, not Tersio's; see their repositories.

## Your obligations

Tersio is distributed software, not a data processor. Because no personal data reaches the maintainers, no data processing agreement is offered or needed, and there is no sub-processor list to publish.

That places the obligations with you, the operator of the machine:

- Under the UK GDPR and the Data Protection Act 2018, you are the controller of the ledger on your disk.
- Under the EU GDPR, likewise, with your employer or client the controller where they own the device.
- Under US state laws such as the CCPA/CPRA, the thresholds apply to a business that collects consumers' personal information. A local tool that reports nothing to its author does not meet them.
- Under Japan's APPI, the duties attach to a business operator handling personal information it has acquired. Nothing is acquired here.
- Under the LGPD (Brazil), PIPL (China), and similar regimes, the same reasoning applies: the data does not leave your device, so the developer is not a handler of it.

A regulated environment, such as health, finance, or the public sector, may impose stricter local rules. That is a decision for your own compliance function.

## Deleting it

The whole store is one directory. Remove `~/.tersio/` and every ledger row, price cache, snapshot, and setting is gone. Nothing needs to be requested from anyone.
