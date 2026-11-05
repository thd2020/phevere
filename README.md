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

Phevere is a dictionary for whatever you are reading. Select a word in a web page, a PDF or any other app, and its meaning appears right beside it, with pronunciation, translation, word history and Wikipedia. Save the words you want to keep, and Phevere helps you learn them with word books, a short daily review and maps of related words. It runs on Windows, macOS, Linux, Android and iOS.

Version 4.1.0 keeps itself up to date, suggests words as you type, shows pictures for more meanings, and lets you look up prefixes, suffixes and roots. See [what's new](CHANGELOG.md).

## Features

**Look up**

- Clear definitions with the most common meanings first
- Pictures for things you can see: "crane" shows both the bird and the machine
- Every form of a word, such as plurals and past tenses; looking up "gleaned" takes you to "glean"
- American and British pronunciation, with recordings where they exist and natural-sounding voices you can download
- Translation with Google Translate or MyMemory, or with Youdao or DeepL if you have a key
- Word histories, and pages for prefixes, suffixes and roots such as "ob-" or "-ant"
- Suggestions as you type, and "Did you mean…" when a word is misspelled
- Offline dictionaries for English, Chinese, Japanese, Korean and twelve other languages
- Definitions for words in many languages besides English ([supported languages](docs/MULTILINGUAL.md))

**Learn**

- Graded word books from primary school to CET-6, 考研, TOEIC and Business English ([book list](docs/WORDBOOKS.md))
- Each saved word remembers where you found it: the web page, the PDF page or the app
- Your words grouped into families that share a root, laid out as a 3D map, or dealt out as cards
- A daily review that brings each word back before you forget it, with questions that get harder as you learn ([how it works](docs/REVIEW.md))
- Charts of your daily goal, your streak, the reviews ahead and how much you remember
- Move a word book and its progress to another device, or swap decks with Anki ([file format](docs/BOOK_FORMAT.md))
- Your words on all your devices with a free account ([account](docs/ACCOUNT.md))

**On your device**

- Computer: select a word in any app to look it up, hover over words in images and scanned pages, and replace selected text with its translation by a shortcut
- Android: a Phevere button in the menu that appears when you select text, a lookup that floats over the app you are in, and words picked out of a photo
- iOS: share text to Phevere, and pick words out of a photo

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Screenshots of the phone app: a review question, the Progress page, the word-book library and word families grouped by origin">
<p><sub>A review question, Progress, the word-book library, and word families grouped by language of origin.</sub></p>
</div>

## Download

Get the file for your device from the [latest release](https://github.com/thd2020/phevere/releases/latest).

| Device | File | Requires |
|---|---|---|
| Windows (most PCs) | `Phevere-Setup-<version>-x64.exe` | Windows 10 |
| Windows on Arm | `Phevere-Setup-<version>-arm64.exe` | Windows 11 |
| Mac with Apple silicon | `Phevere-<version>-darwin-arm64.dmg` | macOS 11 |
| Mac with Intel | `Phevere-<version>-darwin-x64.dmg` | macOS 11 |
| Debian, Ubuntu | `phevere_<version>_amd64.deb` | Ubuntu 22.04 |
| Fedora, openSUSE | `phevere-<version>-1.x86_64.rpm` | Fedora 36 |
| Other Linux | `Phevere-<version>-x64.AppImage` | Ubuntu 22.04 or equivalent |
| Android | `Phevere-<version>-android.apk` | Android 7.0 |
| iOS | `Phevere-<version>-ios-unsigned.ipa` (you sign it yourself) | iOS 15.1 |

Linux packages for Arm computers are on the release page too.

Windows and macOS warn you the first time you open Phevere, because it is not signed by a paid developer account; choose to run it anyway. On a Mac, right-click Phevere and choose **Open** the first time, then allow Accessibility and Screen Recording when asked ([Mac setup](docs/MACOS_SELECTION.md)). On a computer, looking up words in images needs a 14 MB download from **Settings → Capture**. GNOME on Wayland needs a keyboard shortcut set up once ([Linux setup](docs/LINUX_SELECTION.md)), and rooted Android phones can add an LSPosed module for more control ([Android setup](apps/mobile/ANDROID.md)).

## Updates

Phevere checks for a new version every six hours and makes sure each download is intact before installing it. In **Settings → Updates** you can let it update automatically (the default), ask you first, or turn updates off.

- **Windows and AppImage**: the update installs when you quit Phevere. **Roll back** returns to the previous version if a new one gives you trouble, and backs up your words first.
- **macOS, deb and rpm**: Phevere tells you about the new version and opens its download page.
- **Android**: the update downloads on Wi-Fi, then Android asks you to confirm the install. Going back a version is not possible on Android without uninstalling, which would delete your words.

## Privacy

Your words and settings stay on your device. Lookups go only to the dictionaries and translators you have turned on, password fields are never read, and private browser windows are never recorded. If you sign in, your words are stored in your account so your devices match, and deleting the account removes them ([privacy policy](https://holarky-api.thdfreelancer.workers.dev/privacy)).

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

[MIT](LICENSE). The names Phevere, Holarky and knowrld and their logos are not covered; see [TRADEMARKS.md](TRADEMARKS.md). The apps bundle eSpeak NG under GPL-3.0-or-later ([terms](apps/mobile/ANDROID.md)), and the sense-frequency table is derived from Princeton WordNet 3.1 under the WordNet licence.
