# Release Process

This document is for maintainers preparing a public GitHub Release.

## 1. Prepare the Repository

```sh
git status
npm test
```

Check that no private files are staged:

```sh
git diff --cached --name-only
```

Do not commit:

- `node_modules/`
- `dist/`
- `vendor/lima/`
- local VM data
- credentials
- private project archives
- private planning files

## 2. Build the Public DMG

Store notary credentials once:

```sh
npm run notary:store
```

Build, sign, notarize, staple, and verify:

```sh
npm run release:notarized
```

The final file is written to:

```text
dist/JimmyBox Studio-1.0.0-arm64.dmg
```

Record the SHA-256 checksum from the script output.

## 3. Create the GitHub Release

Recommended tag format:

```text
v1.0.0
```

Recommended release title:

```text
JimmyBox Studio v1.0.0
```

Attach:

- `dist/JimmyBox Studio-1.0.0-arm64.dmg`
- optional blockmap only if an updater starts using it

Use `.github/release-template.md` as the release body.

## 4. Post-Release Smoke Test

On a clean macOS user account or a separate Mac:

- download the DMG from GitHub Releases
- open the DMG
- drag the app to Applications
- start the app
- start the VM
- create a WordPress test project
- open phpMyAdmin
- create and restore a checkpoint
- import one existing project archive

Document any release blockers before sharing the release publicly.
