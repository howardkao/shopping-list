#!/usr/bin/env bash
# Build a signed Android release AAB ready for Play Console upload.
# See scripts/README-signing.md for keystore setup and first-run instructions.
#
# Usage:
#   export ANDROID_KEYSTORE_PATH=/path/to/provisions-upload.keystore
#   export ANDROID_KEYSTORE_PASSWORD=...
#   export ANDROID_KEY_ALIAS=provisions-upload
#   export ANDROID_KEY_PASSWORD=...
#   ./scripts/build-android-release.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
OUTPUT="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"

# ── validate env vars ────────────────────────────────────────────────────────

required_vars=(
  ANDROID_KEYSTORE_PATH
  ANDROID_KEYSTORE_PASSWORD
  ANDROID_KEY_ALIAS
  ANDROID_KEY_PASSWORD
)

missing=()
for var in "${required_vars[@]}"; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: missing required env vars: ${missing[*]}"
  echo "See scripts/README-signing.md for setup instructions."
  exit 1
fi

if [[ ! -f "$ANDROID_KEYSTORE_PATH" ]]; then
  echo "ERROR: keystore not found at ANDROID_KEYSTORE_PATH=$ANDROID_KEYSTORE_PATH"
  exit 1
fi

# ── sync web assets first ────────────────────────────────────────────────────

echo "==> Building web assets..."
cd "$REPO_ROOT"
npm run cap:sync

# ── build release AAB ────────────────────────────────────────────────────────

echo "==> Building release AAB..."
cd "$ANDROID_DIR"
./gradlew bundleRelease

# ── report ───────────────────────────────────────────────────────────────────

if [[ -f "$OUTPUT" ]]; then
  SIZE=$(du -sh "$OUTPUT" | cut -f1)
  echo ""
  echo "SUCCESS: $OUTPUT ($SIZE)"
  echo "Next: upload to Play Console → Internal testing track."
  echo "See scripts/README-signing.md §Android upload for step-by-step instructions."
else
  echo "ERROR: expected AAB not found at $OUTPUT"
  exit 1
fi
