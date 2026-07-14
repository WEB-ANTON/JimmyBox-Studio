#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-jimmybox-notary}"
KEYCHAIN="${APPLE_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"

cd "$ROOT_DIR"

if ! xcrun notarytool --version >/dev/null 2>&1; then
  echo "Xcode command line tools are required. Install Xcode, then run: xcode-select --install" >&2
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -q 'Developer ID Application'; then
  echo "No Developer ID Application certificate was found in your Keychain." >&2
  echo "Install it via Xcode Settings -> Accounts -> Manage Certificates." >&2
  exit 1
fi

echo "Building signed and notarized release with notary profile: $PROFILE"
echo "Keychain: $KEYCHAIN"
echo

npm run fetch-lima

APPLE_KEYCHAIN_PROFILE="$PROFILE" \
APPLE_KEYCHAIN="$KEYCHAIN" \
"$ROOT_DIR/node_modules/.bin/electron-builder" --mac --arm64 --publish=never -c.mac.notarize=false

DMG="$(find dist -maxdepth 1 -name 'JimmyBox Studio-*-arm64.dmg' -print | sort | tail -1)"
if [ -z "$DMG" ]; then
  echo "No release DMG found in dist/." >&2
  exit 1
fi

APPLE_KEYCHAIN_PROFILE="$PROFILE" \
APPLE_KEYCHAIN="$KEYCHAIN" \
"$ROOT_DIR/scripts/notary-submit-dmg.sh" "$DMG"
