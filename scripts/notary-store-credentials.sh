#!/usr/bin/env bash
set -euo pipefail

PROFILE="${APPLE_KEYCHAIN_PROFILE:-jimmybox-notary}"

printf 'Apple ID email: '
read -r APPLE_ID

printf 'Apple Developer Team ID: '
read -r TEAM_ID

if [ -z "$APPLE_ID" ] || [ -z "$TEAM_ID" ]; then
  echo "Apple ID and Team ID are required." >&2
  exit 1
fi

echo
echo "Storing notary credentials in your macOS Keychain profile: $PROFILE"
echo "notarytool will ask for your app-specific password securely."
echo

xcrun notarytool store-credentials "$PROFILE" \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID"

echo
echo "Saved. Use APPLE_KEYCHAIN_PROFILE=$PROFILE when building releases."
