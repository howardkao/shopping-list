#!/usr/bin/env bash
# WP-6: Generate iOS/Android launcher icons from a single master PNG via @capacitor/assets.
#
# Source artwork must be:
#   - 1024×1024 PNG at public/icon-1024.png
#   - Opaque background (no transparency for store-style icons)
#   - Square, uncropped artwork without pre-rounded corners (Apple/Google apply masks)
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/public/icon-1024.png"
INPUT_DIR="$ROOT/.cap-assets-input"

if [[ ! -f "$SRC" ]]; then
  echo "error: missing source app icon:" >&2
  echo "  $SRC" >&2
  echo >&2
  echo "Add a 1024×1024 PNG (opaque background, square, no rounded corners). See header comment in this script." >&2
  exit 1
fi

mkdir -p "$INPUT_DIR"
cp "$SRC" "$INPUT_DIR/logo.png"

cd "$ROOT"
exec npx capacitor-assets generate --ios --android --assetPath .cap-assets-input
