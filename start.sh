#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$ROOT_DIR/tools/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ -x "$ROOT_DIR/tools/bin/node" ]]; then
  NODE="$ROOT_DIR/tools/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  echo "Galcode needs Node.js 20 or newer."
  echo "macOS: brew install node"
  echo "Linux: install nodejs/npm with your package manager or nvm."
  exit 127
fi

exec "$NODE" "$ROOT_DIR/scripts/galcode-bootstrap.mjs" gui "$@"
