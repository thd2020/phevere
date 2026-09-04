# Agent handoff — continue on a Mac

**Audience:** another Cursor agent on a **different Mac** (Intel or Apple Silicon).  
**Source chat:** phevere on Windows (`C:\Users\8114\projects\phevere`).  
**Write date:** 2026-09-04.  
**Checkout:** `origin/main`. Shipped desktop build is **1.5.0** (Windows NSIS x64/ARM64 + macOS Intel/Apple Silicon DMGs from the same `release.yml` tag). Unsigned Mac DMGs can also be built locally with `npm run make:mac:x64` / `make:mac:arm64` (not notarized).

**2026-09-04:** Mac capture actions match Windows (read-window, Music/Spotify now-playing, Screen Recording prompt, inset traffic lights, ⌘ keycaps). Selection backend is no longer a draft.

Companion (API/build): [`MACOS_SELECTION.md`](MACOS_SELECTION.md). Do not re-litigate shipped Windows UI unless the user asks.

---

## 1. What you are here to do

Phevere is an Electron select-to-lookup dictionary. Windows uses UIA + NSIS; macOS uses AX + unsigned DMGs from the same GitHub tag. Drag-select, hover OCR, read-window, and now-playing are implemented on both.

If you are on a Mac: grant **Accessibility** and **Screen Recording**, then confirm lookup + OCR. Do not start notarization or a version bump unless the user asks.

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
git checkout main
git pull
npm install
# must produce native-addon/build/Release/ax_selection_monitor.node
# and node_modules/electron/dist (ensure-electron.js curl; .npmrc electron_mirror)
npm start
```

Then: **System Settings → Privacy & Security → Accessibility** and **Screen Recording** → enable the Electron.app that `npm start` launched (`node_modules/electron/dist/Electron.app`, not Cursor). Quit and relaunch if the row was added while the app was already running. Test in **TextEdit / Safari / Notes**, then Chrome / Cursor. Safari/Chrome AppleScript needs Automation plus the browser’s **Allow JavaScript from Apple Events**.

Debug: `PHEVERE_DEBUG_AX=1 npm start`

---

## 2. Standing constraints (do not violate)

| Rule | Detail |
|---|---|
| Version | `package.json` is **1.5.0**. Do not bump unless the user asks. |
| Windows tags | NSIS Setup from `release.yml` on `v*`. Never force-push `main`. Do not retag `v1.4.0` for Mac work. |
| Dependabot | **#1–#6 and #8** merged 2026-08-26. **#7** (TypeScript 7) and **#9** (eslint-plugin 8) stay closed until parser + ts-loader move with them. |
| Signing | Homemade certs do not clear SmartScreen. See `docs/CODE_SIGNING.md`. Irrelevant on Mac until packaging. |
| Native addon | Load **only in the Electron main process**. Preload must not `dlopen` the `.node` (second AX/UIA instance deadlocks the popup). |
| Docs | Behavior/packaging changes: update README/CHANGELOG in the same change-set. `WORKLOG.md` is **gitignored** — never `git add` it. |
| Commits | Fine-grained; push `main`. No `--force` on `main`. |

Product architecture the user wants long-term (Aug 6): one **capture hub**, OS-specific producers (UIA / AX / AT-SPI), Electron UI stays shared. Fill the non-UIA path; do not fork the popup.

---

## 3. Shipped Windows 1.4.0 (frozen context — do not re-do)

Current Windows installer is **1.5.0**. The [v1.4.0](https://github.com/thd2020/phevere/releases/tag/v1.4.0) Setup is historical. Do not retag it.

Already on `main` (and in that Setup, except the Mac commit):

- Exact-form lookup (e.g. **tantalizing** must not inherit **tantalize** senses/IPA/save key). Policy: `src/services/lookup-policy.ts`.
- Lexicon **Word family** chips; POS as chip banners; split cards; etymology chrome; no duplicate speaker/web on those cards.
- Lookup **Back / Forward** on the lexicon tab; mouse X1/X2 and Alt+←/→. Main intercepts `app-command` so Chromium history does not swallow extra buttons. Wikipedia article Back still goes to the hit list first.
- Expanded popup **width follows the tab row** (Back/Forward used to clip **Etymology** at 400px). User asked to **replace 1.4.0 in place**, not 1.4.1.
- **Stale lookup** (user still saw the *first* word after a quick second selection). First retarget (`d60a1e1`) was not enough. Real causes and fix (`077cd01`):
  1. Renderer: `getLastSelection` overwrote a newer `popup-text`. Now `applyIncomingSelection` in `src/popup-new.html` uses timestamps; untimestamped IPC uses watermark `1` (never `Date.now()` as order).
  2. Main: skipped `popup-text` while `isLoadingMainFrame()`. Now always `sendPopupText` (Chromium queues). Monotonic `setLastSelectionEvent`.
  3. Native: 500ms debounce reset on every update; callback held the mutex. Distinct settled word flushes; callback after unlock (`selection_monitor.cpp`).
- Preload `onPopupText(text, timestamp?)`.

Popup HTML is `src/popup-new.html` via `popup-entry.ts` — **not** `renderer.ts` + `index.css` (that combo froze the toolstrip).

---

## 4. Click-away lagged popup (user asked; **not a bug to fix**)

User: select text, quickly click elsewhere to cancel, popup still appears seconds later at the old position. Asked if this is standard.

**Answer given (do not “fix” unless they ask):**

- 500ms debounce + Electron window create can feel like **seconds** (Youdao’s in-process widget is faster).
- Native layer **latches text at mouse-up** and **ignores empty selection** (plain click is a caret move). So cancelling the highlight does **not** abort the pending popup.
- Same class of behavior as desktop 划词 (Youdao / 金山). In-page extensions that re-read `getSelection()` on timer **do** abort.
- Re-check “still selected?” before show would match click-away intent, but Word/browsers emit spurious empty AX/UIA events that would swallow real lookups.

Mac **copies this latch model** on purpose (`docs/MACOS_SELECTION.md`).

---

## 5. macOS backend as left on Windows

Commit `311f25b` — `feat(macos): draft Accessibility selection backend`.

| Path | Role |
|---|---|
| `native-addon/src/ax_selection_monitor.mm` | N-API `AXSelectionMonitor`: CGEvent tap (drag / double-click), `AXSelectedText`, AXObserver, 500ms debounce, `getWordAtPoint`, skip own PID, `isTrusted` |
| `native-addon/binding.gyp` | `OS=='mac'` → `ax_selection_monitor`; `OS=='win'` → UIA; other OS `type: none` |
| `native-addon/index.js` | `darwin` loads `ax_selection_monitor.node`, else UIA `.node`. Same JS façade: `start` / `stop` / `onSelection({text,x,y})` / `getWordAtPoint` |
| `webpack.main.config.js` | `IgnorePlugin` so Windows webpack does not resolve the missing Mac `.node` (and vice versa) |
| `src/services/native-selection.ts` | `AddonBackedNativeSelectionService`; `MacOSNativeSelectionService` is no longer a stub. Same typing/rate-limit filters as Windows. `start()` throws if Accessibility is off. |
| `src/index.ts` | Darwin start-failure log points at System Settings → Accessibility |
| `docs/MACOS_SELECTION.md` | Build + permission |

**Contract (do not invent a second popup path):**

```
CGEvent / AX → debounce → N-API TSFN (text, x, y)
  → native-addon/index.js onSelection({text,x,y})
  → AddonBackedNativeSelectionService.handleSelection
  → contextCaptureHub → createPopupWindow
