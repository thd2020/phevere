# Phevere on Android and iOS

Desktop stays Electron. Phones are a **separate Capacitor app** that shares lookup and notebook logic via [`packages/core`](../packages/core). The desktop popup (`src/popup-new.html`) and UIA/AX addons do not run on mobile.

## What v1 does

| Capture | Platform | How |
|---|---|---|
| Process Text | Android | Select text in Chrome/Gmail/… → **Phevere** in the system toolbar |
| Share / Action | iOS | Share sheet → Phevere, or open `phevere://lookup?q=word` |
| Search | both | Type a word in the app |
| Notebook | both | Save from a lookup; sql.js file `phevere.sqlite` (native Data dir, or localStorage on web) |

Lookups use **native HTTP** (`CapacitorHttp`), not WebView `fetch`, so dictionary APIs are not blocked by CORS.

## What v1 is not

- Global overlay / Accessibility bubble (Play policy risk; not on iOS at all)
- Camera / Live Text OCR
- Offline pack installer
- Wikipedia article reader webview
- Store listing, signing, or notarization

## Develop

From the repo root (npm workspaces):

```bash
npm install
npm run mobile:dev
```

Vite serves the web UI at http://localhost:5173. Native HTTP is unavailable in the browser; use an emulator or device for real lookups.

```bash
npm run mobile:build
npm run mobile:sync
```

Then:

- **Android:** Android Studio → `apps/mobile/android`. `MainActivity` registers `ProcessTextPlugin`. `PROCESS_TEXT` is on the same activity (`AndroidManifest.xml`).
- **iOS (Mac):** `npx cap open ios` from `apps/mobile`. CocoaPods must be installed. URL scheme `phevere` is in `Info.plist`. Share extension target **ShareExtension** (`com.phevere.app.share`) opens that URL.

Application id: `com.phevere.app` (same as the desktop `electron-builder.yml` `appId`).

## Architecture

```
apps/mobile (Vite)
  platform/configure-core.ts  →  CapacitorHttp + Web Crypto SHA-256 + sql.js VocabDb
  plugins/process-text.ts      →  Android ProcessTextPlugin
  incoming-text.ts             →  appUrlOpen + pending Process Text
        ↓
packages/core  DictionaryService, vocab CRUD, merge/etymology/word-family
```

Electron desktop calls `src/platform/configure-core.ts` (node-fetch + sql.js worker) and keeps the existing popup.

## Follow-ups

- Camera OCR using the bundled PP-OCR ONNX via a mobile ORT wrapper
- Offline pack download on device
- Play / App Store signing (Apple Developer + Play Console are yours)
