# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Offline dictionary catalog** — Settings → Offline can download Princeton WordNet 3.1 (en→en), Webster’s Unabridged 1913 via GNU GCIDE (en→en), CC-CEDICT (zh→en), and FreeDict English–Chinese (en→zh). Current Oxford / Collegiate Webster / Collins remain API or licensed-JSON only (publisher copyright).

### Changed

- Offline pack import uses batched SQLite writes so large English dumps finish in a reasonable time.

### Fixed

- Packaged app crash on launch: `Cannot find module 'node-fetch'` — webpack now bundles `node-fetch` instead of leaving a runtime `require` that Forge does not copy into `app.asar`.
- Heart icon on the collapsed strip could wait forever for lookup; it now saves the lemma immediately and fills the notebook later.
- Offline Webster/WordNet hits were discarded when online sources hung, then the timeout string was cached for 24h. Lookups now keep local-pack defs, query inflected lemmas, and do not cache timeout stubs.

## [1.2.1] - 2026-08-12

### Added

- **Native ONNX OCR** — embedded PP-OCRv4 via `onnxruntime-node` / `@gutenye/ocr-node` (Python RapidOCR is last-resort only).
- **Pluggable OCR packs** — Settings: bundled models, download PP-OCRv5, or a custom model folder.
- **Wikipedia in-popup reader** — article opens in an in-panel `<webview>` (toolbar W removed).
- **Etymology source tabs** — vertical sidebar for multi-source etymology.
- **Installer components** — optional desktop / Start menu shortcuts and OCR models; ink/teal/ember icon and wizard art.
- **Uninstall UX** — Start menu “Uninstall Phevere”, reinforced Apps & Features entry; `scripts/remove-ghost-phevere.ps1` for stuck Program Files installs.

### Changed

- Default install path **`Program Files\Phevere`** (no author parent folder); publisher **thd2020**.
- Single Setup.exe bundles OCR models again (uncheck OCR to omit from disk).
- Vocab notebook: dictionary-style rows, collapse-on-click, lemma-safe heart save.
- Translation / etymology / notebook UI polish; quieter trial-sounding copy.
- `npm run make:win` uses npmmirror Electron mirrors by default (avoids `github.com` timeouts).

### Fixed

- Packaged vocabulary notebook wipe / sticky save failures (atomic SQLite persist, no save-on-open race).
- Missing IPA after plural→lemma pivot (e.g. vagaries / vicissitudes).
- Tray Quit leaving orphan OCR / UIA processes.
- Popup load failures on some PCs (retry + optional `.disable-gpu`).
- Packaged `sql-asm.js` resolve; OCR hover/region; CC-CEDICT lookup; shortcut hover gate; Etymonline marketing blurb; in-popup select-to-lookup / lemma links.

### Notes for users

- **Windows x64** — install with `Phevere-Setup-1.2.1-x64.exe`.
- If an older Phevere folder remains with no Apps entry, run `scripts/remove-ghost-phevere.ps1` then reinstall.
- Run elevated when you need UIAutomation across elevated / protected apps.
- Unsigned builds may trigger SmartScreen until code signing is configured.

## [1.2.0] - 2026-08-07

### Added

- **Vocabulary notebook** — local SQLite (sql.js) Anki-light store; red heart on the popup toolstrip to save/unsave the current lemma.
- **Offline dictionary packs** — Settings → Offline: consent download of CC-CEDICT, or import JSON/JSONL / CEDICT text; optional `resources/seed/` import on first run.
- **Definition sense merging** — near-identical glosses across Datamuse / Free Dictionary / Wiktionary collapse into one sense with multi-source cite badges.
- **NSIS Setup.exe** — customizable electron-builder installer (directory chooser, shortcuts, branding) as the primary Windows distributable.

### Changed

- **Smart source routing** — CJK → Youdao / CEDICT / offline; Latin → Free Dictionary / Wiktionary / Datamuse; translation prefers Youdao (CJK) or DeepL (Latin) when keyed.
- **Translation tab** — confidence score hidden; tighter type and action sizing.
- **Wikipedia tab** — thumbnails fetched in the main process as data URLs; REST summary uses page titles (fixes broken image placeholders).
- **Packaging** — `sql.js` / `sql-wasm.wasm` and seed folder shipped with the installer; live DB remains under `%APPDATA%`.

### Fixed

- Dual-monitor popup placement (nearest display workArea).
- NSIS build: proper `.ico` icons; installer.nsh comment that NSIS treated as a fatal warning.
- `electron` kept only in `devDependencies` for electron-builder metadata checks.

### Notes for users

- **Windows x64** — install with `Phevere-Setup-1.2.0-x64.exe` (assisted wizard).
- Run elevated when you need UIAutomation across elevated / protected apps.
- Unsigned builds may trigger SmartScreen until code signing is configured.

## [1.1.0] - 2026-07-24

### Added

- Multi-pattern UIA fallback chain (DirectUI / MSAA / edit controls).
- Synthetic copy mouse fallback for canvas PDF readers.
- Non-destructive clipboard bridge during synthetic copy.

### Changed

- Proxy-aware `net.fetch` for dictionary / translation pipelines.

## [1.0.0] - 2026-03-24

### Added

- Electron app with dictionary popup, Google Translate integration, Wikipedia and search links, clipboard history.
- Windows text selection via Microsoft UI Automation (native addon) with debounced selection handling.
- Global shortcuts, monitor/selection modes, and settings UI (including shortcut trigger behavior).
- Windows installer as **WiX MSI** (`npm run make` / `make:win`); see `PACKAGING.md`.
- `koffi`-based physical key state for shortcut mode; `asarUnpack` so the addon loads in packaged builds.

### Changed

- Replaced Squirrel with WiX MSI for Windows distribution.

### Notes for users

- **Windows x64**, **run elevated** when using UIAutomation across the desktop (see README).
- Install from the release asset; no separate Node.js install required.

[Unreleased]: https://github.com/thd2020/phevere/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/thd2020/phevere/releases/tag/v1.2.1
[1.2.0]: https://github.com/thd2020/phevere/releases/tag/v1.2.0
[1.1.0]: https://github.com/thd2020/phevere/releases/tag/v1.1.0
[1.0.0]: https://github.com/thd2020/phevere/releases/tag/v1.0.0