```

Coordinates: Electron/CGEvent top-left of primary; AX bounds converted from Cocoa bottom-left of primary. **Multi-monitor is untested.**

Windows `node-gyp rebuild` was verified after the gyp split (UIA `.node` still builds). Darwin CI (`macos-ocr-pack`) compiles `ax_selection_monitor.mm` for x64 and arm64.

---

## 6. First session on a Mac (checklist)

1. Node 18+ and Xcode CLT. `npm install` in repo root (runs `build-native`; Electron zip is curled, not fetched with `got`).
2. Confirm `native-addon/build/Release/ax_selection_monitor.node` exists (not the Windows UIA name).
3. `npm start` → grant **Accessibility** and **Screen Recording** to **Electron** → fully quit → start again.
4. Drag-select a word in TextEdit. Collapsed toolstrip should appear near the selection; a second word while still collapsed should follow (same stale-lookup rules as Windows).
5. If `start()` fails: log should mention Accessibility. `PHEVERE_DEBUG_AX=1` for tap/observer lines.
6. Hover lookup / Read this window need Screen Recording; Now playing needs Music or Spotify.
7. Fix compile errors, coordinate bugs, and apps that never fire `AXSelectedText` (mouse-up path should still read focused element). Keep debounce/input-gate behavior aligned with Windows unless the user wants a Mac-specific cancel-on-click-away.

Intel vs Apple Silicon: CI packages both (`macos-15-intel` + `macos-latest`). Prefer the Electron arch matching the machine.

---

## 7. Explicitly out of scope until asked

- Linux AT-SPI
- Developer ID notarization / `NSAccessibilityUsageDescription` entitlements
- System-wide now playing from Safari/Chrome (private MediaRemote; Music/Spotify AppleScript is shipped)
- Merging TypeScript 7 / eslint-plugin 8 without a matching parser and ts-loader
- Changing click-away / empty-selection cancel
- Loading the native addon from `preload.ts`
- Mobile store listing / signing (Android/iOS **code** is in-tree; see [`docs/MOBILE.md`](MOBILE.md))

---

## 8. Pointers

- Hub: `src/index.ts` `wireContextCaptureHubOnce`, `createPopupWindow`
- Capture contract: `src/services/context-capture.ts`, `docs/OCR_CONTEXT_CAPTURE.md`
- Packaging (Windows): `docs/RELEASE.md`, `electron-builder.yml` (win NSIS only today)
- Repo: `https://github.com/thd2020/phevere` branch `main`
