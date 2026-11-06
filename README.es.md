<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="El icono de Phevere: una p minúscula inclinada hacia delante, con el trazo vertical color ciruela y el óvalo hueco color menta">

<h1>Phevere</h1>

<p>Selecciona una palabra en cualquier aplicación y búscala sin dejar de leer. Guárdala y apréndetela.</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[Descargar](https://github.com/thd2020/phevere/releases/latest) · [Novedades](CHANGELOG.md) · [Documentación](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Capturas de la aplicación para Android: la búsqueda de serendipity, Escanear con una palabra seleccionada y los ajustes de Captura">

</div>

## Qué es

Phevere es un diccionario que funciona donde sea que leas. Selecciona una palabra en cualquier aplicación para ver su significado, pronunciación, traducción y etimología, y guárdala para aprenderla más tarde. Funciona en Windows, macOS, Linux, Android e iOS.

## Funciones

**Buscar**

- Definiciones, imágenes, pronunciación, traducción, etimología y Wikipedia en un solo lugar
- Pronunciación estadounidense y británica, con más voces para descargar
- Traducción con Google Translate, MyMemory, Youdao o DeepL
- Formas de cada palabra y páginas para prefijos, sufijos y raíces
- Sugerencias mientras escribes
- Diccionarios sin conexión para dieciséis idiomas
- Definiciones de palabras en muchos idiomas además del inglés ([idiomas](docs/MULTILINGUAL.md))

**Aprender**

- Listas de vocabulario desde primaria hasta CET-6, 考研, TOEIC e inglés de negocios ([listas](docs/WORDBOOKS.md))
- Las palabras guardadas recuerdan dónde las encontraste
- Familias de palabras, un mapa de palabras y tarjetas de memoria
- Un repaso diario con repetición espaciada ([cómo funciona](docs/REVIEW.md))
- Gráficas de progreso
- Importación y exportación con Anki ([formato de archivo](docs/BOOK_FORMAT.md))
- Sincronización entre tus dispositivos con una cuenta gratuita ([cuenta](docs/ACCOUNT.md))

**En cada dispositivo**

- Ordenador: busca el texto seleccionado en cualquier aplicación o las palabras dentro de imágenes, y traduce el texto seleccionado sin salir de donde estás
- Android: busca desde el menú de selección de texto de cualquier aplicación y escanea palabras en fotos
- iOS: busca desde el menú Compartir y escanea palabras en fotos
- La interfaz está en English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский y Português (Brasil), sigue el idioma del sistema y se puede cambiar en la parte superior de **Ajustes**

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Capturas de la aplicación para móvil: una pregunta de repaso, la página de progreso, la biblioteca de listas y las familias de palabras">
<p><sub>Repaso, progreso, listas de vocabulario y familias de palabras.</sub></p>
</div>

## Descarga

Descarga Phevere desde la [última versión](https://github.com/thd2020/phevere/releases/latest). Necesita Windows 10, macOS 11, Ubuntu 22.04 o Fedora 36, Android 7.0, o iOS 15.1 o posterior. La aplicación para iOS debe firmarse con tu propia cuenta de Apple antes de instalarla.

Windows y macOS muestran un aviso la primera vez que abres Phevere; elige ejecutarlo de todos modos. Notas de instalación: [macOS](docs/MACOS_SELECTION.md), [Linux](docs/LINUX_SELECTION.md), [Android](apps/mobile/ANDROID.md).

## Actualizaciones

Phevere se actualiza solo. En **Ajustes → Actualizaciones**, elige Automáticamente, Preguntar antes o Desactivado.

- En Windows y AppImage, la actualización se instala al cerrar Phevere, y con **Volver a …** regresas a la versión anterior.
- En macOS, deb y rpm se abre la página de descarga de la nueva versión.
- En Android, la actualización se descarga con Wi-Fi y te pide confirmación antes de instalarse.

En **Ajustes → Acerca de** verás tu versión, las novedades y dónde informar de un problema.

## Privacidad

Tus palabras y ajustes se quedan en tu dispositivo, salvo que inicies sesión para sincronizarlos. Phevere nunca lee campos de contraseña ni registra ventanas privadas del navegador. Consulta la [política de privacidad](https://holarky-api.thdfreelancer.workers.dev/privacy).

## Compilar desde el código fuente

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

Necesitas Node.js 18 o posterior y un compilador de C++ para el módulo nativo: Visual Studio 2022 en Windows, Xcode Command Line Tools en macOS y, en Linux, `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`. Los scripts `npm run make:*` generan los instaladores ([empaquetado](PACKAGING.md)) y `npm run mobile:dev` ejecuta la aplicación para móvil en un navegador ([móvil](docs/MOBILE.md)). Al subir una nueva versión a `main` se publica una versión nueva ([publicación](docs/RELEASE.md)).

| Ruta | Contenido |
|---|---|
| [`packages/core`](packages/core) | Fuentes de diccionario, cuaderno de palabras y sincronización, compartidos por todas las plataformas |
| [`src`](src) | Aplicación de escritorio (Electron) |
| [`native-addon`](native-addon) | Captura de la selección en Windows, macOS y Linux |
| [`apps/mobile`](apps/mobile) | Aplicación para móvil y sus proyectos de Android e iOS |
| [`docs`](docs) | Notas por plataforma y documentos de diseño |

## Licencia

[MIT](LICENSE). Los nombres Phevere, Holarky y knowrld y sus logotipos no están incluidos; consulta [TRADEMARKS.md](TRADEMARKS.md). El texto de diccionario de Wiktionary y Wikipedia está bajo CC BY-SA 4.0. Las aplicaciones incluyen eSpeak NG bajo GPL-3.0-or-later ([condiciones](apps/mobile/ANDROID.md)), y la tabla de frecuencia de acepciones procede de Princeton WordNet 3.1 bajo la licencia de WordNet. En **Ajustes → Acerca de** encontrarás todas las fuentes de datos y sus licencias.

Si Phevere te resulta útil, una [estrella en GitHub](https://github.com/thd2020/phevere) ayuda a que más gente lo encuentre.
