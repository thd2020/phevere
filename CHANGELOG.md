# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Draft **macOS** selection backend (Accessibility + CGEvent tap) on the same `{ text, x, y }` path as Windows UIA. Compile on a Mac (`npm run build-native`). Untrusted Accessibility opens a one-click **Open Accessibility Settings** dialog (and a tray item); lookup starts when the toggle is on. See [`docs/MACOS_SELECTION.md`](docs/MACOS_SELECTION.md).
- Lexicon **Phrases** row in Word family: multi-word derived terms (idioms, collocations) sit apart from single-word derivatives, with phrase/idiom banners instead of fake POS tags.

### Fixed

- `npm start` on macOS/Linux no longer dies on Windows-only `chcp 65001` (UTF-8 console is still set on Windows).
- Expanded lookup width hugs the Back/Forward + tab row (no leftover strip after Etymology). Horizontal resize works again; the previous min-size used the window’s own width and locked it. Narrowing the window wraps Lexicon / Translation / Wikipedia / Etymology onto extra rows instead of clipping them.
- `npm install` hanging on Electron’s silent GitHub/`got` fetch: `.npmrc` `script-shell` sets `ELECTRON_SKIP_BINARY_DOWNLOAD`; `scripts/ensure-electron.js` curls the zip. `npm start` restores `path.txt`/`dist` after a Ctrl+C’d install.
- Word-family **Derived** chips now get POS banners (suffix + citation-form guess). Multi-word items move to **Phrases**.
- macOS AX addon compiles on the current SDK (`AXValueType` vs `kAXValueCGRectType` UInt32).

## [1.4.0] - 2026-08-19

### Added

- Lexicon **Word family** section: inflections, alternative/derived/related terms, affixes, and roots as in-app links (Wiktionary headings + affix templates). Related forms are not mixed into definitions. POS labels such as “verb form” sit as small banners on the chip, not as fake headwords.
- Dictionary lookup **Back / Forward** on the lexicon tab, plus mouse extra buttons (and Alt+← / Alt+→).

### Changed

- Lookup policy lives in one module (`lookup-policy.ts`): exact form first, lemma only if every source is empty, one grammatical form-of test, notebook save key is the queried form. IPA, etymology, and family share a single Wiktionary wikitext fetch.
- Dictionary tab: headword, senses, examples, synonyms/antonyms, and word family are separate cards. The old “N senses · Source · Source” title line is gone (POS headings and per-sense source badges remain). Pronounce / Search Web on those cards are omitted — they already live on the toolstrip.
- Etymology tab matches the same paper cards (no black title bar, nested grey panel, or extra “Etymology” heading). Translation cards no longer duplicate the toolstrip Web button.

### Fixed

- Inflected lookups such as **tantalizing** no longer mix in verb senses, IPA, or notebook saves for the lemma **tantalize**. The card, pronunciation, and Save stay on the exact form; the headword is used only when every source has no sense for that form. Wiki form-of links still look up the linked word on their own.
- A quick second selection (wrong word, then the right one) follows the latest text: the in-flight strip is retargeted, `popup-text` is not dropped while the page is still loading, a late `getLastSelection` cannot overwrite a newer word, and a distinct correction is not held behind another 500ms native debounce.
- Following a word-family chip or form-of link no longer traps you with no way back; Chromium page history no longer swallows mouse extra keys.
- Expanded lookup grows to fit **Back / Forward** plus all tabs, so Etymology is not clipped off the 400px row.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.4.0-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.4.0) (Actions). SHA-256 `9822C0A9…560AF8`. Still unsigned; SmartScreen may warn. Signing options: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.3.1] - 2026-08-19

### Changed

- Installer wizard uses **2×** sidebar/header bitmaps, **white** page paper (not XP grey), and HALFTONE stretch so Win11 HiDPI no longer pixelates the P-mark pane.

### Fixed

- **Quit Phevere** (tray / taskbar menu) no longer races `app.quit()` when windows close — UIA, OCR, and sql.js tear down first so Chromium helper processes do not linger.
- Windows 11 **dark app theme** no longer paints Mica/Acrylic near-black under dark text — Phevere stays on its light paper UI.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.3.1-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.3.1) (Actions). Still unsigned; SmartScreen may warn. Signing options: [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md).
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.3.0] - 2026-08-18

### Added

- Notebook: **Recent / A–Z** sort, A–Z index scrubber (tap or slide, large letter HUD), and **Export / Import** (JSON or CSV).
- GitHub Actions: `ci.yml` packages on PR/`main`; `release.yml` builds unsigned NSIS Setup on `v*` tags, uploads the GitHub Release, and attests the exe. Optional `CSC_LINK` / `CSC_KEY_PASSWORD` secrets sign the installer.

### Changed

