<div align="center">

**English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

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

Phevere is a dictionary that works wherever you read. Select a word in any app to see its meaning, pronunciation, translation and history, then save it to learn later. It runs on Windows, macOS, Linux, Android and iOS.

## Features

**Look up**

- Definitions, pictures, pronunciation, translation, word history and Wikipedia in one place
- American and British pronunciation, with extra voices to download
- Translation with Google Translate, MyMemory, Youdao or DeepL
- Word forms, and pages for prefixes, suffixes and roots
- Suggestions as you type
- Offline dictionaries for sixteen languages
- Definitions for words in many languages besides English ([languages](docs/MULTILINGUAL.md))

**Learn**

- Word books from primary school to CET-6, 考研, TOEIC and Business English ([book list](docs/WORDBOOKS.md))
- Saved words remember where you found them
- Word families, a word map and flash cards
- A daily review with spaced repetition ([how it works](docs/REVIEW.md))
- Progress charts
- Import and export with Anki ([file format](docs/BOOK_FORMAT.md))
- Sync across your devices with a free account ([account](docs/ACCOUNT.md))

**On your device**

- Computer: look up selected text in any app or words inside images, and translate selected text in place
- Android: look up from the text-selection menu in any app, and scan words from photos
- iOS: look up from the Share menu, and scan words from photos

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Screenshots of the phone app: a review question, the progress page, the word-book library and word families">
<p><sub>Review, progress, word books and word families.</sub></p>
</div>

## Download

Get Phevere from the [latest release](https://github.com/thd2020/phevere/releases/latest). It needs Windows 10, macOS 11, Ubuntu 22.04 or Fedora 36, Android 7.0, or iOS 15.1 or later. The iOS app has to be signed with your own Apple account before it installs.

Windows and macOS show a warning the first time you open Phevere; choose to run it anyway. Setup notes: [macOS](docs/MACOS_SELECTION.md), [Linux](docs/LINUX_SELECTION.md), [Android](apps/mobile/ANDROID.md).

## Updates

Phevere updates itself. In **Settings → Updates**, choose Automatically, Ask first or Off.

- Windows and AppImage install the update when you quit Phevere, and **Roll back** returns to the previous version.
- macOS, deb and rpm open the download page of the new version.
- Android downloads the update on Wi-Fi and asks you to confirm the install.

**Settings → About** shows the version you have, what is new, and where to report a problem.

## Privacy

Your words and settings stay on your device unless you sign in to sync them. Phevere never reads password fields or records private browser windows. See the [privacy policy](https://holarky-api.thdfreelancer.workers.dev/privacy).

## Building from source

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

You need Node.js 18 or later, plus a C++ toolchain for the native module: Visual Studio 2022 on Windows, Xcode Command Line Tools on macOS, and on Linux `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`. The `npm run make:*` scripts build installers ([packaging](PACKAGING.md)), and `npm run mobile:dev` runs the phone app in a browser ([mobile](docs/MOBILE.md)). Pushing a new version to `main` publishes a release ([releasing](docs/RELEASE.md)).

| Path | Contents |
|---|---|
| [`packages/core`](packages/core) | Dictionary sources, notebook and sync, shared by every platform |
| [`src`](src) | Desktop app (Electron) |
| [`native-addon`](native-addon) | Selection capture on Windows, macOS and Linux |
| [`apps/mobile`](apps/mobile) | Phone app and its Android and iOS projects |
| [`docs`](docs) | Platform notes and design documents |

## License

[MIT](LICENSE). The names Phevere, Holarky and knowrld and their logos are not covered; see [TRADEMARKS.md](TRADEMARKS.md). Dictionary text from Wiktionary and Wikipedia is under CC BY-SA 4.0. The apps bundle eSpeak NG under GPL-3.0-or-later ([terms](apps/mobile/ANDROID.md)), and the sense-frequency table is derived from Princeton WordNet 3.1 under the WordNet licence. **Settings → About** lists every data source and its licence.

If Phevere helps you, a [star on GitHub](https://github.com/thd2020/phevere) helps other people find it.
