# Publishing a GitHub release

Keep `package.json` `version`, the git tag, and `CHANGELOG.md` in sync.

## Unattended (GitHub Actions)

After `.github/workflows/release.yml` is on `main`:

1. Bump `"version"` in `package.json`, add a `## [x.y.z]` section to `CHANGELOG.md`, commit, push `main`.
2. Tag and push (this **builds** Setup.exe, **creates** the GitHub Release, and **attests** the exe):

```powershell
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

Watch **Actions → release**. No Environment approval gate. Unsigned unless repo secrets `CSC_LINK` + `CSC_KEY_PASSWORD` are set (OV/EV PFX). Blank secrets are stripped in `scripts/make-win.js` so electron-builder does not treat `""` as a cert path. Verify:

```powershell
gh attestation verify out/make/nsis/x64/Phevere-Setup-1.2.3-x64.exe -R thd2020/phevere
```

CI (no installer): `.github/workflows/ci.yml` on every PR and push to `main` (Windows unpackaged app + macOS OCR native pack on `macos-15-intel` / `macos-latest`).

## Local fallback (optional)

Windows + Node.js + VS C++ (native addon):

```powershell
npm ci
npm run make:win
```

Artifact: `out\make\nsis\x64\Phevere-Setup-<version>-x64.exe`

If `github.com` times out while packaging, `make:win` already uses npmmirror. Ghost Program Files installs: `scripts/remove-ghost-phevere.ps1` (see README / PACKAGING.md).

```powershell
Get-FileHash -Algorithm SHA256 "out\make\nsis\x64\Phevere-Setup-*-x64.exe"
```

Prefer **not** to `gh release create` locally for the same tag — the workflow owns the release assets (GitHub immutable releases). Edit notes in the GitHub UI after the workflow finishes if needed.

## Notes template (if you write notes by hand)

```markdown
## Downloads

- **Windows x64 Setup:** `Phevere-Setup-x.y.z-x64.exe` (NSIS, directory chooser)

## Requirements

- Windows 10/11 x64
- Administrator elevation recommended for system-wide UIAutomation selection

## Highlights

See CHANGELOG `[x.y.z]` for the full list.
```

## Code signing (optional)

Repo secrets `CSC_LINK` + `CSC_KEY_PASSWORD`, or local env before `npm run make:win`. Self-signed certs do not clear SmartScreen for the public. Research and options: [`CODE_SIGNING.md`](CODE_SIGNING.md). Details also in `PACKAGING.md`.
