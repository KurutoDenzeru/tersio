#!/bin/sh
# Tersio quick installer: bootstraps the global npm CLI, then points at
# `tersio install`. Usage:
#   curl -fsSL https://raw.githubusercontent.com/KurutoDenzeru/tersio/main/install.sh | sh
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "tersio installer: npm not found — install Node.js 18+ first (https://nodejs.org)" >&2
  exit 1
fi

echo "Installing @krtclcdy/tersio via npm..."
npm install -g @krtclcdy/tersio@latest --no-audit --no-fund

echo
echo "Installed. Finish setup inside your OMP environment:"
echo "  tersio install"
