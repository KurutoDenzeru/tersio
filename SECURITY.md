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

Tersio fetches two things from the network during install:

| What | From | Verified by |
|---|---|---|
| `install.sh` | this repo's GitHub Release, `releases/latest/download/install.sh` | HTTPS to `github.com` |
| the `rtk` binary | the `rtk-ai/rtk` GitHub Release | SHA-256 against that release's `checksums.txt` |
| the `ponytail` package | the npm registry | npm's integrity check on the published tarball |

### Checksum verification fails closed

An RTK binary runs with your privileges, so a download that cannot be verified is not installed. If `checksums.txt` is missing, has no entry for the asset, or the hash does not match, the install stops and says why.

That rule applies on all three paths that install RTK: `tersio install`, `tersio doctor --fix`, and `/ai-addons update rtk`.

To accept an unverified binary — only sensible on an air-gapped machine — pass `--allow-unverified`. The install then says so in its output.

Upstream publishes `checksums.txt` alongside the binary in the same release, so this confirms the download did not change in transit — not that upstream's release was not compromised. It raises the cost of a tampered mirror or a corrupted transfer.

## Data

Nothing you use leaves your machine. The usage ledger, price cache, and settings live in `~/.tersio/`. The Dashboard binds to `127.0.0.1` only, so it is not reachable from your network.

The one outbound request Tersio makes on its own is a currency-rate lookup, used to convert spend reports: the Dashboard fetches `https://api.frankfurter.app/latest?from=USD`. It sends no local data.