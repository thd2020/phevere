# Linux selection capture

**2026-10-25:** Linux desktop builds (x64 and arm64; deb, rpm, AppImage) ship in the 2.2.0 release. Select-to-lookup, hover lookup, read-this-window, now playing and OCR work as on Windows. GNOME Wayland needs a keyboard shortcut (below).

## How a selection is read

Every Linux toolkit (GTK, Qt, Chromium and Electron, Firefox, terminals) publishes a drag or double-click selection as the **primary selection**. Password fields never do. Phevere watches it instead of copying anything, the same job UI Automation does on Windows.

The addon `native-addon/src/linux_selection_monitor.cpp` picks one source at start:

| Desktop | Source | Pointer for the popup |
|---|---|---|
| KDE Plasma 6 Wayland | `ext-data-control-v1` (`linux_wayland_primary.cpp`) | KWin script reports the pointer (`linux_kwin_script.cpp`) |
| Sway, Hyprland, other wlroots | `wlr-data-control-unstable-v1` | Xwayland pointer, else Electron's |
| Any X11 session | XFixes owner change on PRIMARY | X pointer |
| GNOME Wayland | none (Mutter exposes no data-control) | use `phevere --lookup-selection` |

The text must be stable for 500 ms with no mouse button held, the same debounce as Windows and macOS. Selecting the same word again after 1.5 s opens it again. Selections made while a Phevere window has focus are left to the in-app lookup.

## GNOME on Wayland

Add a custom shortcut in **Settings → Keyboard → View and Customise Shortcuts → Custom Shortcuts** with the command `phevere --lookup-selection`. Select a word, press the shortcut. The desktop entry also has a **Look Up Selection** action. The same command works on every desktop.

## Hover word

`getWordAtPoint` uses AT-SPI2 (accessible at point → text offset → word), the Linux twin of UIA `RangeFromPoint`. It runs in a helper child process: inside Electron, Chromium's own ATK bridge shares libatspi and crashes. The helper sets `org.a11y.Status IsEnabled`, as screen readers do. Where an app exposes no text (or on Wayland, where AT-SPI coordinates are unreliable), hover falls back to OCR under the pointer.

## Other platform pieces

- **Hold-to-trigger shortcut mode:** `XQueryKeymap` via koffi (`accelerator-key-state.ts`). On Plasma Wayland this sees modifiers when *Legacy X11 app support* allows it.
- **Read this window:** KWin's active window on Plasma Wayland, else EWMH `_NET_ACTIVE_WINDOW`.
- **Now playing:** MPRIS2 through `playerctl` when installed, else `busctl`.
- **Screen capture (OCR):** on Plasma Wayland the deb / rpm capture silently through KWin ScreenShot2; their desktop entry carries `X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2` with `Exec` at `/usr/lib/phevere/phevere`, which is what KWin checks. Elsewhere on Wayland (AppImage, GNOME, dev runs) capture goes through the screencast portal, which asks for a screen each time, so hover lookup skips OCR there. X11 captures directly.
- **OCR:** images decode through Electron's `nativeImage`. sharp is not shipped on Linux: its bundled GLib collides with the system GLib inside Electron and aborts.

## Debug switches

| Variable | Effect |
|---|---|
| `PHEVERE_DEBUG_LINUX_SEL=1` | Log selection events from the addon |
| `PHEVERE_LINUX_SELECTION=x11` or `wayland` | Force one source |
| `PHEVERE_DISABLE_ATSPI=1` | No AT-SPI hover word (OCR only) |
| `PHEVERE_DISABLE_KWIN_SCRIPT=1` | No KWin pointer, active-window or screenshot calls |

## Build

```bash
sudo apt install build-essential pkg-config libx11-dev libxfixes-dev libatspi2.0-dev libglib2.0-dev libwayland-dev
npm run build-native
```

The addon links libstdc++ statically and exports only the N-API entry points (`src/linux_exports.map`); exporting more broke onnxruntime in the same process. Release packages are built on Ubuntu 22.04 runners, so they need glibc 2.35 or later. A build made on a newer distribution needs that distribution's glibc.
