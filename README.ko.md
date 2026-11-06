<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

<img src="README.assets/phevere-icon.png" width="96" alt="Phevere 아이콘: 앞으로 기울어진 소문자 p로, 세로획은 자두색이고 둥근 부분은 속이 빈 민트색입니다">

<h1>Phevere</h1>

<p>어떤 앱에서든 단어를 선택하면, 읽던 자리에서 바로 찾아봅니다. 저장해 두고, 익히세요.</p>

[![Release](https://img.shields.io/github/v/release/thd2020/phevere?display_name=tag)](https://github.com/thd2020/phevere/releases/latest)
[![CI](https://github.com/thd2020/phevere/actions/workflows/ci.yml/badge.svg)](https://github.com/thd2020/phevere/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/thd2020/phevere)](LICENSE)

[다운로드](https://github.com/thd2020/phevere/releases/latest) · [변경 내역](CHANGELOG.md) · [문서](docs)

<img src="README.assets/phone-overview.png" width="860" alt="Android 앱 스크린샷: serendipity 검색 결과, 단어를 선택한 스캔 화면, 캡처 설정">

</div>

## 소개

Phevere는 어디서 읽든 쓸 수 있는 사전입니다. 어떤 앱에서든 단어를 선택하면 뜻, 발음, 번역, 어원을 볼 수 있고, 나중에 익히도록 저장할 수 있습니다. Windows, macOS, Linux, Android, iOS에서 동작합니다.

## 기능

**찾아보기**

- 뜻, 그림, 발음, 번역, 어원, 위키백과를 한곳에서
- 미국식과 영국식 발음, 추가 음성 다운로드
- Google 번역, MyMemory, Youdao, DeepL을 이용한 번역
- 단어의 활용형, 그리고 접두사와 접미사, 어근 페이지
- 입력하는 동안 추천 단어 표시
- 16개 언어의 오프라인 사전
- 영어 말고도 여러 언어의 단어 뜻 풀이([지원 언어](docs/MULTILINGUAL.md))

**익히기**

- 초등학교 수준부터 CET-6, 考研, TOEIC, 비즈니스 영어까지의 단어장([단어장 목록](docs/WORDBOOKS.md))
- 저장한 단어는 어디서 만났는지 기억합니다
- 어휘 가족, 단어 지도, 플래시카드
- 간격 반복으로 짜인 매일 복습([작동 방식](docs/REVIEW.md))
- 학습 진도 그래프
- Anki와 가져오기 및 내보내기([파일 형식](docs/BOOK_FORMAT.md))
- 무료 계정으로 여러 기기 간 동기화([계정](docs/ACCOUNT.md))

**기기별 기능**

- 컴퓨터: 어떤 앱에서든 선택한 텍스트나 이미지 속 단어를 찾아보고, 선택한 텍스트를 그 자리에서 번역합니다
- Android: 어떤 앱에서든 텍스트 선택 메뉴에서 찾아보고, 사진에서 단어를 스캔합니다
- iOS: 공유 메뉴에서 찾아보고, 사진에서 단어를 스캔합니다
- 인터페이스는 English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский, Português (Brasil) 10개 언어로 제공되며, 시스템 언어를 따르고 **설정** 맨 위에서 바꿀 수 있습니다

<div align="center">
<img src="README.assets/learning-overview.png" width="860" alt="휴대폰 앱 스크린샷: 복습 문제, 진도 페이지, 단어장 서재, 어휘 가족">
<p><sub>복습, 진도, 단어장, 어휘 가족.</sub></p>
</div>

## 다운로드

Phevere는 [최신 릴리스](https://github.com/thd2020/phevere/releases/latest)에서 받을 수 있습니다. Windows 10, macOS 11, Ubuntu 22.04 또는 Fedora 36, Android 7.0, iOS 15.1 이상이 필요합니다. iOS 앱은 설치하기 전에 본인의 Apple 계정으로 서명해야 합니다.

Phevere를 처음 열 때 Windows와 macOS에서 경고가 나타납니다. 그래도 실행을 선택하세요. 설치 안내: [macOS](docs/MACOS_SELECTION.md), [Linux](docs/LINUX_SELECTION.md), [Android](apps/mobile/ANDROID.md).

## 업데이트

Phevere는 스스로 업데이트합니다. **설정 → 업데이트**에서 자동, 먼저 묻기, 끔 중 하나를 고르세요.

- Windows와 AppImage 버전은 Phevere를 종료할 때 업데이트를 설치하며, **… 버전으로 되돌리기**를 누르면 이전 버전으로 돌아갈 수 있습니다.
- macOS, deb, rpm 버전은 새 버전의 다운로드 페이지를 엽니다.
- Android 버전은 Wi-Fi에서 업데이트를 내려받고, 설치 전에 확인을 요청합니다.

**설정 → 정보**에서 현재 버전, 새로운 기능, 문제를 신고하는 곳을 볼 수 있습니다.

## 개인정보

동기화를 위해 로그인하지 않는 한, 단어와 설정은 기기 안에만 저장됩니다. Phevere는 비밀번호 입력란을 읽지 않으며, 브라우저의 시크릿 창도 기록하지 않습니다. 자세한 내용은 [개인정보 처리방침](https://holarky-api.thdfreelancer.workers.dev/privacy)을 참고하세요.

## 소스에서 빌드하기

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
npm install
npm start
```

Node.js 18 이상과 네이티브 모듈을 위한 C++ 툴체인이 필요합니다. Windows에서는 Visual Studio 2022, macOS에서는 Xcode Command Line Tools, Linux에서는 `build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev`를 준비하세요. `npm run make:*` 스크립트로 설치 프로그램을 만들 수 있고([패키징](PACKAGING.md)), `npm run mobile:dev`로 휴대폰 앱을 브라우저에서 실행할 수 있습니다([모바일](docs/MOBILE.md)). 새 버전을 `main`에 푸시하면 릴리스가 게시됩니다([릴리스 절차](docs/RELEASE.md)).

| 경로 | 내용 |
|---|---|
| [`packages/core`](packages/core) | 사전 소스, 단어 노트, 동기화. 모든 플랫폼이 함께 씁니다 |
| [`src`](src) | 데스크톱 앱(Electron) |
| [`native-addon`](native-addon) | Windows, macOS, Linux에서 선택한 텍스트 가져오기 |
| [`apps/mobile`](apps/mobile) | 휴대폰 앱과 그 Android 및 iOS 프로젝트 |
| [`docs`](docs) | 플랫폼별 안내와 설계 문서 |

## 라이선스

[MIT](LICENSE). Phevere, Holarky, knowrld라는 이름과 로고는 포함되지 않습니다. [TRADEMARKS.md](TRADEMARKS.md)를 참고하세요. 위키낱말사전과 위키백과의 사전 텍스트는 CC BY-SA 4.0으로 제공됩니다. 앱에는 GPL-3.0-or-later인 eSpeak NG가 함께 들어 있으며([조건](apps/mobile/ANDROID.md)), 의미 빈도표는 WordNet 라이선스에 따라 Princeton WordNet 3.1에서 만들었습니다. 모든 데이터 출처와 라이선스는 **설정 → 정보**에 나와 있습니다.

Phevere가 도움이 되었다면 GitHub에서 [별표를 눌러](https://github.com/thd2020/phevere) 주세요. 더 많은 사람이 찾을 수 있게 됩니다.
