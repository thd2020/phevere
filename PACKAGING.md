# Packaging & releases

## Windows: NSIS Setup.exe (primary)

We use **electron-builder NSIS** via `@electron-addons/electron-forge-maker-nsis` — assisted wizard (directory, components, branding).

```bash
npm run build-native
npm run make:win
# Artifact: out/make/nsis/x64/Phevere-Setup-*-x64.exe
```

`make:win` sets **npmmirror** Electron / electron-builder-binaries mirrors by default so packaging does not hang on `github.com` (`ETIMEDOUT`). Override with `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` if needed.

Default install path is **`Program Files\Phevere`** (per-machine; no author parent folder). Publisher / copyright: **thd2020**.

### Single bundled installer

One Setup.exe includes the app **and** OCR models (`resources/ocr-models` → `extraResources`). The components page still lets users:

| Component | Default | Notes |
|---|---|---|
| Desktop shortcut | on | |
| Start menu shortcut | on | |
| OCR models (~15 MB) | **on** | Uncheck to omit models from disk after install |

### What is solidly bundled

| Asset | How it ships |
|---|---|
| App code | `app.asar` |
| `koffi` + `sql.js` | `asarUnpack` |
| `onnxruntime-node` + `sharp` + `@gutenye/*` | `asarUnpack` |
| `sql-wasm.wasm` + `sql-asm.js` | `extraResources` |
| Offline **seed** packs | `resources/seed` |
| OCR ONNX models | `extraResources` → `ocr-models` |

### Branding assets

`npm run prepare:installer` refreshes:

- `packaging/icon.ico` + `icon.png`
- `packaging/installerSidebar.bmp` / `installerHeader.bmp`
- `resources/tray-icon.png`

Welcome copy: `packaging/installer.nsh`. Options: `electron-builder.yml`.

### Commands

```bash
npm run prepare:installer
npm run build-native
npm run make:win
```

### Code signing / Store

See earlier notes — sign Setup.exe for SmartScreen; MSIX is separate.
