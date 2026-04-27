#!/usr/bin/env bash
# ScrollLearn one-shot installer (no npm, no git clone needed).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.sh | bash
#
# Downloads the latest release, extracts to ~/.scroll-learn/, and registers
# the auto-updater so future updates are one click.

set -euo pipefail

REPO="tasszz2k/scroll-learn"
INSTALL_DIR="$HOME/.scroll-learn"
EXT_DIR="$INSTALL_DIR/extension"
HELPER="$INSTALL_DIR/scrolllearn-updater.py"
WRAPPER="$INSTALL_DIR/scrolllearn-updater.sh"
NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
NM_MANIFEST="$NM_DIR/com.scrolllearn.updater.json"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "ScrollLearn installer currently supports macOS only." >&2
  exit 1
fi

for cmd in curl unzip python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    if [[ "$cmd" == "python3" ]]; then
      echo "macOS will prompt to install Xcode Command Line Tools when you run python3 — run 'python3 --version' once and click Install." >&2
    fi
    exit 1
  fi
done

echo "==> Fetching latest release from $REPO..."
RELEASE_JSON=$(curl -fsSL -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases/latest")

ZIP_URL=$(printf '%s' "$RELEASE_JSON" \
  | grep '"browser_download_url"' \
  | grep '\.zip"' \
  | head -n1 \
  | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')

VERSION=$(printf '%s' "$RELEASE_JSON" \
  | grep '"tag_name"' \
  | head -n1 \
  | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/')

if [[ -z "$ZIP_URL" ]]; then
  echo "Could not find a .zip asset in the latest release." >&2
  echo "Response was:" >&2
  printf '%s\n' "$RELEASE_JSON" | head -n 40 >&2
  exit 1
fi

echo "==> Downloading v$VERSION"
echo "    $ZIP_URL"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$ZIP_URL" -o "$TMP/release.zip"

mkdir -p "$INSTALL_DIR"

# Wipe previous extension dir so updates are clean.
rm -rf "$EXT_DIR"
unzip -q "$TMP/release.zip" -d "$INSTALL_DIR"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "Release zip layout looks wrong (no $EXT_DIR/manifest.json)." >&2
  echo "Contents of $INSTALL_DIR:" >&2
  ls -la "$INSTALL_DIR" >&2
  exit 1
fi

if [[ ! -f "$HELPER" ]]; then
  echo "Release zip is missing scrolllearn-updater.py — try the dev install path." >&2
  exit 1
fi
chmod +x "$HELPER"

echo
echo "================================================================"
echo "  ScrollLearn v$VERSION downloaded to:"
echo "     $EXT_DIR"
echo "================================================================"
echo
echo "Next: load it in Chrome."
echo
echo "  1. A Chrome window will open at chrome://extensions"
echo "  2. Toggle 'Developer mode' (top right of the page)"
echo "  3. A Finder window will open with the 'extension' folder highlighted."
echo "     Easiest path: DRAG the highlighted 'extension' folder onto the"
echo "     chrome://extensions tab. Chrome accepts the drop and loads it."
echo
echo "     If you'd rather click 'Load unpacked':"
echo "       - Click 'Load unpacked' in chrome://extensions"
echo "       - The folder ~/.scroll-learn is HIDDEN by default in macOS dialogs."
echo "       - Press  Cmd+Shift+.  inside the dialog to reveal hidden folders,"
echo "         OR press  Cmd+Shift+G  and paste:  $EXT_DIR"
echo
echo "  4. Copy the extension ID from the ScrollLearn card"
echo

if [[ -t 0 ]]; then
  read -rp "Press Enter to open Chrome and reveal the extension folder..."
else
  echo "(non-interactive shell — open chrome://extensions yourself)"
fi

# `open` may fail if Chrome isn't installed at the default path; that's fine.
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
# Reveal the extension dir in Finder so the user can drag it onto Chrome
# without fighting the hidden-dotfile filter in the Load-unpacked dialog.
open -R "$EXT_DIR" 2>/dev/null || true

echo
read -rp "Paste the extension ID here: " EXT_ID < /dev/tty
EXT_ID="$(printf '%s' "$EXT_ID" | tr -d '[:space:]')"

if [[ -z "$EXT_ID" ]]; then
  echo "No extension ID provided. Aborting." >&2
  exit 1
fi

if [[ ! "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Warning: '$EXT_ID' doesn't look like a Chrome extension ID (32 lowercase a-p chars)." >&2
  read -rp "Continue anyway? [y/N] " yn < /dev/tty
  case "$yn" in
    [Yy]*) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
export SCROLLLEARN_EXT_DIR="$EXT_DIR"
exec /usr/bin/env python3 "$HELPER" "\$@"
EOF
chmod +x "$WRAPPER"

mkdir -p "$NM_DIR"
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
echo "Done. Installed v$VERSION."
echo
echo "Final step: go back to chrome://extensions and click the reload icon"
echo "on ScrollLearn once. From now on, updates appear as a banner in the"
echo "dashboard with an 'Update now' button."
