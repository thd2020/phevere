# macOS selection backend (draft)

Windows Phevere uses UI Automation. On macOS the matching producer is the **Accessibility (AX)** API plus a listen-only **CGEvent tap**. Lookup, popup, and `ContextEvent` are unchanged: the native layer still emits `{ text, x, y }` into `MacOSNativeSelectionService`.

There is **no** shipped Mac installer yet. This is source you can compile on a Mac.

Conversation + constraints for a Mac-side agent: [`AGENT_HANDOFF_MAC.md`](AGENT_HANDOFF_MAC.md).

## What is implemented

| Piece | Role |
|---|---|
| `native-addon/src/ax_selection_monitor.mm` | N-API module `AXSelectionMonitor` |
| Drag / double-click mouse-up | Read `AXSelectedText` on the focused element |
| `kAXSelectedTextChangedNotification` | Extra path when the front app fires it |
| 500ms debounce | Same settle window as the Windows addon |
| `getWordAtPoint` | Hover: `AXUIElementCopyElementAtPosition` + range-for-position |
| Own PID skip | Ignore selections inside Phevere / Electron |

Chrome, VS Code, and some Electron apps expose incomplete AX trees. Expect gaps versus TextEdit / Safari / Notes.

## Build on a Mac

Xcode Command Line Tools, Node 18+.

```bash
# Skip Electron's silent GitHub fetch (it can sit on a spinner for a long time).
# The install hook then curls the zip from cdn.npmmirror and builds the AX addon.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install
npm start
```

If you already Ctrl+C'd a hung `npm install`, `node_modules` is probably there without `electron/dist`. Finish with:

```bash
npm run ensure-electron
npm run build-native
```

Binding: `native-addon/build/Release/ax_selection_monitor.node`.

## Accessibility permission

System Settings → Privacy & Security → **Accessibility**:

- Dev: enable **Electron** (the binary that hosts `npm start`)
- Packaged (later): enable **Phevere**

`start()` prompts once via `AXIsProcessTrustedWithOptions`. If the user refuses, monitoring does not start; the log tells them where to flip the switch. Restart after granting.

Debug:

```bash
PHEVERE_DEBUG_AX=1 npm start
```

Disable the typing/gesture gate (noisy): `PHEVERE_DISABLE_INPUT_GATE=1`.

## Not in this draft

- Mac `.dmg` / notarization / hardened runtime entitlements (`NSAccessibilityUsageDescription` when packaging)
- Click-away cancelling a pending popup (same latch-on-mouse-up model as Windows)
- Linux AT-SPI
- `MPNowPlayingInfoCenter` (still open on the OCR/media plan)

Coordinates: Electron points are top-left origin; AX bounds are converted from Cocoa bottom-left of the primary display. Multi-monitor edge cases need a real Mac pass.
