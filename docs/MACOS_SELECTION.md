# macOS selection backend

Windows Phevere uses UI Automation with a matching **1 → 2 → 5** capture chain after a drag/double-click (`native-addon/src/selection_monitor.cpp`): TextPattern, then a Chromium `WM_GETOBJECT` poke, then silent Ctrl+C. There is no Apple Events analog (macOS step 3). On macOS the matching producer is the **Accessibility (AX)** API plus a listen-only **CGEvent tap**. Lookup, popup, and `ContextEvent` are unchanged: the native layer still emits `{ text, x, y }` into `MacOSNativeSelectionService`.

There is **no notarized Mac installer**. Unsigned per-arch DMGs ship from `release.yml` on the same `v*` tag as Windows Setup (see [`PACKAGING.md`](../PACKAGING.md) and [`RELEASE.md`](RELEASE.md)). Gatekeeper still warns.

Conversation + constraints for a Mac-side agent: [`AGENT_HANDOFF_MAC.md`](AGENT_HANDOFF_MAC.md).

## What is implemented

| Piece | Role |
|---|---|
| `native-addon/src/ax_selection_monitor.mm` | N-API module `AXSelectionMonitor` |
| Drag / double-click mouse-up | Capture chain on Electron’s **main** run loop: (1) `AXSelectedText` / range string, (2) Chromium AX enable + text-marker range, (3) browser AppleScript `getSelection()`, (5) silent **Cmd+C** with clipboard restore |
| `kAXSelectedTextChangedNotification` | Extra path when the front app fires it; rebinds when you switch apps |
| 500ms debounce | Same settle window as the Windows addon |
| `getWordAtPoint` | Hover: `AXUIElementCopyElementAtPosition` + range-for-position |
| Own PID skip | Ignore selections inside Phevere / Electron |
| Read this window | `scripts/foreground_window.applescript` — System Events bounds of the frontmost non-Phevere window, then the same OCR crop as Windows `GetWindowRect` |
| Now playing | `scripts/media_now_playing.applescript` — Music.app / Spotify (same Title/Artist/Album line as the Windows SMTC script). Browser YouTube is not a public Mac API (MediaRemote is blocked from app bundles on 15.4+) |
| Screen Recording | Same one-click Settings jump as Accessibility; hover / region / grab / read-window OCR need it |
| Durable windows | `titleBarStyle: 'hiddenInset'` traffic lights (Windows uses `titleBarOverlay`) |

Chrome, VS Code, Cursor, and other Chromium apps often expose no `AXSelectedText`. After a drag or double-click Phevere tries, in order: Accessibility (including Chromium text-markers after `AXManualAccessibility`), AppleScript `window.getSelection()` in Safari/Chrome-family (needs **Automation** plus the browser’s **Allow JavaScript from Apple Events**), then a silent Cmd+C with clipboard restore. Password fields are skipped. A plain click still does not copy.

## Shortcut monitor mode

Same as Windows: native capture still runs, but the lookup opens only if you **hold the popup trigger** while selecting (default **⌘⌥⇧Y**), or select first and then press the trigger. macOS uses `CGEventSourceKeyState` for the hold check (`src/services/accelerator-key-state.ts`). Until that existed, shortcut mode on Mac behaved like **On**. Settings keycaps show ⌘ / ⌥ / ⇧ on Mac.

## Build on a Mac

Xcode Command Line Tools, Node 18+.

```bash
npm install
npm start
```

`npm install` uses `.npmrc` `electron_mirror` (npmmirror) and `scripts/ensure-electron.js` (curl) so a cancelled install that wiped `path.txt` still self-heals on `npm start`. If Electron’s `got` postinstall hangs: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`.

If you already Ctrl+C'd a hung `npm install`, `node_modules` is probably there without `electron/dist`. Finish with:

```bash
npm run ensure-electron
npm run build-native
```

Binding: `native-addon/build/Release/ax_selection_monitor.node`.

## Accessibility permission

macOS will not let an app flip **Privacy → Accessibility** by itself (TCC). Phevere:

1. Shows a dialog with **Open Accessibility Settings** (jumps to that list).
2. Asks the OS to list **Electron** (dev) or **Phevere** (packaged) so the toggle is there.
3. Starts lookup automatically once you enable it (tray → **Open Accessibility Settings…** if you skipped the dialog).

If the row is already listed but off, turn it on; if it looks stuck, toggle off and on. Restart is usually unnecessary after a grant.

`start()` no longer only logs a menu path. Debug: `PHEVERE_DEBUG_AX=1 npm start`.

Disable the typing/gesture gate (noisy): `PHEVERE_DISABLE_INPUT_GATE=1`.

## Screen Recording permission

Hover OCR, region OCR, grab under cursor, and Read this window use `desktopCapturer`. On macOS 10.15+ that needs **Privacy → Screen Recording**. The first empty capture shows **Open Screen Recording Settings**; the tray has the same item. macOS will not flip the toggle for the app.

## Not in this file (OS limits)

- Mac **notarization** / hardened runtime entitlements (`NSAccessibilityUsageDescription` when packaging). Unsigned DMGs ship from Actions (`release.yml`) or `npm run make:mac:x64` / `make:mac:arm64`.
- Click-away cancelling a pending popup (same latch-on-mouse-up model as Windows)
- Linux AT-SPI
- System-wide now playing from Safari/Chrome (no public API; Music and Spotify work)

Coordinates: Electron points are top-left origin; AX bounds are converted from Cocoa bottom-left of the primary display. Multi-monitor edge cases need a real Mac pass.
