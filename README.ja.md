<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · **日本語** · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="Phevere のアイコン。前に傾いた小文字の p で、縦線はプラム色、丸い部分はミント色の輪">

<h1>Phevere</h1>

<p>どのアプリでも単語を選択すれば、読んでいるその場で調べられます。保存して、覚えましょう。</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[ダウンロード](https://github.com/thd2020/phevere/releases/latest) · [変更履歴](CHANGELOG.md) · [ドキュメント](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Android アプリのスクリーンショット。serendipity の検索結果、単語を選択したスキャン画面、キャプチャの設定">

</div>

## Phevere について

Phevere は、どこで読んでいても使える辞書です。どのアプリでも単語を選択すると、意味、発音、翻訳、語源が表示され、あとで覚えるために保存できます。Windows、macOS、Linux、Android、iOS で動作します。

## 機能

**調べる**

- 定義、画像、発音、翻訳、語源、Wikipedia をひとつの画面で
- アメリカ英語とイギリス英語の発音。追加の音声もダウンロードできます
- Google 翻訳、MyMemory、Youdao、DeepL による翻訳
- 語形変化と、接頭辞・接尾辞・語根のページ
- 入力中の候補表示
- 16 言語のオフライン辞書
- 英語以外の多くの言語の単語にも対応（[対応言語](docs/MULTILINGUAL.md)）

**覚える**

- 小学校レベルから CET-6、考研、TOEIC、ビジネス英語までの単語帳（[単語帳の一覧](docs/WORDBOOKS.md)）
- 保存した単語は、どこで出会ったかを覚えています
- 語族、単語マップ、フラッシュカード
- 間隔反復による毎日の復習（[しくみ](docs/REVIEW.md)）
- 学習の進み具合のグラフ
- Anki とのインポートとエクスポート（[ファイル形式](docs/BOOK_FORMAT.md)）
- 無料アカウントで複数の端末を同期（[アカウント](docs/ACCOUNT.md)）

**端末ごとの機能**

- パソコン：どのアプリでも、選択したテキストや画像の中の単語を調べられます。選択したテキストをその場で翻訳することもできます
- Android：どのアプリでもテキスト選択メニューから調べられます。写真から単語をスキャンすることもできます
- iOS：共有メニューから調べられます。写真から単語をスキャンすることもできます
- 表示言語は English、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch、Русский、Português (Brasil) に対応し、システムの言語に合わせて切り替わりますが、**設定**の一番上で変更することもできます

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="スマートフォンアプリのスクリーンショット。復習の問題、進み具合のページ、単語帳のライブラリ、語族">
<p><sub>復習、進み具合、単語帳、語族。</sub></p>
</div>

## ダウンロード

Phevere は[最新リリース](https://github.com/thd2020/phevere/releases/latest)から入手できます。動作環境は Windows 10、macOS 11、Ubuntu 22.04 または Fedora 36、Android 7.0、iOS 15.1 以降です。iOS 版は、インストールする前にご自身の Apple アカウントで署名する必要があります。

初めて Phevere を開くとき、Windows と macOS では警告が表示されます。そのまま実行を選んでください。セットアップの説明：[macOS](docs/MACOS_SELECTION.md)、[Linux](docs/LINUX_SELECTION.md)、[Android](apps/mobile/ANDROID.md)。

## アップデート

Phevere は自動でアップデートします。**設定 → アップデート**で、自動、事前に確認、オフのいずれかを選べます。

- Windows と AppImage 版は Phevere を終了したときにアップデートをインストールします。**…に戻す**を押すと前のバージョンに戻せます。
- macOS、deb、rpm 版は新しいバージョンのダウンロードページを開きます。
- Android 版は Wi-Fi 接続時にアップデートをダウンロードし、インストールの前に確認を求めます。

**設定 → 情報**では、お使いのバージョン、新機能、問題の報告先を確認できます。

## プライバシー

同期のためにサインインしない限り、単語と設定は端末の中にだけ保存されます。Phevere はパスワード欄を読み取らず、ブラウザのプライベートウィンドウも記録しません。詳しくは[プライバシーポリシー](https://holarky-api.thdfreelancer.workers.dev/privacy)をご覧ください。

## ソースからビルドする

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

Node.js 18 以降と、ネイティブモジュール用の C++ ツールチェーンが必要です。Windows では Visual Studio 2022、macOS では Xcode Command Line Tools、Linux では `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev` を用意してください。`npm run make:*` スクリプトでインストーラーを作成でき（[パッケージング](PACKAGING.md)）、`npm run mobile:dev` でスマートフォンアプリをブラウザで動かせます（[モバイル](docs/MOBILE.md)）。新しいバージョンを `main` にプッシュするとリリースが公開されます（[リリース手順](docs/RELEASE.md)）。

| パス | 内容 |
|---|---|
| [`packages/core`](packages/core) | 辞書のソース、単語ノート、同期。すべてのプラットフォームで共通 |
| [`src`](src) | デスクトップアプリ（Electron） |
| [`native-addon`](native-addon) | Windows、macOS、Linux での選択テキストの取得 |
| [`apps/mobile`](apps/mobile) | スマートフォンアプリと、その Android および iOS プロジェクト |
| [`docs`](docs) | プラットフォームごとの説明と設計文書 |

## ライセンス

[MIT](LICENSE)。Phevere、Holarky、knowrld の名称とロゴは対象外です。[TRADEMARKS.md](TRADEMARKS.md) をご覧ください。Wiktionary と Wikipedia の辞書テキストは CC BY-SA 4.0 で提供されています。アプリには GPL-3.0-or-later の eSpeak NG が同梱されており（[条件](apps/mobile/ANDROID.md)）、語義の頻度表は WordNet ライセンスのもとで Princeton WordNet 3.1 から作成しています。すべてのデータソースとそのライセンスは **設定 → 情報**に一覧があります。

Phevere が役に立ったら、GitHub で[スターを付けて](https://github.com/thd2020/phevere)いただけると、ほかの人にも見つけてもらいやすくなります。
