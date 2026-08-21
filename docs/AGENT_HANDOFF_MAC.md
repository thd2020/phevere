# Agent handoff — continue on an Intel Mac

**Audience:** another Cursor agent on a **different Mac** (Intel).  
**Source chat:** phevere on Windows (`C:\Users\8114\projects\phevere`), 2026-08-06 → 2026-08-20.  
**Write date:** 2026-08-20.  
**Checkout:** `origin/main` (not tag `v1.4.0`). Mac draft landed in `311f25b` *after* the Windows 1.4.0 installer tag.

Companion (API/build only): [`MACOS_SELECTION.md`](MACOS_SELECTION.md). This file is the **conversation + constraints**. Do not re-litigate shipped Windows UI unless the user asks.

---

## 1. What you are here to do

Phevere is an Electron select-to-lookup dictionary. Windows is production (UIA native addon + NSIS Setup). The last user turn on Windows was: **draft the macOS selection backend**. That code is on `main` and has **never been compiled or run on a Mac**.

Your job is to **build, grant Accessibility, and make drag-select open the same toolstrip/popup**. Do not start a `.dmg`, notarization, or version bump unless the user asks.

```bash
git clone https://github.com/thd2020/phevere.git
cd phevere
git checkout main
git pull
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install
# must produce native-addon/build/Release/ax_selection_monitor.node
# and node_modules/electron/dist (curl via scripts/ensure-electron.js, not GitHub got)
npm start
```

Then: **System Settings → Privacy & Security → Accessibility → enable Electron** (the host of `npm start`), quit and relaunch. Test in TextEdit / Safari / Notes first. Chrome / VS Code / other Electron apps often have a weak AX tree.

Debug: `PHEVERE_DEBUG_AX=1 npm start`

---

## 2. Standing constraints (do not violate)

| Rule | Detail |
|---|---|
| Version | `package.json` is **1.4.0**. Do not bump for Mac draft work. |
| Tag `v1.4.0` | Windows NSIS only. Replacing it is `gh release delete v1.4.0 --yes --cleanup-tag` then annotated retag on a **Windows-installer** commit — **not** for Mac experiments. Never force-push `main`. |
| Dependabot | PRs **#1–#9** stay open (TypeScript 5→7 etc. break CI). Do not merge. |
| Signing | Homemade certs do not clear SmartScreen. See `docs/CODE_SIGNING.md`. Irrelevant on Mac until packaging. |
| Native addon | Load **only in the Electron main process**. Preload must not `dlopen` the `.node` (second AX/UIA instance deadlocks the popup). |
| Docs | Behavior/packaging changes: update README/CHANGELOG in the same change-set. `WORKLOG.md` is **gitignored** — never `git add` it. |
| Commits | Fine-grained; push `main`. No `--force` on `main`. |

Product architecture the user wants long-term (Aug 6): one **capture hub**, OS-specific producers (UIA / AX / AT-SPI), Electron UI stays shared. Fill the non-UIA path; do not fork the popup.

---

## 3. Shipped Windows 1.4.0 (context — do not re-do)

Shipped installer: [v1.4.0](https://github.com/thd2020/phevere/releases/tag/v1.4.0) `Phevere-Setup-1.4.0-x64.exe`, SHA-256 `9822C0A9…560AF8`. Unsigned.

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

Mac draft **copies this latch model** on purpose (`docs/MACOS_SELECTION.md` “Not in this draft”).

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

Windows `node-gyp rebuild` was verified after the gyp split (UIA `.node` still builds). The `.mm` file has **not** been compiled on a Mac.

---

## 6. First session on the Intel Mac (checklist)

1. Node 18+ and Xcode CLT. `npm install` in repo root (runs `build-native`).
2. Confirm `native-addon/build/Release/ax_selection_monitor.node` exists (not the Windows UIA name).
3. `npm start` → grant Accessibility to **Electron** → fully quit → start again.
4. Drag-select a word in TextEdit. Collapsed toolstrip should appear near the selection; a second word while still collapsed should follow (same stale-lookup rules as Windows).
5. If `start()` fails: log should mention Accessibility. `PHEVERE_DEBUG_AX=1` for tap/observer lines.
6. Hover lookup uses `getWordAtPoint` — verify later; selection is the priority.
7. Fix compile errors, coordinate bugs, and apps that never fire `AXSelectedText` (mouse-up path should still read focused element). Keep debounce/input-gate behavior aligned with Windows unless the user wants a Mac-specific cancel-on-click-away.

Intel vs Apple Silicon: this handoff assumes **Intel Mac** (user stated they have one). Prefer `x64` Electron matching the machine; do not add arm64 CI unless asked.

---

## 7. Explicitly out of scope until asked

- Linux AT-SPI, Android, iOS
- Mac installer / Forge ZIP as a product / notarization / `NSAccessibilityUsageDescription`
- `MPNowPlayingInfoCenter` (still unchecked on `docs/OCR_CONTEXT_CAPTURE.md`)
- Merging Dependabot
- Replacing `v1.4.0` or bumping to 1.4.1
- Changing click-away / empty-selection cancel
- Loading the native addon from `preload.ts`

---

## 8. Pointers

- Hub: `src/index.ts` `wireContextCaptureHubOnce`, `createPopupWindow`
- Capture contract: `src/services/context-capture.ts`, `docs/OCR_CONTEXT_CAPTURE.md`
- Packaging (Windows): `docs/RELEASE.md`, `electron-builder.yml` (win NSIS only today)
- Repo: `https://github.com/thd2020/phevere` branch `main`
