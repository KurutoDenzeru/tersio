#!/bin/sh
# Tersio installer: bootstraps the global npm CLI, then runs the main
# `tersio install` (scope + Combo preset menus) in the same pass. Usage:
#   curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
# Extra flags are forwarded: curl ... | sh -s -- --dry-run --scope both
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "tersio installer: npm not found — install Node.js 20.12+ first (https://nodejs.org)" >&2
  exit 1
fi

# Source preference: the GitHub release tarball built by CI per tag, falling
# back to the npm registry (same package, same integrity checks). Override the
# source with TERSIO_TARBALL_URL when needed.
TARBALL_URL="${TERSIO_TARBALL_URL:-https://github.com/KurutoDenzeru/tersio/releases/latest/download/tersio-npm.tgz}"
TARBALL="$(mktemp -d)/tersio-npm.tgz"
if curl -fsSL "$TARBALL_URL" -o "$TARBALL" 2>/dev/null && [ -s "$TARBALL" ]; then
  echo "Installing tersio from the GitHub release tarball..."
  npm install -g "$TARBALL" --no-audit --no-fund
else
  echo "Installing @krtclcdy/tersio via npm..."
  npm install -g @krtclcdy/tersio@latest --no-audit --no-fund
fi

# The npm global bin dir may not be on PATH yet in the current shell.
GLOBAL_BIN="$(npm prefix -g 2>/dev/null)/bin"
if [ -x "$GLOBAL_BIN/tersio" ]; then
  TERSIO="$GLOBAL_BIN/tersio"
elif command -v tersio >/dev/null 2>&1; then
  TERSIO="tersio"
else
  echo "tersio installer: installed, but tersio is not on PATH yet." >&2
  echo "Open a new shell, then run: tersio install" >&2
  exit 1
fi

echo
echo "Running the main installer..."
# Interactive shells get the scope + Combo preset menus; piped installs read
# the prompts from the controlling terminal when one can be opened (the
# subshell probe matters: dash aborts the whole script when a special builtin
# like `:` hits a failed redirection, and CI runners expose /dev/tty as a
# device node that cannot be opened). Fully non-interactive shells fall back
# to the user-scope defaults.
if [ -t 0 ]; then
  exec "$TERSIO" install "$@"
elif ( exec < /dev/tty ) 2>/dev/null; then
  "$TERSIO" install "$@" < /dev/tty
else
  echo "  Non-interactive shell: defaulting to user-level install."
  "$TERSIO" install --scope user --yes "$@"
fi
