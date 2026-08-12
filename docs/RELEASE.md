# Publishing a GitHub release

Use this checklist when cutting a version (keep `package.json` `version`, tag, and changelog in sync).

## 1. Version and changelog

1. Bump `"version"` in `package.json` (e.g. `1.2.0`).
2. Add a dated `## [x.y.z]` section to `CHANGELOG.md`.
3. Commit and push to `main`.

## 2. Build the Windows NSIS installer

On Windows with Node.js and VS build tools (native addon):

```powershell
cd path\to\phevere
npm install
npm run build-native
npm run make:win
```

Primary artifact:

```text
out\make\nsis\x64\Phevere-Setup-<version>-x64.exe
```

Single Setup includes optional OCR models. If packaging hits `connect ETIMEDOUT` to GitHub, use `npm run make:win` (npmmirror mirrors) or set `ELECTRON_MIRROR`.

Optional SHA-256:

```powershell
Get-FileHash -Algorithm SHA256 "out\make\nsis\x64\Phevere-Setup-*-x64.exe"
```

WiX MSI remains optional (see `PACKAGING.md`) when WiX Toolset v3 is installed.

## 3. Tag the commit

```powershell
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

## 4. Create the GitHub release

### CLI (preferred)

Draft (you only click **Publish** in the UI):

```powershell
$exe = Get-Item "out\make\nsis\x64\Phevere-Setup-*-x64.exe"
$hash = (Get-FileHash -Algorithm SHA256 $exe).Hash
gh release create "v1.2.0" $exe.FullName `
  --draft `
  --title "Phevere 1.2.0" `
  --notes-file release-notes-v1.2.0.md
```

Or publish immediately (omit `--draft`).

### Web UI

1. Open https://github.com/thd2020/phevere/releases/new
2. Choose tag `v1.2.0`, title `Phevere 1.2.0`
3. Paste notes from `CHANGELOG.md` / template below
4. Attach `Phevere-Setup-*-x64.exe`
5. Publish (or save draft)

### Notes template

```markdown
## Downloads

- **Windows x64 Setup:** `Phevere-Setup-1.2.0-x64.exe` (NSIS, directory chooser)

## Requirements

- Windows 10/11 x64
- Administrator elevation recommended for system-wide UIAutomation selection

## SHA-256

`PASTE_HASH_HERE  Phevere-Setup-1.2.0-x64.exe`

## Highlights

See CHANGELOG `[1.2.0]` for the full list.
```

## 5. Code signing (optional)

Unsigned Setup.exe may trigger SmartScreen. See `PACKAGING.md`.
