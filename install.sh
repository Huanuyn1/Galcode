#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${GALCODE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/galcode"

mkdir -p "$BIN_DIR"
chmod +x "$ROOT_DIR/galcode" "$ROOT_DIR/bin/galcode.js" "$ROOT_DIR/tools/galcode-launcher.sh"
cat > "$TARGET" <<EOF
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$ROOT_DIR"
export PATH="\$ROOT_DIR/tools/bin:\$PATH"
exec "\$ROOT_DIR/tools/bin/node" "\$ROOT_DIR/bin/galcode.js" "\$@"
EOF
chmod +x "$TARGET"

echo "Galcode installed:"
echo "  $TARGET"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add this to your shell profile if galcode is not found:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "You can now run:"
  echo "  galcode --help"
fi
