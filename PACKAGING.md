# Packaging & releases

## Windows: NSIS Setup.exe (primary)

We use **electron-builder NSIS** via `@electron-addons/electron-forge-maker-nsis` — assisted wizard (directory, components, branding, **uninstaller**).

```bash
npm run build-native
npm run make:win
# Artifact: out/make/nsis/x64/Phevere-Setup-*-x64.exe
```

`make:win` (`scripts/make-win.js`) sets **npmmirror** Electron / electron-builder-binaries mirrors by default so packaging does not hang on `github.com` (`ETIMEDOUT`). Override with `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` if needed.

GitHub Actions: `ci.yml` on PR/`main`; tag `v*.*.*` runs `release.yml` (NSIS + GitHub Release + attestation). Optional `CSC_LINK` secret. See `docs/RELEASE.md`. `make:win` drops blank `CSC_LINK` / `WIN_CSC_LINK` (Actions injects `""` when the secret is unset) so unsigned CI builds do not fail signing.

| | |
|---|---|
| Default path | **`Program Files\Phevere`** (per-machine default; `menuCategory: false`) |
| Publisher | **thd2020** (`LICENSE`, `copyright`, `publisherName`, package `author`) |
| Uninstaller | `Uninstall Phevere.exe` in the install dir + **Apps & Features** registry |
| Start menu | Optional “Phevere” + **“Uninstall Phevere”** shortcuts |

### Single bundled installer

One Setup.exe includes the app **and** OCR models (`resources/ocr-models` → `extraResources`). Components page:

| Component | Default | Notes |
|---|---|---|
| Desktop shortcut | on | |
| Start menu shortcut | on | Also creates **Uninstall Phevere** |
| OCR models (~15 MB) | **on** | Uncheck → remove `resources\ocr-models` after extract |

### Uninstall & ghost cleanup

Normal uninstall:

1. Windows **Settings → Apps → Phevere → Uninstall**, or  
2. Start menu → **Uninstall Phevere**, or  
3. Run `"C:\Program Files\Phevere\Uninstall Phevere.exe"`

If files remain but Apps has no entry (“ghost” install — often from aborted installs or older author-folder paths):

```powershell
.\scripts\remove-ghost-phevere.ps1
.\scripts\remove-ghost-phevere.ps1 -AlsoUserData   # also wipe %APPDATA%\phevere
```

`packaging/installer.nsh` reinforces uninstall registry keys on install and cleans Start Menu leftovers (including legacy `thd2020` / `xiangyuxiao` folders) on uninstall. `preInit` only seeds `InstallLocation` when empty, so incomplete installs are less likely to leave orphan registry rows.

### What is solidly bundled

| Asset | How it ships |
|---|---|
| App code | `app.asar` (webpack bundle; `node-fetch` is bundled, not a runtime `require`) |
| `koffi` + `sql.js` | `asarUnpack` |
| `onnxruntime-node` 1.23.2 + `sharp` + `@gutenye/*` | Forge `asar.unpackDir` (not `asarUnpack` — that key is electron-builder). Must also be kept by `scripts/packager-ignore.js`. 1.23.2 last npm with Intel Mac `darwin/x64` |
| `sql-wasm.wasm` + `sql-asm.js` | `extraResources` |
| Offline **seed** packs | optional `resources/seed`; users also download WordNet / GCIDE / CEDICT / FreeDict from Settings |
| OCR ONNX models | `extraResources` → `ocr-models` |
| Uninstaller | Written by NSIS as `Uninstall Phevere.exe` |

### Branding assets

`npm run prepare:installer` refreshes:

- `packaging/icon.ico` + `icon.png`
- `packaging/installerSidebar.bmp` / `installerHeader.bmp`
- `resources/tray-icon.png`

Welcome / finish / components: `packaging/installer.nsh`. Options: `electron-builder.yml`.

