# Publishing a GitHub release

Use this checklist when cutting **v1.0.0** (or bump `package.json` / tag to match your next version).

## 1. Version and changelog

1. Set `"version"` in `package.json` to the release you want (e.g. `1.0.0`).
2. Update `CHANGELOG.md` with a dated section for that version.
3. Commit source changes (avoid committing `native-addon/build/` artifacts unless your repo intentionally tracks them).

## 2. Build the Windows MSI

On a Windows machine with **Node.js**, **Visual Studio build tools** (for the native addon), and **[WiX Toolset v3](https://github.com/wixtoolset/wix3/releases)** on `PATH`:

```powershell
cd path\to\phevere
npm install
npm run build-native
npm run make
```

Artifact: `out\make\wix\x64\phevere-*.msi` (exact name includes version and arch).

Optional — SHA-256 for release notes (PowerShell):

```powershell
Get-FileHash -Algorithm SHA256 "out\make\wix\x64\phevere-*.msi"
```

Paste the hash into the release description so users can verify downloads.

## 3. Tag the commit

```powershell
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

Use the same prefix as in `CHANGELOG.md` links (`v` + semver).

## 4. Create the release on GitHub

1. Open **https://github.com/thd2020/phevere/releases** (adjust if the repo moves).
2. **Draft a new release**.
3. **Choose a tag**: `v1.0.0` (create from the tag you pushed if needed).
4. **Release title**: e.g. `v1.0.0`.
5. **Description**: copy the `## [1.0.0]` section from `CHANGELOG.md`, or use this template:

```markdown
## Downloads

- **Windows x64:** `phevere-1.0.0.msi` (attached below)

## Requirements

- Windows 10/11 x64
- Administrator elevation recommended for system-wide UIAutomation selection (see README)

## SHA-256

`PASTE_HASH_HERE  phevere-1.0.0.msi`
```

6. **Attach** the `.msi` binary.
7. Publish the release.

## 5. Code signing (optional)

Unsigned MSIs may trigger SmartScreen. See `PACKAGING.md` for signing notes and Forge MakerWix configuration.

## CLI alternative

If you install [GitHub CLI](https://cli.github.com/) and authenticate (`gh auth login`):

```powershell
gh release create v1.0.0 "out\make\wix\x64\phevere-1.0.0.msi" --title "v1.0.0" --notes-file CHANGELOG.md
```

Adjust paths and flags (`--draft`, `--prerelease`) as needed.
