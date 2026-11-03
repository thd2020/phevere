# Packaging & releases

2026-11-03: Desktop packages no longer carry the PP-OCRv4 models, which makes the x64 Setup.exe about 15 MB smaller (132.4 MB for 3.0.0, 117.6 MB now). Text recognition needs the OCR pack, a separate 13.7 MB release asset (`Phevere-OCR-PP-OCRv4.tar.gz`) that the app installs from Settings → Capture or that Setup downloads when you tick it under Custom options. Upgrading a Windows install made by 3.0 or earlier keeps the models it already has. See "OCR pack" below.

2026-11-03: The Custom options page is regrouped: install location with the space required, Shortcuts, Startup, and Downloads with their sizes. A new install no longer creates a desktop shortcut unless you tick it.

2026-10-25: Linux packages. `npm run make:linux:x64` / `make:linux:arm64` build a deb, an rpm and an AppImage per arch (`scripts/make-linux.js`, one maker at a time to save memory). Releases build them on Ubuntu 22.04 runners. See the Linux section below.

2026-10-14: Windows Setup keeps the illustrated single-page layout and uses native, keyboard-accessible controls. A selected pronunciation model downloads during setup; Windows ARM64 omits this choice.

![Screenshot of the illustrated Windows installer with its Install button and Custom options](PACKAGING.assets/installer-main.png)

Custom options replace the illustration within the same window. Each row is one checkbox you can click anywhere on, or reach with Tab and toggle with Space.

![Screenshot of Windows Setup custom options with install location, Shortcuts, Startup, and Downloads with sizes](PACKAGING.assets/installer-options.png)

The page as a new computer sees it: Start menu and Open Phevere after setup are on, everything else is off, and the space required counts the app plus whatever downloads are ticked.

2026-10-14: Windows replacement installs reuse the recorded installation folder and preserve the notebook and settings. Custom folders retain their full path, including spaces. Optional shortcut choices carry over, including choices made with older installers. Each Windows release job tests a real upgrade before replacing the download.

```mermaid
flowchart LR
  A[Existing Setup.exe] --> B[Recorded installation folder]
  B --> C[Saved notebook and settings]
  C --> D[Replacement Setup.exe]
  D --> E[Same folder and component choices]
  E --> F[Verify SQLite row and localStorage]
  F --> G[Current build in custom folder]
  G --> H[Same-version replacement]
  H --> I[Replace release download]
```

The release check upgrades the published installer at its actual recorded path. If the older installer uses a different folder, the check then uninstalls it and installs the current build in a custom folder with spaces while keeping the notebook and settings. It replaces the same version while the app is running and verifies that normal uninstall keeps user data. It runs only on a fresh administrator GitHub Windows runner; it refuses a developer machine or an existing installation.

**2026-09-30:** Windows Setup introduced the illustrated single-page layout. Art comes from `scripts/installer-art.js` through `prepare:installer`.

**2026-09-30:** Packages carry the speech engines in `resources/speech` (staged by `scripts/stage-speech.js` at prePackage): eSpeak NG WebAssembly (GPL-3.0, with its licence and source note), the bundled speech worker, and sherpa-onnx for Kokoro where a binary exists (not Windows on ARM). About 41 MB.

**2026-09-16:** `ci.yml` uploads an Android APK and an iOS IPA as Actions artifacts. They are not GitHub Release assets. Desktop `release.yml` is unchanged.

**2026-09-05:** `release.yml` Mac asset-delete is the same PowerShell as Windows (`scripts/gh-delete-release-asset.ps1`). CI Windows now runs `verify-ocr-pack` on the unpackaged app like macOS.

**2026-09-04:** Packaged app includes `speak_ipa_host.ps1` (long-lived System.Speech for IPA chips) and `speak_ipa.ps1`. **1.5.0** ships Windows Setup and macOS DMGs from the same tag. `extraResource` includes `media_now_playing.applescript` and `foreground_window.applescript` (same Resources layout as the Windows PowerShell helper).

