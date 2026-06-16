#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${GALCODE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/galcode"

# ── 1. Find node ──
if [[ -x "$ROOT_DIR/tools/bin/node" ]]; then
  NODE="$ROOT_DIR/tools/bin/node"
  NODE_PATH='export PATH="$ROOT_DIR/tools/bin:$PATH"'
elif command -v node &>/dev/null; then
  NODE="$(command -v node)"
  NODE_PATH=""
else
  echo "Node.js not found. Install: brew install node  /  apt install nodejs"
  exit 1
fi

# ── 2. Install npm deps (Electron for recording) ──
echo "Installing dependencies..."
cd "$ROOT_DIR"
"$NODE" "$(command -v npm)" install --legacy-peer-deps 2>&1 | tail -1

# ── 3. Download WebGAL engine if missing ──
if [[ ! -d "$ROOT_DIR/vendor/webgal-mygo/packages/webgal" ]]; then
  echo "Downloading WebGAL engine..."
  mkdir -p "$ROOT_DIR/vendor"
  WEBGAL_ZIP="https://github.com/boomwwww/webgal-mygo/archive/refs/heads/main.zip"
  TMP_ZIP=$(mktemp).zip
  curl -L --retry 5 -o "$TMP_ZIP" "$WEBGAL_ZIP" || { echo "Download failed. Run: galcode download-assets --target webgal-mygo"; exit 1; }
  unzip -qo "$TMP_ZIP" -d "$ROOT_DIR/vendor/" && rm -f "$TMP_ZIP"
  mv "$ROOT_DIR"/vendor/webgal-mygo-* "$ROOT_DIR/vendor/webgal-mygo" 2>/dev/null || true
  echo "Engine ready."
fi

# ── 4. Install launcher ──
mkdir -p "$BIN_DIR"
rm -f "$TARGET"
cat > "$TARGET" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$ROOT_DIR"
$NODE_PATH
exec "$NODE" "\$ROOT_DIR/bin/galcode.js" "\$@"
LAUNCHER
chmod +x "$TARGET" "$ROOT_DIR/galcode" "$ROOT_DIR/bin/galcode.js" 2>/dev/null || true

echo
echo "Done! Galcode installed: $TARGET"
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Add to ~/.zshrc:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
else
  echo "Run: galcode --help"
fi
