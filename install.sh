#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${GALCODE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/galcode"

# Find node
if [[ -x "$ROOT_DIR/tools/bin/node" ]]; then
  NODE="$ROOT_DIR/tools/bin/node"
  NODE_PATH='export PATH="$ROOT_DIR/tools/bin:$PATH"'
elif command -v node &>/dev/null; then
  NODE="$(command -v node)"
  NODE_PATH=""
else
  echo "Node.js not found. Install it first:"
  echo "  brew install node          # macOS"
  echo "  sudo apt install nodejs    # Linux"
  exit 1
fi

# Create bin dir
mkdir -p "$BIN_DIR" || { echo "Cannot create $BIN_DIR"; exit 1; }

# Write launcher file
rm -f "$TARGET"
cat > "$TARGET" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$ROOT_DIR"
$NODE_PATH
exec "$NODE" "\$ROOT_DIR/bin/galcode.js" "\$@"
LAUNCHER

chmod +x "$TARGET" "$ROOT_DIR/galcode" "$ROOT_DIR/bin/galcode.js" 2>/dev/null || true

echo "Galcode installed: $TARGET"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add this to your shell config then restart terminal:"
  echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
  echo "  source ~/.zshrc"
else
  echo "Run: galcode --help"
fi