**2026-09-03:** The NSIS copy page lists what is installing (extract / shortcuts / OCR models / registry). `npm run prepare:installer` patches electron-builder’s `SetDetailsPrint none` → `both` so those extract lines show.

## Windows: NSIS Setup.exe (primary)

We use electron-builder NSIS via `@electron-addons/electron-forge-maker-nsis` for installation, replacement upgrades, and the uninstaller. `scripts/build-installer-shell.js` wraps that backend with the native WPF frontend in `packaging/installer-ui`. Setup requests administrator approval when installation starts. The frontend, illustration, and private Outfit fonts are bundled inside the same Setup.exe; fonts are not installed globally.

Silent `/S` invocations go directly to the backend and return its exit code. Backend launch failures return an error without a shell error dialog. The wrapper restores a final `/D=` folder from NSIS's parsed directory so paths containing spaces reach the backend intact. Interactive setup passes its component choices explicitly. The frontend downloads a selected audio model through the installed app's headless `--install-audio-model=` command and reads progress from its JSON output.

```bash
npm run build-native
npm run make:win
# Artifact: out/make/nsis/x64/Phevere-Setup-*-x64.exe
# ARM64 (Windows 11 ARM host, or `npm run make:win:arm64` if VS ARM64 tools exist):
# Artifact: out/make/nsis/arm64/Phevere-Setup-*-arm64.exe
```

`make:win` (`scripts/make-win.js`) sets **npmmirror** Electron / electron-builder-binaries mirrors by default so packaging does not hang on `github.com` (`ETIMEDOUT`). Override with `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` if needed.

GitHub Actions: `ci.yml` on PR/`main` (including Android APK + iOS IPA as **Actions artifacts**, not Release assets); tag `v*.*.*` runs `release.yml` (NSIS x64 on `windows-latest` + NSIS arm64 on `windows-11-arm` + DMG x64 on `macos-15-intel` + DMG arm64 on `macos-latest` + GitHub Release + attestation). Optional `CSC_LINK` secret for Windows. See `docs/RELEASE.md`. `make:win` drops blank `CSC_LINK` / `WIN_CSC_LINK` (Actions injects `""` when the secret is unset) so unsigned CI builds do not fail signing. To **replace** all four desktop files on an existing tag (same filenames, no retag): Actions → release → Run workflow → `attach_tag`.

| | |
|---|---|
| Default path | **`Program Files\Phevere`** (per-machine default; `menuCategory: false`) |
| Publisher | **thd2020** (`LICENSE`, `copyright`, `publisherName`, package `author`) |
| Uninstaller | `Uninstall Phevere.exe` in the install dir + **Apps & Features** registry |
| Start menu | Optional “Phevere” + **“Uninstall Phevere”** shortcuts |

### Custom options

The WPF frontend (`packaging/installer-ui/InstallerUi.cs`) shows these choices and passes the shortcut ones to the NSIS backend as switches. Upgrades start from the saved choice.

| Group | Option | New install | Size |
|---|---|---|---|
| Shortcuts | Start menu (also creates **Uninstall Phevere**) | on | |
| Shortcuts | Desktop | off | |
| Startup | Start with Windows | off | |
| Startup | Open Phevere after setup | on | |
| Downloads | OCR pack | off | 14 MB |
| Downloads | Pronunciation voice (x64 only) | None | 132 or 350 MB |

Downloads run after the app is installed, through `phevere.exe --install-ocr-pack` and `--install-audio-model=<model>`, which print JSON progress lines. If one fails, Setup offers Retry download or Continue without it. `InstallerUi.exe --preview --fresh --options` opens the page without installing anything, as a computer without Phevere sees it. The NSIS page in `packaging/installer-pages.nsh` only appears if someone runs the backend directly.

### OCR pack

No desktop package includes OCR models. The pack holds three files from the `@gutenye/ocr-models` npm package (`ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`, `ppocr_keys_v1.txt`, 15.6 MB on disk), listed with their SHA-256 in `src/services/ocr-pack-manifest.json`.

