# Packaging & releases

## Windows: NSIS Setup.exe (primary)

We use **electron-builder NSIS** via `@electron-addons/electron-forge-maker-nsis` — the prevailed Windows desktop installer path (multi-page wizard, install directory, shortcuts, branding, custom `installer.nsh`). This is the same family of installer UX as many Chinese desktop apps (directory chooser, finish-page launch), far more flexible than plain WiX/`electron-wix-msi`.

Config lives in **`electron-builder.yml`** + **`packaging/installer.nsh`** (welcome/finish macros, seed folder create).

```bash
npm run build-native
npm run make:win
# Artifact: out/make/nsis/…/Phevere-Setup-*.exe
```

### What is solidly bundled

| Asset | How it ships |
|---|---|
| App code | `app.asar` |
| `koffi` + `sql.js` | `asarUnpack` (native / require-able) |
| `onnxruntime-node` + `sharp` + `@gutenye/*` | `asarUnpack` (native OCR) |
| `sql-wasm.wasm` | `extraResources` → next to exe resources |
| OCR models (`resources/ocr-models`) | `extraResources` → `ocr-models` |
| OCR / media scripts, tray icon | `extraResources` |
| Offline **seed** packs | `resources/seed/**` → `resources/seed` in install; imported once into **writable** `userData/phevere.sqlite` |

The SQLite database itself is **not** frozen inside the installer executable as the live DB (installers are read-only; Windows apps write under `%APPDATA%`). Runtime creates/updates `phevere.sqlite` in userData; optional seed dumps are imported on first launch.

### Customizing the installer (params)

Edit `electron-builder.yml` → `nsis:`:

- `oneClick` / `allowToChangeInstallationDirectory` — assisted vs one-click
- `perMachine` — all-users vs current user
- `createDesktopShortcut` / `createStartMenuShortcut`
- `include: packaging/installer.nsh` — custom NSIS macros (welcome copy, finish page, extra files)

Replace `packaging/icon.ico` with branded multi-size art when you have it (NSIS requires `.ico`, not `.png`).

### Optional: WiX MSI (enterprise / GPO)

`MakerWix` remains in `forge.config.js` for Intune/GPO-style `.msi`. Requires **[WiX Toolset v3](https://github.com/wixtoolset/wix3/releases)** (`candle`/`light` on PATH). Prefer NSIS for end-user installs.

### Commands

```bash
npm run build-native
npm run make          # all configured makers
npm run make:win      # Windows only
npm run make:nsis     # alias → make:win (NSIS primary)
```

### Code signing

Sign the Setup.exe / MSI for fewer SmartScreen prompts (`win.certificateFile` / Azure Trusted Signing — see electron-builder docs).

### Microsoft Store

Store distribution uses **MSIX** / Partner Center — separate from NSIS/MSI.