Sidebar/header **must** be real 24-bpp BMP (`BM` magic). `prepare:installer` writes them with `writeTrueBmp` at **2×** MUI size (328×628 sidebar, 300×114 header) from the stylized-P mark — do not cover-scale a splash PNG and do not save PNG bytes as `.bmp`. Inner-page header and `MUI_BGCOLOR` are **white** (`#FFFFFF`) so Win11 is not stuck on XP grey. Do **not** set `MUI_*_BITMAP_NOSTRETCH` (that left a 1× blit that DPI nearest-neighbor-scaled into a blurry pane). `installer.nsh` sets HALFTONE stretch on GUI init.

### Code signing / SmartScreen

**You cannot mint a cert at home that strangers’ Win11 will trust.** Self-signed / homemade CA only works on PCs that import that cert. GitHub attestations are provenance, not Authenticode.

Practical options (2026): **SignPath Foundation** (free OSS signing; publisher name is SignPath Foundation), a paid **OV** cert + HSM/USB/cloud, or Microsoft Store **MSIX**. Azure Artifact Signing is not available to individuals outside the USA/Canada. EV no longer skips SmartScreen.

Full comparison and local test-signing PowerShell: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).

To Authenticode-sign a public build with a CA PFX (OV):

```powershell
$env:CSC_LINK = "C:\secure\phevere-codesign.pfx"   # or base64 of the PFX
$env:CSC_KEY_PASSWORD = "<pfx password>"
npm run make:win
```

Optional: `CSC_NAME` (subject CN in the Windows cert store) or `WIN_CSC_LINK`. electron-builder timestamps with DigiCert RFC3161 (`electron-builder.yml`).

Do not commit `.pfx` / passwords. `make:win` warns when `CSC_LINK` is unset.

### Optional: WiX MSI

Commented in `forge.config.js`; needs WiX Toolset v3. Prefer NSIS for end users.

## macOS: ZIP (draft, no notarized .dmg)

There is **no public Mac download** yet. Maintainers can produce a per-arch zip:

```bash
npm run build-native
npm run make:mac          # this Mac's arch
# npm run make:mac:x64    # Intel only — must run on Intel (or CI macos-15-intel)
# npm run make:mac:arm64  # Apple Silicon only — must run on arm64 (or CI macos-latest)
# Artifact: out/make/zip/darwin/{arch}/Phevere-darwin-{arch}-{version}.zip
```

OCR in that zip must work on a machine with **no Node, no Python, no `npm install`**. Forge's webpack plugin would otherwise pack only `/.webpack` and drop the OCR natives (`onnxruntime-node`, `sharp`, `@gutenye/*`). `scripts/packager-ignore.js` keeps those trees (and `koffi` / `sql.js`); `packagerConfig.prune` is **false** (galactus would skip nested `@img` binaries); `asar.unpackDir` unpacks them (`asarUnpack` is electron-builder-only — `@electron/packager` ignores it). `resources/ocr-models` is `extraResource`. Do not ignore the `node_modules` directory itself or packager never copies the packages. `@gutenye/ocr-node` is ESM: `import()` cannot load from inside `app.asar`, so it must be unpacked.

| Check | Path inside `Phevere.app` |
|---|---|
| ONNX models | `Contents/Resources/ocr-models/{det,rec,keys}` |
| ONNX Runtime | `Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/<arch>/onnxruntime_binding.node` |
| Gutenye | `…/app.asar.unpacked/node_modules/@gutenye/ocr-node/build/index.js` |
| sharp | `…/app.asar.unpacked/node_modules/@img/sharp-darwin-<arch>/` |

`onnxruntime-node` is pinned at **1.23.2** (last npm tarball with `darwin/x64`). Build each zip on matching hardware: the Accessibility `.node` is compiled for the host. CI (`macos-ocr-pack`) packages both `macos-15-intel` (x64) and `macos-latest` (arm64) and runs `scripts/verify-ocr-pack.js`. Packaged Electron never falls back to the user's Python.

```bash
npx electron-forge package --platform darwin
npm run verify:ocr-pack
```

