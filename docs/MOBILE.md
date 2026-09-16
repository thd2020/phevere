# Phevere on Android and iOS

**2026-09-16.** GitHub Actions `ci.yml` builds the **native WebView** Android APK and iOS IPA on every PR and `main` push, and keeps them as **Actions artifacts** (7 days). They are not attached to GitHub Releases. The APK is a phone shell (WebView + ML Kit OCR), not the desktop Electron app and not the Paddle OCR pack, so it stays a few megabytes next to a 180–350 MB unpackaged desktop zip. Wikipedia article links open the next page in the pane. Etymology can show Etymonline and Youdao, not only Wiktionary. Phone banners are a snackbar (Android) / top banner (iOS).

## What it does

| Surface | How |
|---|---|
| Lookup | Material 3 search + lexicon / translation / Wikipedia / etymology. IPA chips under the headword, recorded audio, word-family links, back/forward |
| Notebook | Save from the heart. Same list as desktop: expandable rows, Recent / A–Z, Export, Import, Refresh. Empty glosses fill in the background. |
| Settings | Capture, Notifications (Android / iOS), Sources, Offline, API keys, Audio. Capture holds camera OCR and the **floating lookup strip**. Desktop-only items (shortcuts, hover, tray balloons, PP-OCR) are not shown. |
| Process Text | Android: select text → **Phevere** in the system toolbar (full app, or strip if enabled) |
| Share / deep link | iOS: Share sheet or `phevere://lookup?q=word` (full app, or half-sheet if enabled) |
| Camera OCR | Camera or photo → on-device text (ML Kit on Android, Vision on iOS) → lookup |
| Wikipedia | Same hits as desktop. One hit (or an exact title) opens the article in the lookup pane. In-article links stay in the pane; Back walks the pages you opened, then the hit list. Open in browser is on the reader bar. |

Lookups use **native HTTP** (OkHttp / URLSession), not WebView `fetch`, so dictionary APIs are not blocked by CORS. `npm run mobile:dev` proxies Etymonline and Youdao so the Chrome preview can show more than Wiktionary. The notebook is sql.js in `phevere.sqlite` (app files / Documents).

## Lookup strip (optional)

Default capture is still Process Text / Share into the full app.

Settings → Capture → **Floating lookup strip** opens a compact card instead:

- **Android:** a bottom sheet. If you also grant **Display over other apps**, the strip is a real overlay and the other app stays interactive (this is the desktop-like popup). Sideload / power-user only; Play is hostile to overlays. While it floats, Android shows a silent **Lookup strip** notification (Android 13+ needs **Allow notifications**).
- **iPhone:** Share presents a half-sheet. iOS cannot draw over Safari.

## What phones still cannot copy from desktop

- Auto-popup over other apps with **no** tap (Windows UIA / macOS Accessibility). Process Text / Share is the trigger. The strip is the display.
- Hover, region, and window OCR (camera / photo OCR is the phone equivalent)
- System tray / menu bar
- Store listing, signing, or notarization

Desktop Electron is unchanged. `npm run mobile:dev` is a **Chrome/Edge preview of the phone UI**, not the desktop app.

## Develop

From the repo root:

```bash
npm install
npm run mobile:dev
```

Vite serves http://localhost:5173. Typed search and the notebook work in that browser tab. Native HTTP, Process Text, Share, camera OCR, and the overlay need an emulator or device.

```bash
npm run mobile:build
```

That builds the web UI and copies it into the Android assets and the iOS `public` folder.

### Android APK without Android Studio

Android Studio is an IDE, not the compiler. You need a **JDK 21** and the **Android SDK**, then:

```bash
npm run mobile:build
cd apps/mobile/android
./gradlew assembleDebug
```

The APK is `app/build/outputs/apk/debug/`. It does not include Electron or the desktop Paddle OCR models. GitHub Actions job **android-apk** on each push/PR uploads the same debug APK as an artifact (Actions → the run → Artifacts). It is not attached to a GitHub Release. No Studio on your PC required.

### iOS

Xcode only runs on a Mac. GitHub’s `macos-latest` runner (job **ios-ipa**) builds a device IPA and uploads it next to the APK. It is not attached to a GitHub Release.

Locally on a Mac: open `apps/mobile/ios/App/App.xcodeproj` (no CocoaPods). URL scheme `phevere`. Share extension `com.phevere.app.share`.

Application id: `com.phevere.app` (same as the desktop `electron-builder.yml` `appId`).

## Architecture

```
Capture: Process Text / Share / typed search / camera OCR
        ↓
Native shell (Android WebView / iOS WKWebView)
  optional strip overlay / half-sheet
  JS bridge → HTTP, files, OCR, Wikipedia WebView
        ↓
apps/mobile  Material 3 UI  (lookup, notebook, settings)
        ↓
packages/core  DictionaryService, wikipedia, vocab, offline parsers
```

Do not import Electron from the phone bundle. Do not add Capacitor.

## Follow-ups

- Play / App Store signing (Apple Developer + Play Console are yours)
- FreeDict `.tar.xz` auto-unpack (today: import the `.tei`)
- Attach a signed APK/IPA to GitHub Releases (needs your keystore / Apple certs)
