#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${GALCODE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/galcode"

# Find node: prefer bundled macOS binary, fall back to system
if [[ -x "$ROOT_DIR/tools/bin/node" ]]; then
  NODE="$ROOT_DIR/tools/bin/node"
  NODE_PATH='export PATH="$ROOT_DIR/tools/bin:$PATH"'
elif command -v node &>/dev/null; then
  NODE="$(command -v node)"
  NODE_PATH=""
else
  echo "============================================="
  echo " Node.js not found."
  echo " macOS:  brew install node"
  echo " Linux:  sudo apt install nodejs npm"
  echo " Or download from https://nodejs.org"
  echo "============================================="
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod +x "$ROOT_DIR/galcode" "$ROOT_DIR/bin/galcode.js" 2>/dev/null || true

cat > "$TARGET" <<ENDSCRIPT
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$ROOT_DIR"
$NODE_PATH
exec "$NODE" "\$ROOT_DIR/bin/galcode.js" "\$@"
ENDSCRIPT
chmod +x "$TARGET"

echo "Galcode installed: $TARGET"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add to your shell profile:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "Run: galcode --help"
fi
