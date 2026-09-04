# Phevere Dictionary

**2026-09-04:** Hover/OCR lookup follows the cursor on HiDPI displays. Toolbar 🔊 caches recorded clips on disk. Lexicon chips abbreviate only long POS (adj., adv.); noun/verb and pane headings stay full. Rail tabs in one card are a glued chip with thin hairlines.

**2026-09-04:** Lexicon rail and definitions each scroll in the pane under the headword (visible rail scrollbar). Thick rule between noun/verb/… is back inside the lexicon card.

**2026-09-04:** Toolbar 🔊 plays a recorded clip (Free Dictionary or Wiktionary Commons). IPA chips use a persistent Windows speech host so they actually speak.

**2026-09-04:** **1.5.0** — Windows x64/ARM64 Setup and macOS Intel/Apple Silicon DMGs ship from the same GitHub tag. Mac OCR/read-window/now-playing/shortcuts match Windows (Screen Recording + Accessibility). Notebook chips show the dictionary gloss language (`en → en` for English senses). The Translation tab honours From/To. Popup 🌐 is gone; the gear no longer shrinks the panel. Hover OCR uses one probe for every PP-OCR pack.

**2026-09-03:** Translation engines live in Settings → Sources (not chips on the lookup). The translation tab is a language pair (detect, swap, target) with a speaker on source and target. Lookup works inside Settings and the notebook the same as in other apps. Tray Settings no longer raises the main window. Selection beats hover OCR.

Select-to-lookup dictionary for Windows (Electron + Microsoft UI Automation), macOS (Accessibility), and **Android / iOS** (Capacitor). On the desktop, select text anywhere → popup with definitions, translation, etymology, Wikipedia, and a local vocabulary notebook. On phones, use **Process Text** (Android), **Share** (iOS), or in-app search — same lookup core.

