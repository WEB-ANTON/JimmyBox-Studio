# JimmyBox Studio

JimmyBox Studio is a macOS desktop app for local PHP and CMS development on Apple Silicon. It bundles an Ubuntu development VM, Apache, PHP-FPM, MariaDB, Redis, Composer, project management, database tools, hosts management, and local checkpoints in one macOS app.

It is the desktop successor to the original JimmyBox Parallels/Vagrant workflow by [JarJarBernie](https://github.com/JarJarBernie/jimmybox-parallels). JimmyBox Studio does not modify an existing Vagrant, Parallels, `~/Sites`, or SwitchHosts setup.

## Release Status

Current release: **v1.1.0 Solo**

This Solo release is intended for individual local development on a single Mac.

## Highlights

- **One desktop app:** start and stop the VM, manage projects, databases, hosts, PHP versions, and checkpoints without manual shell work.
- **Apple Silicon VM:** Ubuntu 22.04 through Lima and Apple's Virtualization.framework.
- **PHP/CMS stack:** Apache, PHP-FPM, MariaDB, Redis, Composer, and common CMS runtime packages.
- **CMS adapters:** WordPress, TYPO3, Contao, Drupal, Joomla, and Plain PHP.
- **Project automation:** create or import projects with vHost, SSL metadata, database, hosts entry, CMS files, and setup metadata.
- **Database tools:** create, import, export, browse read-only SQL, and open phpMyAdmin.
- **Safe hosts management:** Studio writes only inside its marked JimmyBox block in `/etc/hosts`.
- **Local checkpoints:** create and restore snapshots of project files, database, setup metadata, and media paths.

## Requirements

- Apple Silicon Mac
- macOS with Apple's Virtualization.framework support
- Admin permission when macOS asks to update `/etc/hosts`

## Install

1. Open the latest GitHub Release.
2. Download `JimmyBox Studio-1.1.0-arm64.dmg`.
3. Open the DMG and drag JimmyBox Studio to Applications.
4. Start JimmyBox Studio.
5. Press **Start** to create and provision the local VM on first run.

The public DMG is signed and notarized before distribution.

## Quickstart

1. Start the VM in JimmyBox Studio.
2. Open **Projects**.
3. Enter a domain such as `client.test` or `client.local`.
4. Choose PHP version and CMS.
5. Press **Create Project**.
6. Press **Open** in the project row.

Studio repairs the vHost if needed, writes the current VM IP into the JimmyBox hosts block, and opens the local HTTPS URL. Local certificates are self-signed, so the browser may ask you to trust the certificate once per domain.

## Import an Existing Site

1. Export the project files as `.zip`, `.tar`, `.tar.gz`, or `.tgz`.
2. Export the database as `.sql` or `.sql.gz`.
3. In Studio, open **Projects -> Import existing project**.
4. Enter the domain that should run locally.
5. Select the archive and optional database dump.
6. Press **Import project**.

Import safety:

- Archives with unsafe paths or symbolic links are rejected.
- Database dumps that try to switch to a different database are rejected.
- Existing project folders are not overwritten.
- CMS adapters localize known config files to the local database.

## Project Setup Descriptor

Managed projects can contain `.jimmybox-studio/setup.json`.

It records:

- domain
- CMS adapter
- document root
- PHP version
- database name
- media paths
- hosts entries
- setup/provisioning routines
- optional staging metadata

Do not store secrets in setup descriptors. Paths must be relative and must not contain `..`.

## Safety Model

- Creating an existing managed project repairs missing runtime pieces instead of overwriting code or data.
- Deleting a project refuses unmanaged folders.
- Hosts changes are written only between `# >>> JIMMYBOX STUDIO >>>` and `# <<< JIMMYBOX STUDIO <<<`.
- Database browsing accepts read-only SQL only.
- Setup routines are shown before execution and run only after confirmation.
- Restores create safety backups before replacing files, database, or media.

## Repository Policy

This repository is public for transparency and release distribution. It is not published under an open-source license. See [LICENSE](LICENSE).

Issues and pull requests are welcome for review, but using, redistributing, or modifying the code outside this repository requires written permission from the copyright holder.

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - release history
- [docs/RELEASE.md](docs/RELEASE.md) - maintainer release process
- [SECURITY.md](SECURITY.md) - vulnerability reporting
- [SUPPORT.md](SUPPORT.md) - support channels and useful diagnostics

## FAQ

### Where are projects stored?

By default in `~/JimmyboxStudio/Sites/<domain>`. You can change the Sites path in Settings.

### Does Studio use localhost for project domains?

No. Project domains resolve to the VM's host-reachable IP, usually `192.168.64.x`, through `/etc/hosts`.

### What happens if the VM IP changes?

Press **Open** on a project. Studio repairs the vHost, SSL metadata, and hosts entries with the current VM IP.

### Can I use real production domains locally?

Yes. Studio points the domain to the local VM through `/etc/hosts`. Be careful when switching between local and production contexts.

### Is the database browser a full SQL console?

No. It is intentionally read-only. Use phpMyAdmin for advanced local database operations.
