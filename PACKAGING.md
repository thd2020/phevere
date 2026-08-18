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
| `onnxruntime-node` + `sharp` + `@gutenye/*` | `asarUnpack` |
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

Sidebar/header **must** be real 24-bpp BMP (`BM` magic). `prepare:installer` writes them with `writeTrueBmp` at the exact MUI sizes (164×314 sidebar, 150×57 header) from the stylized-P mark — do not cover-scale a splash PNG (that warped the wizard art) and do not save PNG bytes as `.bmp` (NSIS then paints a blank pane). Inner-page header is **light** (`#F3F3F3`) so it is not a black slab on Win11 paper. `packaging/installer.nsh` sets `MUI_*_BITMAP_NOSTRETCH` so Per-Monitor v2 DPI does not stretch those bitmaps.

### Code signing / SmartScreen

Unsigned Setup.exe always trips SmartScreen until Windows has seen many downloads of that publisher. **Self-signed certificates do not help.**

To Authenticode-sign a public build (OV or EV code-signing cert from a CA):

```powershell
$env:CSC_LINK = "C:\secure\phevere-codesign.pfx"   # or base64 of the PFX
$env:CSC_KEY_PASSWORD = "<pfx password>"
npm run make:win
```

Optional: `CSC_NAME` (subject CN in the Windows cert store) or `WIN_CSC_LINK`. electron-builder timestamps with DigiCert RFC3161 (`electron-builder.yml`). EV certs clear SmartScreen faster than OV; either still needs a period of reputation if the publisher is new.

Do not commit `.pfx` / passwords. `make:win` warns when `CSC_LINK` is unset.

### Optional: WiX MSI

Commented in `forge.config.js`; needs WiX Toolset v3. Prefer NSIS for end users.
