#!/bin/bash
set -euo pipefail

# Downloads the official Lima release and unpacks it into vendor/lima so it can
# be bundled into the app (extraResources). Skips if already present.

LIMA_VERSION="2.1.3"
DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/lima"

sanitize_lima_bundle() {
  # JimmyBox Studio provisions Linux VMs only. Lima ships Darwin guest agents for
  # macOS guests too; Apple notarization expands those .gz files and rejects the
  # unsigned nested Mach-O binaries, so keep them out of the app bundle.
  rm -f "$DEST"/share/lima/lima-guestagent.Darwin-*.gz
}

if [ -x "$DEST/bin/limactl" ]; then
  echo "Lima already bundled at $DEST"
  sanitize_lima_bundle
  exit 0
fi

LARCH="${LIMA_ARCH:-$(uname -m)}"

case "$LARCH" in
  arm64|aarch64) LARCH="arm64" ;;
  x86_64|amd64) LARCH="x86_64" ;;
  *) echo "Unsupported Lima architecture: $LARCH (set LIMA_ARCH to arm64 or x86_64)"; exit 1 ;;
esac

URL="https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/lima-${LIMA_VERSION}-Darwin-${LARCH}.tar.gz"
TMP="$(mktemp -t jbx-lima).tar.gz"

echo "Downloading $URL"
curl -fSL -o "$TMP" "$URL"
mkdir -p "$DEST"
tar -xzf "$TMP" -C "$DEST"
rm -f "$TMP"
sanitize_lima_bundle
echo "Lima ${LIMA_VERSION} bundled at $DEST"
