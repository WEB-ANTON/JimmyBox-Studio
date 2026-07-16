# JimmyBox Studio v1.1.0 Solo

First public Solo release of JimmyBox Studio for Apple Silicon Macs.

## Download

Download the signed and notarized DMG below:

- `JimmyBox Studio-1.1.0-arm64.dmg`

## What's Included

- Ubuntu 22.04 local development VM managed from a macOS desktop app.
- Apache, PHP-FPM, MariaDB, Redis, Composer, and common CMS packages.
- Project creation and import workflows.
- CMS adapters for WordPress, TYPO3, Contao, Drupal, Joomla, and Plain PHP.
- Database import/export, read-only SQL browser, and phpMyAdmin launcher.
- Safe `/etc/hosts` management inside the JimmyBox block.
- Local project checkpoints and restore workflow.
- Solo app layout without shared reservations or network synchronization.
- Compatible local data paths for a later Multiuser installation.

## Install

1. Download the DMG.
2. Open it and drag JimmyBox Studio to Applications.
3. Start the app.
4. Press **Start** to create and provision the VM.

macOS should accept the app as a notarized Developer ID application.

## Notes

- Apple Silicon only.
- The first VM provisioning run can take several minutes.
- Local HTTPS certificates are self-signed; browsers may ask you to trust them once per domain.
- A later Multiuser app can be installed over Solo while keeping local projects, VM data, databases, hosts entries, and checkpoints.

## Verification

Maintainer checklist before publishing:

- `npm test` passed.
- DMG signed and notarized.
- Stapling succeeded.
- Gatekeeper assessment returned `accepted`.
- SHA-256 checksum recorded in the release description.

For v1.1.0, use `docs/GITHUB_RELEASE_BODY_v1.1.0.md` as the final release body.
