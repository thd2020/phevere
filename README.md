<div align="center">

<img src="README.assets/phevere-icon.png" width="96" alt="The Phevere icon: a forward-leaning lowercase p with a plum stem and a hollow mint bowl">

<h1>Phevere</h1>

<p>Select a word in any app and look it up where you are reading. Keep it, and learn it.</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[Download](https://github.com/thd2020/phevere/releases/latest) · [Changelog](CHANGELOG.md) · [Documentation](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Screenshots of the Android app: a lookup of serendipity, Scan with a selected word, and Capture settings">

</div>

## About

Phevere is a dictionary for text you are already reading. Select a word in a browser, a PDF or any other application, and a lookup opens beside it with definitions, pronunciation, translation, etymology and Wikipedia. Words you save go into a local notebook, where word books, a daily quiz and maps of shared roots help you learn them. It runs as a tray app on Windows, macOS and Linux, and as a phone app on Android and iOS, all built on one dictionary core.

Version 4.1.0 adds updates from inside the app on the desktop and Android, search suggestions, a picture for each meaning that has one, and pages for prefixes, suffixes and roots. See [what's new](CHANGELOG.md).

## Features

**Lookup**

- Definitions from Free Dictionary, Wiktionary and Datamuse, merged into one entry with the commonest senses first
- Pictures from Wikimedia Commons beside the meanings they show: "crane" gets the bird and the machine
- Word forms, and a form such as "children" or "gleaned" that opens its headword, as learner dictionaries do
- US and UK pronunciation, recorded audio where it exists, and optional neural voices
- Translation through Google Translate and MyMemory, or Youdao and DeepL with your own keys
- Etymology from Wiktionary, Etymonline and Youdao, and pages for prefixes, suffixes and roots
- Search suggestions ranked by how common a word is, and "Did you mean" for a word with no entry
- Offline packs: WordNet, Webster 1913, CC-CEDICT, JMdict and FreeDict for twelve languages
- Other languages through Jisho, OpenRussian and kaikki.org ([languages and sources](docs/MULTILINGUAL.md))

**Words and Learn**

- My words, plus graded word books from primary school to CET-6, 考研, TOEIC and Business English ([sources](docs/WORDBOOKS.md))
- Each saved word remembers the web page, PDF page or app you met it in
- Four views of any list: List, Families by root and origin, a 3D Map and Cards
- A daily quiz scheduled with FSRS, whose questions get harder as a word sticks ([how it works](docs/REVIEW.md))
- Progress charts for your goal, streak, upcoming reviews and retention
- Word books that export to one file, and Anki decks in both directions ([format](docs/BOOK_FORMAT.md))
- Optional sync of words and books with a free Holarky account ([account](docs/ACCOUNT.md))

**On each platform**

- Desktop: select-to-lookup in other apps, OCR for text you cannot select, and a translate-in-place shortcut
- Android: Phevere on the text-selection bar, a lookup that floats over the current app, and Scan for photos
- iOS: share text to Phevere, and Scan for photos

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Screenshots of the phone app: a Learn question, the Progress page, the word-book library and Families grouped by origin">
<p><sub>A Learn question, Progress, the word-book library, and Families grouped by origin.</sub></p>
</div>

## Download

Every file is on the [latest release](https://github.com/thd2020/phevere/releases/latest).

| Platform | File | Requires |
|---|---|---|
| Windows x64 | `Phevere-Setup-<version>-x64.exe` | Windows 10 |
| Windows ARM64 | `Phevere-Setup-<version>-arm64.exe` | Windows 11 |
| macOS Apple silicon | `Phevere-<version>-darwin-arm64.dmg` | macOS 11 |
| macOS Intel | `Phevere-<version>-darwin-x64.dmg` | macOS 11 |
| Debian, Ubuntu | `phevere_<version>_amd64.deb`, `_arm64.deb` | Ubuntu 22.04 |
| Fedora, openSUSE | `phevere-<version>-1.x86_64.rpm`, `.arm64.rpm` | glibc 2.35 |
| Other Linux | `Phevere-<version>-x64.AppImage`, `-arm64.AppImage` | glibc 2.35 |
| Android | `Phevere-<version>-android.apk` | Android 7.0 |
| iOS | `Phevere-<version>-ios-unsigned.ipa` (sign it yourself) | iOS 15.1 |

The builds are not code-signed, so SmartScreen and Gatekeeper ask once on first launch ([code signing](docs/CODE_SIGNING.md)). Hover lookup and Scan need the 14 MB OCR pack, which you install from **Settings → Capture**.

On macOS, open Phevere with right-click → **Open** the first time and grant Accessibility and Screen Recording ([macOS notes](docs/MACOS_SELECTION.md)). On GNOME Wayland, bind `phevere --lookup-selection` to a keyboard shortcut ([Linux notes](docs/LINUX_SELECTION.md)). The optional LSPosed module for rooted Android phones is described in [ANDROID.md](apps/mobile/ANDROID.md).

## Updates

Phevere checks GitHub Releases every six hours and verifies each download against its SHA-256 checksum. **Settings → Updates** has three modes: Automatically (the default), Ask first and Off.

- **Windows and AppImage** install the update when Phevere quits. **Roll back** returns to the previous release after backing up your notebook.
- **macOS, deb and rpm** tell you about a new version and open its download page.
- **Android** downloads on Wi-Fi and opens the system install prompt for you to confirm. It has no rollback, because Android needs an uninstall to go back a version.

## Privacy

Your notebook and settings stay on your device. Lookups go only to the sources you have enabled, password fields are never read, and private browser windows are never recorded. With a Holarky account, your words sync through the Holarky service until you delete the account ([privacy policy](https://holarky-api.thdfreelancer.workers.dev/privacy)).

## Building from source

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

You need Node.js 18 or later, plus a C++ toolchain for the selection addon: Visual Studio 2022 on Windows, Xcode Command Line Tools on macOS, and on Linux `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`. The `npm run make:*` scripts build installers ([packaging](PACKAGING.md)), and `npm run mobile:dev` runs the phone app in a browser ([mobile](docs/MOBILE.md)). Pushing a new version to `main` publishes a release ([releasing](docs/RELEASE.md)).

| Path | Contents |
|---|---|
| [`packages/core`](packages/core) | Dictionary sources, notebook and sync, shared by every platform |
| [`src`](src) | Desktop app (Electron) |
| [`native-addon`](native-addon) | Selection capture on Windows, macOS and Linux |
| [`apps/mobile`](apps/mobile) | Phone app and its Android and iOS projects |
| [`docs`](docs) | Platform notes and design documents |

## License

[MIT](LICENSE). The names Phevere, Holarky and knowrld and their logos are not covered; see [TRADEMARKS.md](TRADEMARKS.md). The apps bundle eSpeak NG under GPL-3.0-or-later ([terms](apps/mobile/ANDROID.md)), and the sense-frequency table is derived from Princeton WordNet 3.1 under the WordNet licence.
