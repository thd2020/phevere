<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="L’icône de Phevere : un p minuscule penché vers l’avant, avec une haste prune et une panse évidée vert menthe">

<h1>Phevere</h1>

<p>Sélectionnez un mot dans n’importe quelle application et cherchez-le là où vous lisez. Gardez-le, et apprenez-le.</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[Télécharger](https://github.com/thd2020/phevere/releases/latest) · [Nouveautés](CHANGELOG.md) · [Documentation](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Captures de l’application Android : la recherche de serendipity, Scanner avec un mot sélectionné, et les réglages de Capture">

</div>

## Présentation

Phevere est un dictionnaire qui vous suit partout où vous lisez. Sélectionnez un mot dans n’importe quelle application pour voir son sens, sa prononciation, sa traduction et son étymologie, puis gardez-le pour l’apprendre plus tard. Phevere fonctionne sous Windows, macOS, Linux, Android et iOS.

## Fonctionnalités

**Chercher**

- Définitions, images, prononciation, traduction, étymologie et Wikipédia au même endroit
- Prononciation américaine et britannique, avec d’autres voix à télécharger
- Traduction avec Google Traduction, MyMemory, Youdao ou DeepL
- Formes fléchies, et pages pour les préfixes, les suffixes et les racines
- Suggestions pendant la saisie
- Dictionnaires hors ligne pour seize langues
- Définitions de mots dans de nombreuses langues en plus de l’anglais ([langues](docs/MULTILINGUAL.md))

**Apprendre**

- Listes de vocabulaire du primaire jusqu’au CET-6, au 考研, au TOEIC et à l’anglais des affaires ([liste des livres](docs/WORDBOOKS.md))
- Les mots enregistrés se souviennent de l’endroit où vous les avez rencontrés
- Familles de mots, carte des mots et cartes mémoire
- Une révision quotidienne avec répétition espacée ([fonctionnement](docs/REVIEW.md))
- Graphiques de progression
- Import et export avec Anki ([format de fichier](docs/BOOK_FORMAT.md))
- Synchronisation entre vos appareils avec un compte gratuit ([compte](docs/ACCOUNT.md))

**Sur chaque appareil**

- Ordinateur : cherchez le texte sélectionné dans n’importe quelle application ou les mots d’une image, et traduisez le texte sélectionné sur place
- Android : cherchez depuis le menu de sélection de texte de n’importe quelle application, et scannez des mots sur des photos
- iOS : cherchez depuis le menu Partager, et scannez des mots sur des photos
- L’interface existe en English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский et Português (Brasil), suit la langue du système et se change en haut des **Paramètres**

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Captures de l’application mobile : une question de révision, la page de progression, la bibliothèque de listes et les familles de mots">
<p><sub>Révision, progression, listes de vocabulaire et familles de mots.</sub></p>
</div>

## Téléchargement

Téléchargez Phevere depuis la [dernière version](https://github.com/thd2020/phevere/releases/latest). Il faut Windows 10, macOS 11, Ubuntu 22.04 ou Fedora 36, Android 7.0, ou iOS 15.1 ou une version plus récente. L’application iOS doit être signée avec votre propre compte Apple avant de pouvoir s’installer.

Windows et macOS affichent un avertissement la première fois que vous ouvrez Phevere ; choisissez de l’exécuter quand même. Notes d’installation : [macOS](docs/MACOS_SELECTION.md), [Linux](docs/LINUX_SELECTION.md), [Android](apps/mobile/ANDROID.md).

## Mises à jour

Phevere se met à jour tout seul. Dans **Paramètres → Mises à jour**, choisissez Automatiquement, Demander d’abord ou Désactivé.

- Sous Windows et en AppImage, la mise à jour s’installe quand vous quittez Phevere, et **Revenir à la version …** rétablit la version précédente.
- Sous macOS, en deb et en rpm, Phevere ouvre la page de téléchargement de la nouvelle version.
- Sous Android, la mise à jour se télécharge en Wi-Fi et vous demande de confirmer l’installation.

**Paramètres → À propos** indique votre version, les nouveautés et où signaler un problème.

## Confidentialité

Vos mots et vos réglages restent sur votre appareil, sauf si vous vous connectez pour les synchroniser. Phevere ne lit jamais les champs de mot de passe et n’enregistre pas les fenêtres de navigation privée. Consultez la [politique de confidentialité](https://holarky-api.thdfreelancer.workers.dev/privacy).

## Compiler depuis les sources

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

Il vous faut Node.js 18 ou plus récent, ainsi qu’une chaîne de compilation C++ pour le module natif : Visual Studio 2022 sous Windows, Xcode Command Line Tools sous macOS et, sous Linux, `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`. Les scripts `npm run make:*` produisent les installateurs ([empaquetage](PACKAGING.md)), et `npm run mobile:dev` lance l’application mobile dans un navigateur ([mobile](docs/MOBILE.md)). Pousser un nouveau numéro de version sur `main` publie une nouvelle version ([publication](docs/RELEASE.md)).

| Chemin | Contenu |
|---|---|
| [`packages/core`](packages/core) | Sources de dictionnaire, carnet de mots et synchronisation, communs à toutes les plateformes |
| [`src`](src) | Application de bureau (Electron) |
| [`native-addon`](native-addon) | Capture de la sélection sous Windows, macOS et Linux |
| [`apps/mobile`](apps/mobile) | Application mobile et ses projets Android et iOS |
| [`docs`](docs) | Notes par plateforme et documents de conception |

## Licence

[MIT](LICENSE). Les noms Phevere, Holarky et knowrld et leurs logos n’en font pas partie ; voir [TRADEMARKS.md](TRADEMARKS.md). Les textes de dictionnaire issus du Wiktionnaire et de Wikipédia sont sous CC BY-SA 4.0. Les applications embarquent eSpeak NG sous GPL-3.0-or-later ([conditions](apps/mobile/ANDROID.md)), et la table de fréquence des sens est tirée de Princeton WordNet 3.1 sous la licence WordNet. **Paramètres → À propos** liste toutes les sources de données et leurs licences.

Si Phevere vous est utile, une [étoile sur GitHub](https://github.com/thd2020/phevere) aide d’autres personnes à le trouver.