Publisher: **[thd2020](https://github.com/thd2020)**.

## Download (Windows)

Prebuilt **NSIS Setup** (`Phevere-Setup-<version>-x64.exe` or `…-arm64.exe` on Snapdragon / Windows 11 ARM) is on [GitHub Releases](https://github.com/thd2020/phevere/releases). No Node.js required for end users.

| | |
|---|---|
| Default install path | `C:\Program Files\Phevere` (per-machine; no author parent folder) |
| Optional components | Desktop shortcut, Start menu shortcut, OCR models (~15 MB, on by default) |
| Uninstall | **Settings → Apps → Phevere**, or Start menu → **Uninstall Phevere** |
| Single instance | A second launch focuses the existing app (avoids SQLite / tray conflicts) |
| SmartScreen | Public trust needs a CA (or SignPath OSS), not a homemade cert — [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md) |

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

## Download (macOS)

Unsigned **DMGs** (`Phevere-<version>-darwin-x64.dmg` for Intel, `…-darwin-arm64.dmg` for Apple Silicon) are on the same [GitHub Releases](https://github.com/thd2020/phevere/releases) page. Open the disk image, drag **Phevere** to Applications. macOS Gatekeeper will warn until the app is signed and notarized. Right-click → Open the first time, or allow it under Privacy & Security. Enable **Accessibility** (select-to-lookup) and **Screen Recording** (hover / region / window OCR) when asked. Tray → **Open Accessibility Settings…** / **Open Screen Recording Settings…**.

## Download (Android / iOS)

Phone builds are **not** on GitHub Releases yet. Sideload from a clone: Android Studio / `gradlew assembleDebug`, or Xcode on a Mac. There is no global overlay on iOS; Android shows **Phevere** in the system text-selection toolbar. See [`docs/MOBILE.md`](docs/MOBILE.md).

## Features

- **Native text selection (desktop)** — UIAutomation on Windows (best as Administrator). After a drag/double-click: TextPattern first, then a Chromium UIA poke (`WM_GETOBJECT`) and retry, then silent Ctrl+C if the app still exposes no selected text (Cursor agent chat, some VS Code webviews). Password fields are skipped; Phevere does not Ctrl+C into its own windows. On macOS, Accessibility first (including Chromium text-markers), then Safari/Chrome AppleScript, then a silent Cmd+C. Shortcut / hover / OCR modes in Settings. Select in the notebook, Settings, a lookup, or any other app — same path. If hover and selection are both on, a live selection wins and hover will not OCR. A second selection (even before the first popup finishes loading) follows the latest text and position. After following a word-family or wiki link, **Back / Forward** on the dictionary tab (and the mouse extra buttons) restore the previous lookup.
- **Phone capture** — Android **Process Text** (Phevere in the selection toolbar) and iOS **Share** / `phevere://lookup?q=` plus in-app search. No Accessibility overlay on Android v1; iOS cannot host a global overlay. Camera OCR and offline pack install are not in the mobile v1.
- **Dictionary & translation** — Free Dictionary, Wiktionary, Datamuse; translation Auto uses Google (no key) then MyMemory (no key), then Youdao / DeepL if you add keys. Pick the engine in Settings → Sources. The **Translation** tab is any listed pair (detect, swap, target): en, zh, ja, ko, es, fr, de, it, pt, ru, ar, hi, th. Lexicon is a dictionary in the headword’s language (English words stay English senses), not a bilingual matrix. Looks up the **exact form** you selected (IPA and notebook save stay on that form). Headword/lemma senses are used only when every source has no definition for that form. Lexicon **part-of-speech** is a left rail of **vertical** tabs grouped in **cards** (one card per block: POS together, family relations together). Tabs in a card are one glued chip with a thin hairline between them. Rail chips abbreviate only long POS (**adj.**, **adv.**, **prep.**, …); **noun** and **verb** stay full. Headings in the main pane are always the full part of speech. Click a tab to jump. The rail and the stacked senses each scroll in the pane below the headword. Noun/verb/… **senses** in the lexicon card are divided by a thick rule. The toolbar speaker plays a recorded clip (Free Dictionary MP3 or Wiktionary Commons) and keeps the file under `%APPDATA%\phevere\pronunciation-cache` so the next play is instant. Each US / UK IPA chip has a speaker that synthesizes **that transcription**. Word-family chips can carry a small POS banner (verb, adj.) — grammar labels are not treated as extra forms. Per-source cache (timeouts retry).
- **Offline packs** — Settings → Offline: WordNet, Webster 1913 (GCIDE), CC-CEDICT, FreeDict en→zh (consent download); JSON/CEDICT import. Living Oxford / Collegiate Webster / Collins are not dumped (copyright).
- **Etymology & Wikipedia** — in-popup tabs; Wikipedia reader webview
- **Vocabulary notebook** — local SQLite (`%APPDATA%\phevere`); lemma-only saves fill in the background; IPA + play; search; **Recent / A–Z** sort with an A–Z index scrubber; **Export / Import** (JSON or CSV); language chip is lemma → gloss (`en → en` when the saved sense is English); click the headword row to expand, select text in the definition without collapsing
- **OCR** — bundled PP-OCRv4 (optional component); Settings can download PP-OCRv5 (needs `ppocrv5_dict.txt`, not the v4 keys file). Region / hover / clipboard / window capture. Hover OCR picks the word under the cursor from detection boxes (glyph height), not a fixed pixel square. Packaged builds crop in the thumbnail’s real pixel space so image OCR does not insert spaces between letters.
- **Tray app** — Quit Phevere tears down UIA / OCR / sql.js before destroying windows (no leftover Electron helpers). Left-click the tray icon to show the notebook; right-click for the menu (Settings does not also raise the notebook). On macOS, left-click the menu-bar **P** to show the window; right-click for the menu.
- **Win11 / macOS chrome** — Mica/Acrylic on a **light** paper UI (does not follow Windows dark app theme); durable windows use the native caption overlay (Windows) or traffic lights (macOS). NSIS wizard uses Segoe UI + branded 24-bpp sidebar BMP

## Development

### Prerequisites

- Node.js 18+ recommended  
- **Windows:** Visual Studio 2022 (C++ workload) for the UIA addon; Windows 10/11  
- **Android / iOS:** JDK 21 + Android Studio, or Xcode on a Mac — [`docs/MOBILE.md`](docs/MOBILE.md) 

### Setup

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
# Full selection monitoring:
npm run start-admin
# Phone web UI:
npm run mobile:dev
```

### Build the installer

```bash
npm run build-native
npm run make:win
# → out\make\nsis\x64\Phevere-Setup-*-x64.exe
# ARM64 host (or `npm run make:win:arm64` with VS ARM64 tools):
# → out\make\nsis\arm64\Phevere-Setup-*-arm64.exe
```

`make:win` uses npmmirror Electron mirrors by default (avoids `github.com` `ETIMEDOUT` on some networks). `npm install` uses `.npmrc` `electron_mirror` plus `scripts/ensure-electron.js` (curl) for the runtime. `npm start` re-runs that extract if `path.txt` is missing after a cancelled install. If Electron’s postinstall still hangs: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`.

CI: `.github/workflows/ci.yml` on every PR and `main` (Windows package; macOS OCR native pack on Intel and Apple Silicon — both upload unpackaged artifacts). CD: push an annotated tag `v*.*.*` → `.github/workflows/release.yml` makes Windows x64/ARM64 Setup.exe and macOS Intel/Apple Silicon DMGs, creates the GitHub Release, and attests each file (Windows unsigned unless `CSC_LINK` is set; Mac DMGs unsigned). See [`docs/RELEASE.md`](docs/RELEASE.md).

### Tray Quit vs terminal (dev only)

In the `npm start` terminal, **Ctrl+C** once stops Electron and Forge’s webpack process. Tray **Quit Phevere** exits Electron, which also tears down that terminal. Packaged builds have no separate webpack process.

## Architecture (short)

```
Selection / OCR / shortcut (desktop)  →  Electron main  →  popup renderer
Share / Process Text / search (mobile) →  Capacitor WebView
                              ↓
                     packages/core (dictionary + vocab SQLite)
```

Shared lookup: [`packages/core`](packages/core). Desktop native addon: `native-addon/` (UIAutomation / AX). Packaging: Electron Forge + electron-builder NSIS (`electron-builder.yml`, `packaging/installer.nsh`). Mobile: Capacitor in [`apps/mobile`](apps/mobile) — [`docs/MOBILE.md`](docs/MOBILE.md).

## License

MIT © thd2020 — see [`LICENSE`](LICENSE).
