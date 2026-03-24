# Packaging & releases

## Windows: WiX MSI (current setup)

Squirrel has been removed. `npm run make` on **Windows** builds a **classic MSI installer** via `@electron-forge/maker-wix`:

- Wizard UI, **Choose install location** (enabled in `forge.config.js` with `ui.chooseDirectory`).
- Output: `out/make/wix/x64/phevere-*.msi` (exact filename follows version and arch).

### Shortcut mode + `koffi`

The main process uses **koffi** for “hold trigger while selecting” on Windows. `forge.config.js` sets **`asarUnpack`** for `node_modules/koffi` so the native addon loads from the installed app. Without that, packaged builds could fall back to **select-then-trigger only** (no false “keys held” double popups).

### Prerequisite (build machine only)

Install **[WiX Toolset v3](https://github.com/wixtoolset/wix3/releases)** so `candle.exe` and `light.exe` are on your **PATH**. Without WiX, the `wix` maker step fails.

### Commands

```bash
# Native addon must be built before packaging (UIAutomation .node)
npm run build-native

# Produce the MSI (run on Windows)
npm run make
# or explicitly:
npm run make:win
```

Artifacts for GitHub Releases: attach the `.msi` (and optionally ZIPs for other platforms from the same `make` on those OSes). Step-by-step tagging and uploading: **`docs/RELEASE.md`**.

### Why MSI instead of a single `.exe` (NSIS)?

Forge’s first-party Windows story is **WiX → MSI**, which fits “classic installer” and enterprise-style deployment. A **Setup.exe**-style NSIS build is usually done with **electron-builder** as a separate pipeline; we can add that later if you want both artifacts.

### End users

The MSI bundles **Electron** and the app; users do **not** install Node.js or npm.

### Code signing (recommended)

Sign the MSI for fewer SmartScreen warnings (certificate + optional `windowsSign` / cert fields in WiX maker config — see [Forge MakerWix docs](https://js.electronforge.io/interfaces/_electron_forge_maker_wix.MakerWixConfig.html)).

### Microsoft Store

Store distribution uses **MSIX** / Partner Center; that is a **separate** packaging step from this MSI, not a replacement for local testing of the WiX output.
