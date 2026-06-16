#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${GALCODE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/galcode"

mkdir -p "$BIN_DIR"
chmod +x "$ROOT_DIR/galcode" "$ROOT_DIR/bin/galcode.js" 2>/dev/null || true

cat > "$TARGET" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="__ROOT_DIR__"
if [[ "$(uname -s)" == "Darwin" ]] && [[ -x "$ROOT_DIR/tools/bin/node" ]]; then
  NODE="$ROOT_DIR/tools/bin/node"
  export PATH="$ROOT_DIR/tools/bin:$PATH"
else
  NODE="$(command -v node)" || { echo "node >= 20 is required"; exit 1; }
fi
exec "$NODE" "$ROOT_DIR/bin/galcode.js" "$@"
SCRIPT

# Replace placeholder with actual path
sed -i '' "s|__ROOT_DIR__|$ROOT_DIR|g" "$TARGET" 2>/dev/null || sed -i "s|__ROOT_DIR__|$ROOT_DIR|g" "$TARGET"
chmod +x "$TARGET"

echo "Galcode installed: $TARGET"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add to your shell profile:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "Run: galcode --help"
fi
