<div align="center">

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="Phevere 图标：一个向前倾斜的小写字母 p，梅紫色的竖笔加上薄荷绿的空心圆">

<h1>Phevere</h1>

<p>在任何应用里选中一个词，就地查词。收进生词本，再把它学会。</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[下载](https://github.com/thd2020/phevere/releases/latest) · [更新日志](CHANGELOG.md) · [文档](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Android 应用截图：查询 serendipity 的结果、选中一个词的扫描页面，以及取词设置">

</div>

## 简介

Phevere 是一部读到哪里就能查到哪里的词典。在任何应用里选中一个词，就能看到它的释义、发音、翻译和词源，还可以存进生词本以后再学。Phevere 支持 Windows、macOS、Linux、Android 和 iOS。

## 功能

**查词**

- 释义、图片、发音、翻译、词源和维基百科集中在一处
- 美式和英式发音，还可以下载更多语音
- 用 Google 翻译、MyMemory、有道或 DeepL 翻译
- 词形变化，以及前缀、后缀和词根的专页
- 输入时自动联想
- 十六种语言的离线词典
- 除英语外，还能查许多其他语言的单词（[语言列表](docs/MULTILINGUAL.md)）

**学习**

- 从小学到大学英语六级、考研、托业和商务英语的词书（[词书列表](docs/WORDBOOKS.md)）
- 存下的单词会记住你是在哪里遇到它
- 词族、单词地图和闪卡
- 基于间隔重复的每日复习（[原理说明](docs/REVIEW.md)）
- 学习进度图表
- 与 Anki 互相导入导出（[文件格式](docs/BOOK_FORMAT.md)）
- 注册免费账户后可在多台设备间同步（[账户说明](docs/ACCOUNT.md)）

**各平台**

- 电脑：在任何应用里查选中的文字或图片里的单词，并就地翻译选中的文字
- Android：在任何应用的文字选择菜单里查词，也可以拍照扫词
- iOS：从共享菜单查词，也可以拍照扫词

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="手机应用截图：一道复习题、进度页面、词书库和词族">
<p><sub>复习、进度、词书和词族。</sub></p>
</div>

## 下载

请到[最新版本](https://github.com/thd2020/phevere/releases/latest)下载 Phevere。支持 Windows 10、macOS 11、Ubuntu 22.04 或 Fedora 36、Android 7.0、iOS 15.1 及以上版本。iOS 应用需要先用你自己的 Apple 账户签名才能安装。

第一次打开 Phevere 时，Windows 和 macOS 会弹出安全提示，选择仍然运行即可。安装说明：[macOS](docs/MACOS_SELECTION.md)、[Linux](docs/LINUX_SELECTION.md)、[Android](apps/mobile/ANDROID.md)。

## 更新

Phevere 会自动更新。在 **Settings → Updates** 中可以选择自动更新（Automatically）、先询问（Ask first）或关闭（Off）。

- Windows 和 AppImage 版在你退出 Phevere 时安装更新，点 **Roll back** 可以回到上一个版本。
- macOS、deb 和 rpm 版会打开新版本的下载页面。
- Android 版在连接 Wi-Fi 时下载更新，安装前会请你确认。

**Settings → About** 页面显示当前版本和更新内容，也可以从这里反馈问题。

## 隐私

除非你登录并开启同步，你的单词和设置只保存在自己的设备上。Phevere 从不读取密码框，也不记录浏览器的无痕窗口。详见[隐私政策](https://holarky-api.thdfreelancer.workers.dev/privacy)。

## 从源码构建

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

你需要 Node.js 18 或更高版本，以及编译原生模块用的 C++ 工具链：Windows 上是 Visual Studio 2022，macOS 上是 Xcode Command Line Tools，Linux 上是 `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`。`npm run make:*` 脚本用来打包安装程序（[打包说明](PACKAGING.md)），`npm run mobile:dev` 在浏览器里运行手机应用（[手机版说明](docs/MOBILE.md)）。把新的版本号推送到 `main` 就会自动发布（[发布说明](docs/RELEASE.md)）。

| 路径 | 内容 |
|---|---|
| [`packages/core`](packages/core) | 词典来源、生词本和同步，各平台共用 |
| [`src`](src) | 桌面应用（Electron） |
| [`native-addon`](native-addon) | Windows、macOS 和 Linux 上的取词模块 |
| [`apps/mobile`](apps/mobile) | 手机应用及其 Android 和 iOS 工程 |
| [`docs`](docs) | 各平台说明和设计文档 |

## 许可证

[MIT](LICENSE)。Phevere、Holarky、knowrld 这几个名称及其标志不在此许可范围内，详见 [TRADEMARKS.md](TRADEMARKS.md)。来自维基词典和维基百科的词典文本采用 CC BY-SA 4.0 许可。应用内置的 eSpeak NG 采用 GPL-3.0-or-later 许可（[条款](apps/mobile/ANDROID.md)），词义频率表取自 Princeton WordNet 3.1，遵循 WordNet 许可。**Settings → About** 列出了全部数据来源及其许可证。

如果 Phevere 对你有帮助，欢迎在 GitHub 上[点个 Star](https://github.com/thd2020/phevere)，让更多人发现它。
