# JimmyBox Studio v1.1.0 Solo

First public Solo release of JimmyBox Studio for Apple Silicon Macs.

## Download

Download the signed and notarized DMG from the assets below:

- `JimmyBox Studio-1.1.0-arm64.dmg`

## Verification

- Apple Notary status: `Accepted`
- Submission ID: `baaad0d9-4ba6-4eca-a9ba-ef7292303dfb`
- Gatekeeper assessment: `accepted`
- SHA-256: `c040dcbac0ff7894ef39d1572a068d630471c5437ebfb785ab179b207bef0371`

## What's Included

- Ubuntu 22.04 local development VM managed from a macOS desktop app.
- Apache, PHP-FPM, MariaDB, Redis, Composer, and common CMS packages.
- Project creation and import workflows.
- CMS adapters for WordPress, TYPO3, Contao, Drupal, Joomla, and Plain PHP.
- Database import/export, read-only SQL browser, and phpMyAdmin launcher.
- Safe `/etc/hosts` management inside the JimmyBox block.
- Local project checkpoints and restore workflow.
- Streamlined Solo layout focused on individual local development.

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
