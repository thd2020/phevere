<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="Phevere 圖示：一個向前傾斜的小寫字母 p，梅紫色的直筆加上薄荷綠的空心圓">

<h1>Phevere</h1>

<p>在任何應用程式裡選取一個字，就地查字典。把它存起來，再把它學會。</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[下載](https://github.com/thd2020/phevere/releases/latest) · [更新紀錄](CHANGELOG.md) · [說明文件](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Android 應用程式截圖：查詢 serendipity 的結果、選取一個字的掃描畫面，以及擷取設定">

</div>

## 簡介

Phevere 是一部在哪裡閱讀都能用的字典。在任何應用程式裡選取一個字，就能看到它的釋義、發音、翻譯和字源，再把它存起來留待以後學習。Phevere 支援 Windows、macOS、Linux、Android 和 iOS。

## 功能

**查字典**

- 釋義、圖片、發音、翻譯、字源和維基百科集中在同一處
- 美式和英式發音，也可以下載更多語音
- 透過 Google 翻譯、MyMemory、有道或 DeepL 翻譯
- 詞形變化，以及字首、字尾和字根的專頁
- 輸入時提供建議字
- 十六種語言的離線字典
- 除了英文，也能查許多其他語言的單字（[語言列表](docs/MULTILINGUAL.md)）

**學習**

- 從小學到大學英語六級、考研、多益和商用英文的單字書（[單字書列表](docs/WORDBOOKS.md)）
- 存下的單字會記得你是在哪裡遇到它的
- 字族、單字地圖和字卡
- 以間隔重複安排的每日複習（[運作方式](docs/REVIEW.md)）
- 學習進度圖表
- 與 Anki 互相匯入匯出（[檔案格式](docs/BOOK_FORMAT.md)）
- 註冊免費帳號後可在多部裝置間同步（[帳號說明](docs/ACCOUNT.md)）

**各平台**

- 電腦：在任何應用程式裡查詢選取的文字或圖片中的單字，並直接翻譯選取的文字
- Android：從任何應用程式的文字選取選單查字典，也可以拍照掃描單字
- iOS：從分享選單查字典，也可以拍照掃描單字

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="手機應用程式截圖：一道複習題、進度頁面、單字書庫和字族">
<p><sub>複習、進度、單字書和字族。</sub></p>
</div>

## 下載

請到[最新版本](https://github.com/thd2020/phevere/releases/latest)下載 Phevere。系統需求為 Windows 10、macOS 11、Ubuntu 22.04 或 Fedora 36、Android 7.0、iOS 15.1 或更新版本。iOS 版需要先用你自己的 Apple 帳號簽署才能安裝。

第一次開啟 Phevere 時，Windows 和 macOS 會顯示安全性警告，選擇仍要執行即可。安裝說明：[macOS](docs/MACOS_SELECTION.md)、[Linux](docs/LINUX_SELECTION.md)、[Android](apps/mobile/ANDROID.md)。

## 更新

Phevere 會自動更新。在 **Settings → Updates** 中可以選擇自動更新（Automatically）、先詢問（Ask first）或關閉（Off）。

- Windows 和 AppImage 版會在你結束 Phevere 時安裝更新，按 **Roll back** 可以回到上一個版本。
- macOS、deb 和 rpm 版會開啟新版本的下載頁面。
- Android 版會在連上 Wi-Fi 時下載更新，安裝前會請你確認。

**Settings → About** 會顯示目前的版本、更新內容，以及回報問題的地方。

## 隱私權

除非你登入並開啟同步，你的單字和設定只會存在自己的裝置上。Phevere 從不讀取密碼欄位，也不會記錄瀏覽器的無痕視窗。詳見[隱私權政策](https://holarky-api.thdfreelancer.workers.dev/privacy)。

## 從原始碼建置

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

你需要 Node.js 18 或更新版本，以及編譯原生模組用的 C++ 工具鏈：Windows 上是 Visual Studio 2022，macOS 上是 Xcode Command Line Tools，Linux 上是 `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`。`npm run make:*` 指令碼用來建置安裝程式（[封裝說明](PACKAGING.md)），`npm run mobile:dev` 會在瀏覽器裡執行手機版（[手機版說明](docs/MOBILE.md)）。把新的版本號推送到 `main` 就會發佈一個新版本（[發佈說明](docs/RELEASE.md)）。

| 路徑 | 內容 |
|---|---|
| [`packages/core`](packages/core) | 字典來源、單字本和同步，各平台共用 |
| [`src`](src) | 桌面應用程式（Electron） |
| [`native-addon`](native-addon) | Windows、macOS 和 Linux 上的選字擷取模組 |
| [`apps/mobile`](apps/mobile) | 手機應用程式及其 Android 和 iOS 專案 |
| [`docs`](docs) | 各平台說明和設計文件 |

## 授權條款

[MIT](LICENSE)。Phevere、Holarky、knowrld 這幾個名稱及其標誌不在此授權範圍內，詳見 [TRADEMARKS.md](TRADEMARKS.md)。來自維基詞典和維基百科的字典內容採用 CC BY-SA 4.0 授權。應用程式內附的 eSpeak NG 採用 GPL-3.0-or-later 授權（[條款](apps/mobile/ANDROID.md)），詞義頻率表取自 Princeton WordNet 3.1，依循 WordNet 授權。**Settings → About** 列出了所有資料來源及其授權條款。

如果 Phevere 對你有幫助，歡迎在 GitHub 上[給個星星](https://github.com/thd2020/phevere)，讓更多人找到它。
