#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${GALCODE_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/galcode"

echo "========================================"
echo " Galcode Installer"
echo "========================================"

# ── 1. Node.js ──
if [[ -x "$ROOT_DIR/tools/bin/node" ]]; then
  NODE="$ROOT_DIR/tools/bin/node"
  NPM="$ROOT_DIR/tools/bin/npm"
  NODE_PATH='export PATH="$ROOT_DIR/tools/bin:$PATH"'
elif command -v node &>/dev/null; then
  NODE="$(command -v node)"
  NPM="$(command -v npm)"
  NODE_PATH=""
else
  echo "Node.js not found. Install: brew install node"
  exit 1
fi
echo "[1/4] Node.js: $($NODE --version)"

# ── 2. npm deps ──
echo "[2/4] Installing dependencies..."
cd "$ROOT_DIR"
$NPM install --include=optional 2>&1 | tail -3

# Ensure Electron Framework is intact (macOS only)
if [[ "$(uname -s)" == "Darwin" ]]; then
  ELECTRON_FW="$ROOT_DIR/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework"
  if [[ ! -d "$ELECTRON_FW" ]]; then
    echo "       Electron Framework missing, fixing..."
    rm -rf "$ROOT_DIR/node_modules/electron/dist" "$ROOT_DIR/node_modules/electron/path.txt"
    cd "$ROOT_DIR/node_modules/electron" && $NODE install.js 2>&1 | tail -2
    cd "$ROOT_DIR"
  fi
fi

# ── 3. WebGAL engine ──
echo "[3/4] WebGAL engine..."
WEBGAL_DIR="$ROOT_DIR/vendor/webgal-mygo"
if [[ ! -f "$WEBGAL_DIR/packages/webgal/package.json" ]]; then
  echo "       Downloading..."
  rm -rf "$WEBGAL_DIR" "$ROOT_DIR"/vendor/webgal-mygo-*
  mkdir -p "$ROOT_DIR/vendor"
  TMP_ZIP=$(mktemp).zip
  curl -L --retry 3 -o "$TMP_ZIP" "https://github.com/boomwwww/webgal-mygo/archive/refs/heads/main.zip" || {
    echo "       Download failed."
    exit 1
  }
  if [[ "$(uname -s)" == "Darwin" ]]; then
    ditto -x -k "$TMP_ZIP" "$ROOT_DIR/vendor/"
  else
    unzip -qo "$TMP_ZIP" -d "$ROOT_DIR/vendor/" 2>/dev/null || true
  fi
  rm -f "$TMP_ZIP"
  for d in "$ROOT_DIR"/vendor/webgal-mygo-*; do
    [[ -d "$d" ]] && mv "$d" "$WEBGAL_DIR" && break
  done
fi
if [[ -f "$WEBGAL_DIR/packages/webgal/package.json" ]]; then
  echo "       Engine: OK"
  if [[ ! -d "$WEBGAL_DIR/node_modules" ]]; then
    echo "       Installing WebGAL deps..."
    cd "$WEBGAL_DIR" && $NPM install --legacy-peer-deps 2>&1 | tail -2
    cd "$ROOT_DIR"
  fi
else
  echo "       Engine not found. Skipping."
fi

# ── 4. Install galcode command ──
echo "[4/4] Installing galcode..."
mkdir -p "$BIN_DIR"
rm -f "$TARGET"
cat > "$TARGET" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$ROOT_DIR"
$NODE_PATH
exec "$NODE" "\$ROOT_DIR/bin/galcode.js" "\$@"
LAUNCHER
chmod +x "$TARGET"

echo
echo "Done! Run: galcode --help"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "First add to PATH: export PATH=\"$BIN_DIR:\$PATH\""
fi