- Settings window opens at **800×600** (same as the main window), with tighter grouped rows and a centered switch thumb.
- Settings shortcuts render as **keycap chips**, not a monospace string.
- Main window content uses the full width; notebook/recent lists leave a gap before the window scrollbar.
- App titlebar uses the stylized **P** mark (not the old magnifying glass).
- Open from notebook / recent uses the same floating lookup as a selection (always-on-top, click outside to close).
- Inflected lookups deinflect once (wink + content-namespace “plural of X”) instead of following the first Wiktionary `/wiki/` link.

### Fixed

- Installer sidebar no longer cover-crops the old splash PNG (blur/warp). Inner wizard pages use a light header bitmap instead of a navy slab that read as black.
- Expanding a notebook card and selecting definition text no longer collapses the card — only the lemma / IPA / POS / timestamp row toggles.
- Etymology / translation tabs show a progress bar while sources are still in flight; a 502 from Etymonline no longer discards Wiktionary etymology.
- Looking up **tribulations** no longer jumps to **Appendix:Glossary**.
- Unsigned GitHub Actions tag builds no longer fail Authenticode when `CSC_LINK` is an empty secret.

### Notes for users

- **Windows x64** — `Phevere-Setup-1.3.0-x64.exe` from [GitHub Releases](https://github.com/thd2020/phevere/releases/tag/v1.3.0) (built by Actions). Unsigned unless `CSC_LINK` is set; SmartScreen may warn.
- Run elevated when you need UIAutomation across elevated / protected apps.

## [1.2.2] - 2026-08-18

### Added

- **Offline dictionary catalog** — Settings → Offline can download Princeton WordNet 3.1 (en→en), Webster’s Unabridged 1913 via GNU GCIDE (en→en), CC-CEDICT (zh→en), and FreeDict English–Chinese (en→zh). Living Oxford / Collegiate Webster / Collins stay API or licensed-JSON only (publisher copyright).
- Per-source lookup cache (timeouts retry) and US + UK IPA when sources provide them.
- Vocab notebook: IPA + play control, search, listed above Recent selections; empty cards fill from a **background lookup queue**.
- Win11/Fluent window chrome (Mica/Acrylic where the OS supports it); sticky titlebars; Authenticode hook via `CSC_LINK`.

### Changed

- Offline pack import uses batched SQLite writes; live lookup overlaps local packs with network APIs.
- First paint returns local-pack defs in ~0.5s instead of waiting out translation/etymology timeouts (~7.5s).
- Lookup panel inset (36px toolbar, 12px results) so chrome does not clip the lemma.
- Select-to-lookup in the main window or an open lookup matches selecting elsewhere: a **toolstrip** appears. An expanded lookup stays put; a second strip opens beside it.

### Fixed

- Packaged launch `Cannot find module 'node-fetch'` — webpack now bundles it into `app.asar`.
- Hung / frozen lookup: `node-fetch` timeouts, safe `Promise.race`, sql.js off the main thread, UIA native addon out of preload, popup webpack no longer pulled in main-window CSS, duplicate `const` that stopped the popup script from parsing.
- Heart icon on the collapsed strip no longer waits forever; lemma saves immediately and the notebook fills later.
- Offline Webster/WordNet hits were dropped when online sources hung, then timeout stubs were cached for 24h.
- Notebook Open rows stayed empty; POS tags like GCIDE `n` / `v. t.` now merge with WordNet / Free Dictionary.
- Punctuated selections (`hello,`) no longer flicker to “no definition”; worse updates cannot replace a better card.
- Looking up `fluff` jumped to `roleplaying` (greedy Wiktionary “a form of”). Grammatical form-of only, and only when that is the first sense.
- Notebook “IPA pending” after the panel already had pronunciation; recovered IPA is patched into existing rows.
- In-app selection ignored Off/Shortcut monitor mode.
- Installer left pane blank (PNG bytes named `.bmp`); `MUI_BGCOLOR already defined`; several `make:win` TypeScript compile breaks.
- Tray Exit left a ghost icon and leftover processes; Etymonline entries truncated at OpenGraph “…”.
- Window Close stayed reachable while content scrolls.

### Notes for users

- **Windows x64** — install with `Phevere-Setup-1.2.2-x64.exe`.
- If an older Phevere folder remains with no Apps entry, run `scripts/remove-ghost-phevere.ps1` then reinstall.
- Run elevated when you need UIAutomation across elevated / protected apps.
- Unsigned builds may trigger SmartScreen until an OV/EV `CSC_LINK` cert is used.

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

[Unreleased]: https://github.com/thd2020/phevere/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/thd2020/phevere/releases/tag/v1.4.0
[1.3.1]: https://github.com/thd2020/phevere/releases/tag/v1.3.1
[1.3.0]: https://github.com/thd2020/phevere/releases/tag/v1.3.0
[1.2.2]: https://github.com/thd2020/phevere/releases/tag/v1.2.2
[1.2.1]: https://github.com/thd2020/phevere/releases/tag/v1.2.1
[1.2.0]: https://github.com/thd2020/phevere/releases/tag/v1.2.0
[1.1.0]: https://github.com/thd2020/phevere/releases/tag/v1.1.0
[1.0.0]: https://github.com/thd2020/phevere/releases/tag/v1.0.0
