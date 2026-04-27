#!/usr/bin/env bash
# ScrollLearn native messaging host installer (macOS).
# Sets up the helper that lets the extension's "Update now" button
# download a new release and swap it into your unpacked extension dir.
#
# Usage:
#   bash install.sh
#   bash install.sh <extension-id> <extension-dir>
#
# After running this, reload the extension once at chrome://extensions/.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer currently supports macOS only."
  exit 1
fi

EXT_ID="${1:-}"
EXT_DIR="${2:-}"

if [[ -z "$EXT_ID" ]]; then
  echo
  echo "ScrollLearn updater install"
  echo "==========================="
  echo
  echo "Find your extension ID at chrome://extensions/ (enable Developer Mode)."
  read -rp "Paste the ScrollLearn extension ID: " EXT_ID
fi

if [[ -z "$EXT_DIR" ]]; then
  echo
  echo "Path to your unpacked extension folder (the 'dist' you loaded into Chrome)."
  read -rp "Extension dir: " EXT_DIR
fi

EXT_ID="$(echo "$EXT_ID" | tr -d '[:space:]')"
EXT_DIR="$(cd "$(eval echo "$EXT_DIR")" && pwd)"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "Error: $EXT_DIR does not contain manifest.json" >&2
  exit 1
fi

INSTALL_DIR="$HOME/.scroll-learn"
SCRIPT_SRC="$(cd "$(dirname "$0")" && pwd)/scrolllearn-updater.py"
SCRIPT_DST="$INSTALL_DIR/scrolllearn-updater.py"
WRAPPER="$INSTALL_DIR/scrolllearn-updater.sh"
NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
NM_MANIFEST="$NM_DIR/com.scrolllearn.updater.json"

mkdir -p "$INSTALL_DIR"
mkdir -p "$NM_DIR"

cp "$SCRIPT_SRC" "$SCRIPT_DST"
chmod +x "$SCRIPT_DST"

# Wrapper that injects the extension dir as an env var, since Chrome calls
# the binary directly and we can't smuggle args through the manifest.
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
export SCROLLLEARN_EXT_DIR="$EXT_DIR"
exec /usr/bin/env python3 "$SCRIPT_DST" "\$@"
EOF
chmod +x "$WRAPPER"

cat > "$NM_MANIFEST" <<EOF
{
  "name": "com.scrolllearn.updater",
  "description": "ScrollLearn auto-updater",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo
echo "Installed:"
echo "  helper:   $SCRIPT_DST"
echo "  wrapper:  $WRAPPER"
echo "  manifest: $NM_MANIFEST"
echo "  ext dir:  $EXT_DIR"
echo
echo "Next steps:"
echo "  1. Go to chrome://extensions/"
echo "  2. Click the reload icon on ScrollLearn"
echo "  3. Open the dashboard. The 'Update now' button will work next time"
echo "     a new release is published on GitHub."
