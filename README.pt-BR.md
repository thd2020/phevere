<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · **Português (Brasil)**

<img src="README.assets/phevere-icon.png" width="96" alt="O ícone do Phevere: um p minúsculo inclinado para a frente, com a haste cor de ameixa e o bojo vazado verde-menta">

<h1>Phevere</h1>

<p>Selecione uma palavra em qualquer aplicativo e consulte-a sem parar de ler. Guarde-a e aprenda-a.</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[Baixar](https://github.com/thd2020/phevere/releases/latest) · [Novidades](CHANGELOG.md) · [Documentação](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Capturas de tela do aplicativo para Android: a busca por serendipity, Escanear com uma palavra selecionada e as configurações de Captura">

</div>

## Sobre

O Phevere é um dicionário que funciona onde quer que você leia. Selecione uma palavra em qualquer aplicativo para ver o significado, a pronúncia, a tradução e a origem dela, e salve-a para aprender depois. Ele funciona no Windows, macOS, Linux, Android e iOS.

## Recursos

**Consultar**

- Definições, imagens, pronúncia, tradução, etimologia e Wikipédia num só lugar
- Pronúncia americana e britânica, com outras vozes para baixar
- Tradução com Google Tradutor, MyMemory, Youdao ou DeepL
- Formas das palavras, e páginas para prefixos, sufixos e radicais
- Sugestões enquanto você digita
- Dicionários offline para dezesseis idiomas
- Definições de palavras em vários idiomas além do inglês ([idiomas](docs/MULTILINGUAL.md))

**Aprender**

- Listas de vocabulário do ensino fundamental até o CET-6, o 考研, o TOEIC e o inglês para negócios ([lista completa](docs/WORDBOOKS.md))
- As palavras salvas lembram onde você as encontrou
- Famílias de palavras, um mapa de palavras e flashcards
- Uma revisão diária com repetição espaçada ([como funciona](docs/REVIEW.md))
- Gráficos de progresso
- Importação e exportação com o Anki ([formato do arquivo](docs/BOOK_FORMAT.md))
- Sincronização entre seus dispositivos com uma conta gratuita ([conta](docs/ACCOUNT.md))

**Em cada dispositivo**

- Computador: consulte o texto selecionado em qualquer aplicativo ou palavras dentro de imagens, e traduza o texto selecionado ali mesmo
- Android: consulte pelo menu de seleção de texto de qualquer aplicativo, e escaneie palavras em fotos
- iOS: consulte pelo menu Compartilhar, e escaneie palavras em fotos

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="Capturas de tela do aplicativo para celular: uma pergunta de revisão, a página de progresso, a biblioteca de listas e as famílias de palavras">
<p><sub>Revisão, progresso, listas de vocabulário e famílias de palavras.</sub></p>
</div>

## Download

Baixe o Phevere na [versão mais recente](https://github.com/thd2020/phevere/releases/latest). Ele precisa de Windows 10, macOS 11, Ubuntu 22.04 ou Fedora 36, Android 7.0, ou iOS 15.1 ou mais recente. O aplicativo para iOS precisa ser assinado com a sua própria conta Apple antes de ser instalado.

O Windows e o macOS mostram um aviso na primeira vez que você abre o Phevere; escolha executá-lo assim mesmo. Notas de instalação: [macOS](docs/MACOS_SELECTION.md), [Linux](docs/LINUX_SELECTION.md), [Android](apps/mobile/ANDROID.md).

## Atualizações

O Phevere se atualiza sozinho. Em **Settings → Updates**, escolha Automatically (automaticamente), Ask first (perguntar antes) ou Off (desativado).

- No Windows e no AppImage, a atualização é instalada quando você fecha o Phevere, e **Roll back** volta para a versão anterior.
- No macOS, deb e rpm, o Phevere abre a página de download da nova versão.
- No Android, a atualização é baixada pelo Wi-Fi e pede sua confirmação antes da instalação.

Em **Settings → About** você vê a sua versão, as novidades e onde relatar um problema.

## Privacidade

Suas palavras e configurações ficam no seu dispositivo, a menos que você entre na sua conta para sincronizá-las. O Phevere nunca lê campos de senha nem registra janelas anônimas do navegador. Veja a [política de privacidade](https://holarky-api.thdfreelancer.workers.dev/privacy).

## Compilar a partir do código-fonte

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

Você precisa do Node.js 18 ou mais recente e de um conjunto de ferramentas C++ para o módulo nativo: Visual Studio 2022 no Windows, Xcode Command Line Tools no macOS e, no Linux, `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`. Os scripts `npm run make:*` geram os instaladores ([empacotamento](PACKAGING.md)), e `npm run mobile:dev` roda o aplicativo para celular no navegador ([celular](docs/MOBILE.md)). Enviar um novo número de versão para `main` publica uma nova versão ([publicação](docs/RELEASE.md)).

| Caminho | Conteúdo |
|---|---|
| [`packages/core`](packages/core) | Fontes de dicionário, caderno de palavras e sincronização, compartilhados por todas as plataformas |
| [`src`](src) | Aplicativo para computador (Electron) |
| [`native-addon`](native-addon) | Captura da seleção no Windows, macOS e Linux |
| [`apps/mobile`](apps/mobile) | Aplicativo para celular e seus projetos para Android e iOS |
| [`docs`](docs) | Notas por plataforma e documentos de design |

## Licença

[MIT](LICENSE). Os nomes Phevere, Holarky e knowrld e seus logotipos não estão incluídos; veja [TRADEMARKS.md](TRADEMARKS.md). O texto de dicionário vindo do Wikcionário e da Wikipédia está sob CC BY-SA 4.0. Os aplicativos incluem o eSpeak NG sob GPL-3.0-or-later ([termos](apps/mobile/ANDROID.md)), e a tabela de frequência de sentidos é derivada do Princeton WordNet 3.1 sob a licença do WordNet. **Settings → About** lista todas as fontes de dados e suas licenças.

Se o Phevere ajuda você, uma [estrela no GitHub](https://github.com/thd2020/phevere) ajuda outras pessoas a encontrá-lo.
