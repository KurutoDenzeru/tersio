#!/bin/sh
# Tersio installer: bootstraps the global CLI, then runs the main
# `tersio install` (Combo preset menu) in the same pass. Usage:
#   curl -fsSL https://github.com/KurutoDenzeru/tersio/releases/latest/download/install.sh | sh
# Extra flags are forwarded: curl ... | sh -s -- --dry-run
#
# Package-manager routing (mirrors oh-my-pi's install.sh):
#   default        bun when available (reads the npm registry), else npm
#   --bun          force the bun lane
#   --npm          force the npm lane
#   --ref <ref>    install a tag/branch/commit from a git clone instead of the
#                  registry (needs git); pairs with either lane
#   -r <ref>       shorthand for --ref
set -eu

REPO="KurutoDenzeru/tersio"
PACKAGE="@krtclcdy/tersio"
MODE=""
REF=""
ARGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --bun) MODE="bun"; shift ;;
    --npm) MODE="npm"; shift ;;
    --ref|-r)
      shift
      if [ -z "${1:-}" ]; then echo "tersio installer: missing value for --ref" >&2; exit 1; fi
      REF="$1"; shift ;;
    --ref=*) REF="${1#*=}"; if [ -z "$REF" ]; then echo "tersio installer: missing value for --ref" >&2; exit 1; fi; shift ;;
    *) ARGS="$ARGS $1"; shift ;;
  esac
done
# shellcheck disable=SC2086
set -- $ARGS

has_bun() { command -v bun >/dev/null 2>&1; }
has_npm() { command -v npm >/dev/null 2>&1; }

install_from_ref() {
  mgr="$1"
  if ! command -v git >/dev/null 2>&1; then
    echo "tersio installer: git is required for --ref" >&2
    exit 1
  fi
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  if git clone --depth 1 --branch "$REF" "https://github.com/${REPO}.git" "$TMP_DIR" >/dev/null 2>&1; then
    :
  else
    git clone "https://github.com/${REPO}.git" "$TMP_DIR"
    (cd "$TMP_DIR" && git checkout "$REF")
  fi
  echo "Installing tersio $REF from source via $mgr..."
  if [ "$mgr" = "bun" ]; then
    bun install -g "$TMP_DIR"
  else
    npm install -g "$TMP_DIR" --no-audit --no-fund
  fi
}

install_via_bun() {
  if [ -n "$REF" ]; then install_from_ref bun; return; fi
  echo "Installing @krtclcdy/tersio via bun..."
  bun install -g "$PACKAGE@latest"
}

install_via_npm() {
  if [ -n "$REF" ]; then install_from_ref npm; return; fi
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
}

case "$MODE" in
  bun)
    has_bun || { echo "tersio installer: bun not found — install it first (https://bun.sh)" >&2; exit 1; }
    install_via_bun
    ;;
  npm)
    has_npm || { echo "tersio installer: npm not found — install Node.js 20.12+ first (https://nodejs.org)" >&2; exit 1; }
    install_via_npm
    ;;
  *)
    if has_bun; then
      install_via_bun
    elif has_npm; then
      install_via_npm
    else
      echo "tersio installer: neither bun nor npm found — install bun (https://bun.sh) or Node.js 20.12+ (https://nodejs.org)" >&2
      exit 1
    fi
    ;;
esac

LANE="npm"
case "$MODE" in
  bun) LANE="bun" ;;
  npm) LANE="npm" ;;
  *) has_bun && LANE="bun" ;;
esac

# The global bin dir may not be on PATH yet in the current shell. The npm
# lane prefers the just-installed prefix binary over any stale tersio already
# on PATH; the bun lane uses whatever tersio resolves.
if [ "$LANE" = "npm" ] && has_npm; then
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
elif command -v tersio >/dev/null 2>&1; then
  TERSIO="tersio"
else
  echo "tersio installer: installed, but tersio is not on PATH yet." >&2
  echo "Open a new shell, then run: tersio install" >&2
  exit 1
fi

echo
echo "Running the main installer..."
# A broken payload crashes on boot — smoke-check before `tersio install` runs.
"$TERSIO" --version >/dev/null 2>&1 || {
  echo "tersio installer: the installed tersio failed its smoke check (--version)." >&2
  echo "The release payload may be broken — retry once fixed, or pin a known-good version:" >&2
  echo "  npm install -g @krtclcdy/tersio@latest --no-audit --no-fund" >&2
  exit 1
}
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
  echo "  Non-interactive shell: user-level install."
  "$TERSIO" install --yes "$@"
fi
