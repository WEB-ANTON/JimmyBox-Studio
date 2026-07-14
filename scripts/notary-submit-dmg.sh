#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-jimmybox-notary}"
DMG="${1:-}"
SIGN_IDENTITY="${CSC_NAME:-}"

cd "$ROOT_DIR"

if [ -z "$DMG" ]; then
  DMG="$(find dist -maxdepth 1 -name 'JimmyBox Studio-*-arm64.dmg' -print | sort | tail -1)"
fi

if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "Usage: npm run notary:submit -- path/to/JimmyBox.dmg" >&2
  echo "Or build a DMG first so the script can pick the newest one from dist/." >&2
  exit 1
fi

if [ -z "$SIGN_IDENTITY" ]; then
  SIGN_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -1)"
fi

if [ -z "$SIGN_IDENTITY" ]; then
  echo "No Developer ID Application certificate was found for signing the DMG." >&2
  echo "Install it via Xcode Settings -> Accounts -> Manage Certificates, or set CSC_NAME." >&2
  exit 1
fi

echo "Signing DMG with: $SIGN_IDENTITY"
codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG"
codesign --verify --verbose=2 "$DMG"

echo "Submitting to Apple Notary service with profile: $PROFILE"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait

echo
echo "Stapling ticket to: $DMG"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl -a -vv --type open --context context:primary-signature "$DMG"

echo
echo "Notarized DMG ready: $DMG"
shasum -a 256 "$DMG"
