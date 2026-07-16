# Changelog

All notable changes to JimmyBox Studio are documented here.

## v1.1.0 Solo - 2026-07-16

Initial public Solo release.

### Added

- Guided first-run tutorial that walks through the main areas and can be restarted anytime from Settings.
- macOS desktop app for local PHP/CMS development on Apple Silicon.
- Ubuntu 22.04 VM management through Lima and Apple's Virtualization.framework.
- Apache, PHP-FPM, MariaDB, Redis, Composer, and common CMS runtime packages.
- Project creation and import workflows.
- CMS adapters for WordPress, TYPO3, Contao, Drupal, Joomla, and Plain PHP.
- Database create/import/export tools, read-only SQL browser, and phpMyAdmin launcher.
- Managed `/etc/hosts` block with grouped entries and safe toggles.
- Project setup descriptors in `.jimmybox-studio/setup.json`.
- Local checkpoints for project files, database snapshots, setup metadata, and media paths.
- Streamlined Solo layout focused on individual local development.
- Signed and notarized Apple Silicon DMG release.

### Verification

- Test suite: `npm test`
- macOS release build: signed Developer ID application
- Apple notarization: accepted
- Gatekeeper assessment: accepted
- Apple notarization submission: `baaad0d9-4ba6-4eca-a9ba-ef7292303dfb`
- DMG SHA-256: `c040dcbac0ff7894ef39d1572a068d630471c5437ebfb785ab179b207bef0371`

### Notes

- The repository is public but not open source. See `LICENSE`.
- Built DMG files are distributed through GitHub Releases, not committed to Git.
