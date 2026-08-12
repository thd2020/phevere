# Packaging & releases

## Windows: NSIS Setup.exe (primary)

We use **electron-builder NSIS** via `@electron-addons/electron-forge-maker-nsis` — assisted wizard (directory, components, branding).

```bash
npm run build-native
npm run make:win
# Artifacts:
#   out/make/nsis/x64/Phevere-Setup-*-x64.exe
#   out/make/nsis/x64/Phevere-OCR-Models.zip   (optional sidecar)
```

Default install path is **`Program Files\Phevere`** (per-machine; no author parent folder). Publisher / copyright: **thd2020**.

### Optional components

The installer components page offers:

| Component | Default | Notes |
|---|---|---|
| Desktop shortcut | on | |
| Start menu shortcut | on | |
| OCR models (~15 MB) | **off** | Requires `Phevere-OCR-Models.zip` next to Setup.exe |

OCR models are **not** embedded in Setup.exe (de-bloat). `npm run prepare:installer` builds the sidecar zip from `resources/ocr-models/`; `make:win` copies it beside the Setup artifact. Users who skip OCR can still download packs later in **Settings**.

### What is solidly bundled

| Asset | How it ships |
|---|---|
| App code | `app.asar` |
| `koffi` + `sql.js` | `asarUnpack` |
| `onnxruntime-node` + `sharp` + `@gutenye/*` | `asarUnpack` (runtime OCR engine; models optional) |
| `sql-wasm.wasm` + `sql-asm.js` | `extraResources` |
| Offline **seed** packs | `resources/seed` |
| OCR ONNX models | **Sidecar zip** / Settings download — not in Setup by default |

### Branding assets

Generated/updated by `npm run prepare:installer`:

- `packaging/icon.ico` + `icon.png` (ink / teal / ember “P” mark)
- `packaging/installerSidebar.bmp` (164×314)
- `packaging/installerHeader.bmp` (150×57)
- `resources/tray-icon.png`
- `packaging/optional/Phevere-OCR-Models.zip`

Edit welcome copy in `packaging/installer.nsh`. NSIS options live in `electron-builder.yml` (`menuCategory: false`, `selectPerMachineByDefault: true`, custom header/sidebar).

### Optional: WiX MSI (enterprise / GPO)

`MakerWix` remains commented in `forge.config.js`. Requires WiX Toolset v3.

### Commands

```bash
npm run prepare:installer
npm run build-native
npm run make:win
```

### Code signing

Sign the Setup.exe for fewer SmartScreen prompts (`win.certificateFile` / Azure Trusted Signing).

### Microsoft Store

Store distribution uses **MSIX** / Partner Center — separate from NSIS/MSI.
