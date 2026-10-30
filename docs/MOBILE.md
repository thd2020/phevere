# Phevere on Android and iOS

2026-10-20, 2.2.0: the new light icon replaces the launcher icon and the splash screens, and in-app text matches the desktop wording. The phone now matches the desktop lookup. Lookups show a loading skeleton, translations use the desktop cards, and the lookup header has Copy and Search the web. Recent lookups appear as chips on the empty screen. The notebook has an A–Z rail you can scrub, and it remembers the sort. Settings → Offline and Settings → Audio use the desktop layout. Fonts ship with the app instead of loading from Google Fonts. The Etymonline tab loads entries again, and the etymology summary reads from the oldest ancestor to the headword. With a neural voice chosen, an IPA chip says its headword in the neural voice.

2026-10-14, 2.1.0 refresh: etymology tabs retain contributor names and the chosen source as results arrive. Etymonline failures show an Open on Etymonline action. The Android APK and unsigned iOS IPA have been rebuilt on the existing release. The current Android CI and release APKs have different debug signing certificates. Compatibility with the previous published APK remains unverified; Android requires the same signing key for an update ([Android signing](https://developer.android.com/studio/publish/app-signing)).

**2026-09-29.**
- **Scan:** now opens full screen. Pinch or double-tap to zoom, and drag to pan. The recognised text is an invisible, selectable layer over the photo. A long press selects a word, the selection stays highlighted, and a single tap does nothing. Phevere on the text bar (Android) or edit menu (iOS) opens the result in a bottom sheet over the photo; swipe it up to full height or down to close. With **Pop up on selection** on, there is no bar and the sheet opens straight away.
- **Settings:** the sections are icons.
- **Title bars:** they line up on every tab.
- **Notebook:** it refreshes when you pull down, and Import and Export are icons in its title bar.
- **Volume:** Playback volume starts at 50%, which is the old maximum. The upper half is extra gain on Android.
- **Other apps:** the LSPosed module adds Phevere to selection bars that hide other apps' actions, such as X's.

**2026-09-28.** iOS now matches Android. **Floating pop-up** on iOS is a compact card beside the selected word, or a bottom sheet when it is off. Selected text inside Phevere has a **Phevere** item in the edit menu, and **Pop up on selection** opens the card without it. IPA chips speak their own IPA through Apple's IPA notation; they used to read eSpeak codes aloud. Settings → Audio lists the installed English voices, and the volume slider applies. The Share sheet opens Phevere again on iOS 18. Both apps now carry a real version: `0.2.0` from `apps/mobile/package.json`, with the commit count as the build number. The iOS build draws its bars in the Liquid Glass style: a floating glass tab bar, glass pills for the search field and tabs, and a blurred header edge. Android keeps the Material look.

**2026-09-16.** GitHub Actions `ci.yml` builds the **native WebView** Android APK and iOS IPA on every PR and `main` push, and keeps them as **Actions artifacts** (7 days). They are not attached to GitHub Releases. The APK is a phone shell (WebView + ML Kit OCR), not the desktop Electron app and not the Paddle OCR pack, so it stays a few megabytes next to a 180–350 MB unpackaged desktop zip. Wikipedia article links open the next page in the pane. Etymology can show Etymonline and Youdao, not only Wiktionary. Phone banners are a snackbar (Android) / top banner (iOS). Settings → Notifications has three independent switches: incoming lookup, saved to notebook, and scan finished (plus Allow / OS settings). The lookup page scrolls as one column; IPA chips speak through Android/iOS TTS (or that chip’s recorded clip). Select text → **Phevere** opens a compact lookup card (overlay if draw-over is granted, otherwise a bottom sheet), not the full app. Camera/photo opens **Scan**: the picture stays, words on it are selectable; tap or select a word to look it up under the image. Android 11+ camera capture declares `IMAGE_CAPTURE` and falls back to the photo picker.

## What it does

| Surface | How |
|---|---|
| Lookup | Material 3 search + lexicon / translation / Wikipedia / etymology. IPA chips under the headword, recorded audio, word-family links, back/forward |
| Notebook | Save from the heart. Same list as desktop: expandable rows, Recent / A–Z, Export, Import, Refresh. Empty glosses fill in the background. |
| Settings | Capture, Notifications (Android / iOS), Sources, Offline, API keys, Audio. Capture holds camera/photo **Scan**. Notifications are three on/off rows: **Incoming lookup**, **Saved to notebook**, **Scan finished**, plus Allow / the OS screen. Desktop-only items (shortcuts, hover, tray balloons, PP-OCR) are not shown. |
| Process Text | Android: select text → **Phevere** in the system toolbar opens a compact lookup card. With **Display over other apps**, the card floats and the other app stays interactive. |
| Share / deep link | iOS: Share sheet or `phevere://lookup?q=word` opens the lookup pop-up (floating card or half-sheet, per **Floating pop-up**). |
| In-app selection | Android and iOS: select text inside Phevere, then tap **Phevere** on the selection bar (Android) or edit menu (iOS); with **Pop up on selection** on, the pop-up opens beside the selection straight away. |
| Camera OCR | Camera or photo opens **Scan**: the image stays on screen and the words on it are selectable. Tap or select a word to look it up under the picture. |
| Wikipedia | Same hits as desktop. One hit (or an exact title) opens the article in the lookup pane. In-article links stay in the pane; Back walks the pages you opened, then the hit list. Open in browser is on the reader bar. |

Lookups use **native HTTP** (OkHttp / URLSession), not WebView `fetch`, so dictionary APIs are not blocked by CORS. `npm run mobile:dev` proxies Etymonline and Youdao so the Chrome preview can show more than Wiktionary. The notebook is sql.js in `phevere.sqlite` (app files / Documents).

## Lookup strip

Select text in another Android app and tap **Phevere**: a compact card looks the word up. If you grant **Display over other apps**, that card floats and the other app stays interactive. Otherwise it is a bottom sheet. iPhone Share uses a half-sheet; iOS cannot draw over Safari.

While an Android overlay floats, the system shows a silent **Lookup strip** notification (Android 13+ needs **Allow notifications**).

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

Locally on a Mac: run `bash apps/mobile/scripts/prepare-ios-speech.sh` once, then open `apps/mobile/ios/App/App.xcodeproj` (no CocoaPods). URL scheme `phevere`. Share extension `com.phevere.app.share`.

The script fetches the sherpa-onnx 1.13.3 iOS libraries (`sherpa-onnx.xcframework` and `onnxruntime.xcframework`, both static) and sherpa-onnx's official `SherpaOnnx.swift` wrapper into `apps/mobile/ios/App/Speech/`, which git ignores. Each download is pinned by SHA-256. The `ios-ipa` CI job and the `release-ios` job run it before `xcodebuild`. The Neural voices themselves are not bundled: the app downloads the Kokoro model a person picks in Settings → Audio into Application Support, excluded from iCloud backup, and unpacks the `.tar.bz2` with the SDK's `libbz2` and a small tar reader in `NeuralSpeech.swift`.

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
