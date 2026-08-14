# Phevere Dictionary

Select-to-lookup dictionary for Windows (Electron + Microsoft UI Automation). Select text anywhere → popup with definitions, translation, etymology, Wikipedia, and a local vocabulary notebook.

Publisher: **[thd2020](https://github.com/thd2020)**.

## Download (Windows)

Prebuilt **NSIS Setup** (`Phevere-Setup-<version>-x64.exe`) is on [GitHub Releases](https://github.com/thd2020/phevere/releases). No Node.js required for end users.

| | |
|---|---|
| Default install path | `C:\Program Files\Phevere` (per-machine; no author parent folder) |
| Optional components | Desktop shortcut, Start menu shortcut, OCR models (~15 MB, on by default) |
| Uninstall | **Settings → Apps → Phevere**, or Start menu → **Uninstall Phevere** |
| Single instance | A second launch focuses the existing app (avoids SQLite / tray conflicts) |

Maintainer packaging: [`PACKAGING.md`](PACKAGING.md) · release checklist: [`docs/RELEASE.md`](docs/RELEASE.md).

### Ghost / stuck installs

If an older Phevere folder remains under Program Files but **Apps & Features no longer lists it**, clean it then reinstall:

```powershell
# Elevated PowerShell, from a clone of this repo:
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\remove-ghost-phevere.ps1
# Optional: also wipe vocabulary DB / settings
.\scripts\remove-ghost-phevere.ps1 -AlsoUserData
```

Then run the latest Setup.exe. New installs register a proper uninstaller (`Uninstall Phevere.exe`) and an Apps & Features entry (publisher **thd2020**).

## Features

- **Native text selection** — UIAutomation (best as Administrator); shortcut / hover / OCR modes in Settings
- **Dictionary & translation** — Free Dictionary, Wiktionary, Datamuse, Youdao / DeepL routing; CJK ↔ English
- **Offline packs** — Settings → Offline: WordNet, Webster 1913 (GCIDE), CC-CEDICT, FreeDict en→zh (consent download); JSON/CEDICT import. Living Oxford / Collegiate Webster / Collins are not dumped (copyright).
- **Etymology & Wikipedia** — in-popup tabs; Wikipedia reader webview
- **Vocabulary notebook** — local SQLite (`%APPDATA%\phevere`)
- **OCR** — bundled PP-OCRv4 models (optional component); region / hover / clipboard / window capture
- **Tray app** — Quit tears down UIA / OCR cleanly; main window can hide to tray

## Development

### Prerequisites

- Node.js 18+ recommended  
- Visual Studio 2022 (C++ workload) for the native UIA addon  
- Windows 10/11  

### Setup

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm run build-native
npm start
# Full selection monitoring:
npm run start-admin
```

### Build the installer

```bash
npm run build-native
npm run make:win
# → out\make\nsis\x64\Phevere-Setup-*-x64.exe
```

`make:win` uses npmmirror Electron mirrors by default (avoids `github.com` `ETIMEDOUT` on some networks).

### Tray Quit vs terminal (dev only)

Tray **Quit Phevere** exits Electron. The Forge webpack terminal may keep running until **Ctrl+C** — normal in development. Packaged builds have no separate webpack process.

## Architecture (short)

```
Selection / OCR / shortcut → main process → popup renderer
                              ↓
                     dictionary + local SQLite + OCR engine
```

Native addon: `native-addon/` (UIAutomation). Packaging: Electron Forge + electron-builder NSIS (`electron-builder.yml`, `packaging/installer.nsh`).

## License

MIT © thd2020 — see [`LICENSE`](LICENSE).