- `npm run make:ocr-pack` writes `out/make/Phevere-OCR-PP-OCRv4.tar.gz`. The Windows x64 release job uploads and attests it on every tag; the name has no version so `releases/latest/download/` always finds it.
- The app (`src/services/ocr-pack.ts`) tries this version's release asset, then the latest release's, then the same files from the npm tarball on npmmirror and npmjs. Every file is checked against the manifest before it is moved into `%APPDATA%\phevere\ocr-packs\pp-ocrv4` (`~/Library/Application Support/phevere/...` on macOS, `~/.config/phevere/...` on Linux).
- The engine also loads `resources\ocr-models` next to the app, where 3.0 and earlier installed the models. The NSIS backend copies that folder aside before the old uninstaller removes the install folder during an upgrade, and puts it back afterwards (`PV_KEEP_OCR_MODELS` in `packaging/installer.nsh`). macOS and Linux replace the whole app on upgrade, so there the pack is installed again from Settings.
- Without the pack, Settings → Capture shows "Needs the OCR pack" with an Install button beside Hover lookup, and the notebook's Hover chip reads No OCR.
- `npm run test:ocr-pack` builds the asset and installs it through the real module with Electron stubbed: source order, a truncated download, a wrong checksum, the npm fallback, and cleanup. CI runs it.

![Screenshot of Settings, Capture tab, with Needs the OCR pack and an Install button beside Hover lookup](README.assets/desktop-settings-capture-ocr.png)

### Uninstall & ghost cleanup

Upgrades preserve an existing startup preference.

Normal uninstall:

1. Windows **Settings → Apps → Phevere → Uninstall**, or  
2. Start menu → **Uninstall Phevere**, or  
3. Run `"C:\Program Files\Phevere\Uninstall Phevere.exe"`

If files remain but Apps has no entry (“ghost” install — often from aborted installs or older author-folder paths):

```powershell
.\scripts\remove-ghost-phevere.ps1
.\scripts\remove-ghost-phevere.ps1 -AlsoUserData   # also wipe %APPDATA%\phevere
```

`packaging/installer.nsh` reinforces uninstall registry keys after installation and cleans its shortcuts on normal uninstall. Normal uninstall also removes the startup entry when it points to this installation; upgrades preserve it. Installation paths are selected by electron-builder's existing-install detection. The installer writes no default path registry entries before installation succeeds.

### What is solidly bundled

| Asset | How it ships |
|---|---|
| App code | `app.asar` (webpack bundle; `node-fetch` is bundled, not a runtime `require`) |
| `koffi` + `sql.js` | `asarUnpack` |
| `onnxruntime-node` 1.23.2 + `sharp` + `@gutenye/*` | Forge `asar.unpackDir` (not `asarUnpack` — that key is electron-builder). Must also be kept by `scripts/packager-ignore.js`. 1.23.2 last npm with Intel Mac `darwin/x64` |
| `sql-wasm.wasm` + `sql-asm.js` | `extraResources` |
| Offline **seed** packs | optional `resources/seed`; users also download WordNet / GCIDE / CEDICT / FreeDict from Settings |
| OCR ONNX models | Not bundled. The OCR pack is a separate release asset (see above); `verify-ocr-pack` fails if an `.onnx` model is found in a package |
| Uninstaller | Written by NSIS as `Uninstall Phevere.exe` |

### Branding assets

`npm run prepare:installer` refreshes:

- `packaging/icon.ico` + `icon.png` + `icon.icns` (macOS Dock / `.app`; `iconutil` on darwin)
- `packaging/installerSidebar.bmp` / `installerHeader.bmp` (uninstaller)
- `packaging/installerHero.bmp`, `installerButton.bmp`, `installerButtonOff.bmp`, `installerOpen.bmp` (install pages, from `scripts/installer-art.js`)
- `resources/tray-icon.png`

Install, progress and finish pages: `packaging/installer-pages.nsh` (each page takes the full window like Modern UI's welcome page, and the big buttons are bitmaps that send NSIS's next-page message). Sections, shortcuts and registry: `packaging/installer.nsh`. Options: `electron-builder.yml`. InstFiles uses compiler-scope `ShowInstDetails show` (not inside a Function — makensis rejects that) plus per-step `DetailPrint`. `scripts/patch-nsis-details-print.js` (from `prepare:installer`) changes electron-builder’s install section from `SetDetailsPrint none` to `both` so the file list is not a mute bar.

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

