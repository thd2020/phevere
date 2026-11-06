<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="Das Phevere-Symbol: ein nach vorn geneigtes kleines p mit pflaumenfarbenem Schaft und hohlem, mintgrünem Bogen">

<h1>Phevere</h1>

<p>Markiere ein Wort in einer beliebigen App und schlag es nach, ohne mit dem Lesen aufzuhören. Behalte es, und lerne es.</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[Herunterladen](https://github.com/thd2020/phevere/releases/latest) · [Änderungen](CHANGELOG.md) · [Dokumentation](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Screenshots der Android-App: die Suche nach serendipity, Scannen mit einem markierten Wort und die Erfassungseinstellungen">

</div>

## Über Phevere

Phevere ist ein Wörterbuch, das überall funktioniert, wo du liest. Markiere ein Wort in einer beliebigen App, um Bedeutung, Aussprache, Übersetzung und Herkunft zu sehen, und speichere es, um es später zu lernen. Phevere läuft unter Windows, macOS, Linux, Android und iOS.

## Funktionen

**Nachschlagen**

- Definitionen, Bilder, Aussprache, Übersetzung, Wortherkunft und Wikipedia an einem Ort
- Amerikanische und britische Aussprache, weitere Stimmen zum Herunterladen
- Übersetzung mit Google Übersetzer, MyMemory, Youdao oder DeepL
- Wortformen sowie eigene Seiten für Präfixe, Suffixe und Wortstämme
- Vorschläge beim Tippen
- Offline-Wörterbücher für sechzehn Sprachen
- Definitionen für Wörter in vielen Sprachen außer Englisch ([Sprachen](docs/MULTILINGUAL.md))

**Lernen**

- Vokabelbücher von der Grundschule bis CET-6, 考研, TOEIC und Wirtschaftsenglisch ([Bücherliste](docs/WORDBOOKS.md))
- Gespeicherte Wörter merken sich, wo du sie gefunden hast
- Wortfamilien, eine Wortkarte und Karteikarten
- Eine tägliche Wiederholung mit verteilten Abständen ([so funktioniert es](docs/REVIEW.md))
- Fortschrittsdiagramme
- Import und Export mit Anki ([Dateiformat](docs/BOOK_FORMAT.md))
- Synchronisierung zwischen deinen Geräten mit einem kostenlosen Konto ([Konto](docs/ACCOUNT.md))

**Auf deinem Gerät**

- Computer: Schlage markierten Text in jeder App oder Wörter in Bildern nach, und übersetze markierten Text direkt an Ort und Stelle
- Android: Schlage über das Textauswahlmenü jeder App nach, und scanne Wörter aus Fotos
- iOS: Schlage über das Teilen-Menü nach, und scanne Wörter aus Fotos

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Screenshots der Handy-App: eine Wiederholungsfrage, die Fortschrittsseite, die Vokabelbuch-Bibliothek und Wortfamilien">
<p><sub>Wiederholung, Fortschritt, Vokabelbücher und Wortfamilien.</sub></p>
</div>

## Download

Lade Phevere von der [neuesten Version](https://github.com/thd2020/phevere/releases/latest) herunter. Du brauchst Windows 10, macOS 11, Ubuntu 22.04 oder Fedora 36, Android 7.0 oder iOS 15.1 oder neuer. Die iOS-App musst du vor der Installation mit deinem eigenen Apple-Konto signieren.

Windows und macOS zeigen beim ersten Öffnen von Phevere eine Warnung; wähle, die App trotzdem auszuführen. Hinweise zur Einrichtung: [macOS](docs/MACOS_SELECTION.md), [Linux](docs/LINUX_SELECTION.md), [Android](apps/mobile/ANDROID.md).

## Updates

Phevere aktualisiert sich selbst. Unter **Einstellungen → Updates** wählst du Automatisch, Vorher fragen oder Aus.

- Unter Windows und als AppImage wird das Update installiert, wenn du Phevere beendest, und **Zurücksetzen** kehrt zur vorherigen Version zurück.
- Unter macOS sowie als deb und rpm öffnet Phevere die Downloadseite der neuen Version.
- Unter Android wird das Update über WLAN geladen, und vor der Installation fragt Phevere nach deiner Bestätigung.

Unter **Einstellungen → Über** siehst du deine Version, die Neuerungen und wo du ein Problem melden kannst.

## Datenschutz

Deine Wörter und Einstellungen bleiben auf deinem Gerät, solange du dich nicht zum Synchronisieren anmeldest. Phevere liest niemals Passwortfelder und zeichnet keine privaten Browserfenster auf. Siehe die [Datenschutzerklärung](https://holarky-api.thdfreelancer.workers.dev/privacy).

## Aus dem Quellcode bauen

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

Du brauchst Node.js 18 oder neuer sowie eine C++-Toolchain für das native Modul: Visual Studio 2022 unter Windows, die Xcode Command Line Tools unter macOS und unter Linux `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`. Die Skripte `npm run make:*` erzeugen die Installer ([Paketierung](PACKAGING.md)), und `npm run mobile:dev` startet die Handy-App im Browser ([Mobil](docs/MOBILE.md)). Wenn eine neue Versionsnummer auf `main` gepusht wird, erscheint eine neue Version ([Veröffentlichung](docs/RELEASE.md)).

| Pfad | Inhalt |
|---|---|
| [`packages/core`](packages/core) | Wörterbuchquellen, Vokabelheft und Synchronisierung, gemeinsam für alle Plattformen |
| [`src`](src) | Desktop-App (Electron) |
| [`native-addon`](native-addon) | Erfassung der Textauswahl unter Windows, macOS und Linux |
| [`apps/mobile`](apps/mobile) | Handy-App mit ihren Android- und iOS-Projekten |
| [`docs`](docs) | Hinweise zu den Plattformen und Designdokumente |

## Lizenz

[MIT](LICENSE). Die Namen Phevere, Holarky und knowrld und ihre Logos sind davon ausgenommen; siehe [TRADEMARKS.md](TRADEMARKS.md). Wörterbuchtexte aus Wiktionary und Wikipedia stehen unter CC BY-SA 4.0. Die Apps enthalten eSpeak NG unter GPL-3.0-or-later ([Bedingungen](apps/mobile/ANDROID.md)), und die Tabelle der Bedeutungshäufigkeiten stammt aus Princeton WordNet 3.1 unter der WordNet-Lizenz. **Einstellungen → Über** listet alle Datenquellen und ihre Lizenzen auf.

Wenn dir Phevere hilft, sorgt ein [Stern auf GitHub](https://github.com/thd2020/phevere) dafür, dass andere es leichter finden.
