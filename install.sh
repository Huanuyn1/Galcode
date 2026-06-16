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
if ! mkdir -p "$BIN_DIR" 2>/dev/null; then
  echo "Cannot create $BIN_DIR"
  exit 1
fi

chmod +x "$ROOT_DIR/galcode" "$ROOT_DIR/bin/galcode.js" 2>/dev/null || true

# Write launcher
cat > "$TARGET" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="__ROOT__"
__NODE_PATH__
exec __NODE__ "$ROOT_DIR/bin/galcode.js" "$@"
LAUNCHER

# Replace placeholders
if [[ "$(uname -s)" == "Darwin" ]]; then
  sed -i '' "s|__ROOT__|$ROOT_DIR|" "$TARGET"
  sed -i '' "s|__NODE__|$NODE|" "$TARGET"
  sed -i '' "s|__NODE_PATH__|$NODE_PATH|" "$TARGET"
else
  sed -i "s|__ROOT__|$ROOT_DIR|" "$TARGET"
  sed -i "s|__NODE__|$NODE|" "$TARGET"
  sed -i "s|__NODE_PATH__|$NODE_PATH|" "$TARGET"
fi
chmod +x "$TARGET"

echo "Galcode installed: $TARGET"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add this line to ~/.zshrc (macOS) or ~/.bashrc (Linux):"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
  echo "Then run: source ~/.zshrc"
else
  echo "Run: galcode --help"
fi