## macOS: ZIP + unsigned DMG

Per-arch `Phevere.app` (Intel x64 or Apple Silicon arm64). The Accessibility addon is compiled for the **target** arch, including cross-compile on an Intel Mac (`node-gyp rebuild --arch arm64`). Wrap with `hdiutil` (no extra npm maker — Windows lockfile unchanged):

```bash
npm run make:mac:x64     # this Intel Mac, or any x64 Mac
npm run make:mac:arm64   # Apple Silicon *or* Intel cross-compile
# App:    out/phevere-darwin-{arch}/Phevere.app
# Zip:    out/make/zip/darwin/{arch}/
# DMG:    out/make/dmg/Phevere-<version>-darwin-{arch}.dmg
```

OCR in that zip must work on a machine with **no Node, no Python, no `npm install`**. Forge's webpack plugin would otherwise pack only `/.webpack` and drop the OCR natives (`onnxruntime-node`, `sharp`, `@gutenye/*`). `scripts/packager-ignore.js` keeps those trees (and `koffi` / `sql.js`); `packagerConfig.prune` is **false** (galactus would skip nested `@img` binaries); `asar.unpackDir` unpacks them (`asarUnpack` is electron-builder-only — `@electron/packager` ignores it). The models are not packaged; the app downloads the OCR pack. Do not ignore the `node_modules` directory itself or packager never copies the packages. `@gutenye/ocr-node` is ESM: `import()` cannot load from inside `app.asar`, so it must be unpacked.

| Check | Path inside `Phevere.app` |
|---|---|
| ONNX Runtime | `Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/<arch>/onnxruntime_binding.node` |
| Gutenye | `…/app.asar.unpacked/node_modules/@gutenye/ocr-node/build/index.js` |
| sharp | `…/app.asar.unpacked/node_modules/@img/sharp-darwin-<arch>/` |

`onnxruntime-node` is pinned at **1.23.2** (last npm tarball with `darwin/x64`). Packaged Electron never falls back to the user's Python. DMGs are **unsigned** (Gatekeeper will warn until Developer ID + notarization).

```bash
npx electron-forge package --platform darwin
npm run verify:ocr-pack
```


## Linux: deb, rpm, AppImage

```bash
sudo apt install build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev \
  libglib2.0-dev libwayland-dev fakeroot rpm squashfs-tools
npm run make:linux:arm64   # or make:linux:x64
# App:      out/phevere-linux-{arch}/
# deb:      out/make/deb/{arch}/phevere_<version>_{amd64|arm64}.deb
# rpm:      out/make/rpm/{arch}/phevere-<version>-1.{x86_64|arm64}.rpm
# AppImage: out/make/AppImage/{arch}/Phevere-<version>-{arch}.AppImage
```

- The selection addon is compiled for the target arch in prePackage. An arm64 machine cross-builds x64 with `g++-x86-64-linux-gnu` and a small Ubuntu sysroot fetched by `scripts/linux-cross-sysroot.js` (no apt source changes).
- deb and rpm install `chrome-sandbox` setuid root. The rpm spec is `packaging/linux/phevere.spec.ejs` (rpm 4.20 no longer runs the install step in the BUILD dir). The desktop entry, with a **Look Up Selection** action, is `packaging/linux/phevere.desktop.ejs`.
- The AppImage starts through `phevere-appimage`, which adds `--no-sandbox` only where the kernel blocks unprivileged user namespaces (Ubuntu 24.04 AppArmor): an AppImage cannot carry a setuid sandbox.
- Linux packages ship no sharp; OCR decodes images with `nativeImage`. `verify-ocr-pack` checks the ONNX binding, the selection addon, and that every ELF file matches the arch.
- deb recommends `wl-clipboard`, `espeak-ng`, `playerctl`, `libnotify4`; none is required.
