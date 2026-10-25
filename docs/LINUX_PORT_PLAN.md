# Linux port plan (x64 + arm64)

**Status (2026-10-25):** implemented; see [`LINUX_SELECTION.md`](LINUX_SELECTION.md). Differences from this plan: the native addon (slice 2) shipped first, with a Wayland data-control client because KDE 6.6 offers only `ext-data-control-v1`, which `wl-paste` 2.2 cannot use; KWin scripts give the pointer on Plasma Wayland; AT-SPI runs in a helper process; sharp is replaced by `nativeImage` on Linux. Original plan below.

**Was:** plan only, nothing implemented. **Written:** 2026-09-13 against `main` `d5a36c5` (v1.5.0).
**Companion once work starts:** `LINUX_SELECTION.md` (mirror of [`MACOS_SELECTION.md`](MACOS_SELECTION.md)).

## Decision

Port in five slices, smallest risk first.

| Slice | Delivers | Native code |
|---|---|---|
| 0 | App builds, boots, packages on Linux. No lookup yet. | none |
| 1 | Select-to-lookup via the **PRIMARY selection**. KDE / X11: automatic. GNOME Wayland: DE shortcut → `phevere --lookup-selection`. | none |
| 2 | Optional N-API addon: event-driven PRIMARY (XFixes), hover word, selection bounds (AT-SPI2). | `atspi_selection_monitor` |
| 3 | Capture extras: MPRIS now-playing, read-this-window, IPA speech, Linux hint texts. | none |
| 4 | `.deb` + `.rpm` + AppImage for x64 and arm64; CI/CD on `ubuntu-latest` + `ubuntu-24.04-arm`. | none |

Ship gate **v1.6.0** = slices 0 + 1 + 3 + 4. Slice 2 is v1.7 if slice 1 shows hover / anchor gaps that matter.

Electron keeps its Linux default: **X11 (Xwayland on Wayland sessions)**. Native Wayland (`--ozone-platform-hint=auto`) stays opt-in. Reasons below.

## Why PRIMARY first, not AT-SPI

- Every X11 and Wayland toolkit sets PRIMARY on drag / double-click: GTK, Qt, Chromium and Electron, Firefox, terminals. Password fields never set it. No permission, no root, no per-app flag.
- AT-SPI2 needs `org.a11y.Status IsEnabled` flipped on the a11y bus (we can do that, Orca does), Chromium apps must notice it, and screen coordinates are unreliable on Wayland. Good for hover and anchors later; wrong as the primary event.
- Same choice as GoldenDict-ng, pot-desktop, AyanDict, Crow Translate. The known hole is **GNOME Wayland**: Mutter has no `data-control` protocol, so no background PRIMARY read. There the DE-shortcut path is the only one, and that is what those apps document too.

## Why stay on X11 / Xwayland

Under Xwayland the app still gets: a global PRIMARY read (`clipboard.readText('selection')`; KWin and Xwayland ≥ 21.1 bridge Wayland selections into X — **verify item 1**), XFixes selection-change events (slice 2), popup placement at arbitrary screen coordinates, and `globalShortcut` while an X window has focus. Native Wayland loses all four.

Known cost: `screen.getCursorScreenPoint()` is stale while the pointer is over a native Wayland window. Slice 1 adds an anchor fallback; slice 2 can replace it with AT-SPI selection bounds.

## What the inspection found

Repo state, then the Linux gap. Paths are `main` `d5a36c5`.

| Layer | Today | Linux gap |
|---|---|---|
| Selection producer | UIA (`native-addon/src/selection_monitor.cpp`), AX (`ax_selection_monitor.mm`). `native-addon/index.js:4-9` loads the UIA `.node` on every non-darwin OS. `LinuxNativeSelectionService` (`src/services/native-selection.ts:275`) is a no-op placeholder. | No producer. |
| Webpack | `webpack.main.config.js:33-39` `IgnorePlugin` ignores only the *other* OS binding. | On Linux it still resolves `uiautomation_selection_monitor.node`, which does not exist → **build fails**. Blocker for slice 0. |
| `binding.gyp` | `OS=='win'` / `OS=='mac'`, else `type: none`. | `node-gyp rebuild` succeeds and emits nothing. Fine for slice 0. Needs `python3`, `make`, `g++` (present on the dev box). |
| `koffi` | `foreground-window.ts:35-63`, `accelerator-key-state.ts:29-79` guard on `process.platform` before `koffi.load`. | No crash. But `isAcceleratorPhysicallyHeld` (`accelerator-key-state.ts:400-408`) returns **`true`** on Linux → shortcut mode behaves like "On". Must return `false` until an X11 key-state path exists. `isPrimaryMouseDown` → `false` (fine). |
| Foreground window | win32 koffi, darwin `osascript`; linux → `null` (`foreground-window.ts:116-120`). | Read-this-window OCR silently off. |
| Now playing | PowerShell SMTC / AppleScript (`media-session.ts:113-131`); linux → `null`. | MPRIS over D-Bus is the Linux standard and covers more players than either. |
| IPA speech | `ipa-speak.ts` PowerShell SAPI / `say`; linux → nothing (`ipa-speak.ts:383-389`). | `espeak-ng` SSML `<phoneme alphabet="ipa">`. |
| Screen capture | `desktopCapturer` (`screen-capture.ts:54`). | Works. On Wayland sessions Chromium routes it through the PipeWire portal (dialog each time; Electron 28 has no restore token). Mac-style permission prompt (`mac-screen-recording.ts`) has no Linux twin → add a one-line hint. |
| OCR natives | `scripts/ocr-pack-layout.js:27-33` `SHARP_PLATFORM` has darwin/win32 only. | Add `linux/x64` and `linux/arm64` (`@img/sharp-linux-*` 0.33.5 + `@img/sharp-libvips-linux-*` 1.0.4 exist). `onnxruntime-node` 1.23.2 tarball **ships** `linux/x64` and `linux/arm64` (checked). Its postinstall downloads CUDA 12 on `linux/x64` by default → `.npmrc` `onnxruntime-node-install=skip`. |
| `koffi` binaries | ships `linux_x64` / `linux_arm64`; `packager-ignore.js:119-122` already filters by `${platform}_${arch}`. | none |
| `sql.js` | wasm | none |
| Electron runtime | `scripts/ensure-electron.js` handles `linux` names (`electron-v28.3.3-linux-{x64,arm64}.zip`, present on npmmirror). | none |
| Packaging | `forge.config.js:63-64` already lists `MakerRpm({})`, `MakerDeb({})` with empty config. `extraResource` adds Windows/Mac scripts and `icon.ico`. `prePackage` only throws for same-platform cross-arch. `verify-ocr-pack.js` already handles linux (`resources/`). | Makers need `fakeroot` + `dpkg` and `rpmbuild` on the host. Config is empty (no icon, categories, depends). No AppImage. Linux icon must be `packaging/icon.png`. |
| CI / CD | `ci.yml`: windows + macOS. `release.yml`: Win x64/arm64 + Mac x64/arm64. | Add linux x64 + arm64 jobs. `scripts/gh-delete-release-asset.ps1` runs under `pwsh`, which ubuntu runners have. |
| Window chrome | `withWin11Chrome` (`index.ts:926-960`) falls through to `{ backgroundColor, ...opts }` with `frame: false`. `src/index.html:19-70` draws its own titlebar with drag region and minimize/close. | Fine. `transparent: true` OCR overlay needs a compositor (KDE/GNOME have one). |
| Tray | `Tray` + `setContextMenu` for non-darwin (`index.ts:893-895`). `tray.on('click')` → show window. | SNI / AppIndicator on Linux does **not** deliver left-click. Menu already has **Open Phevere** (`index.ts:611`) so nothing is lost. GNOME needs the AppIndicator extension → README note. |
| Hints | `clipboardOcrHint` says Win+Shift+S / ⌘⌃⇧4 (`index.ts:176-186`). | Add Linux text (Spectacle / GNOME Screenshot → copy). |
| Single instance | `requestSingleInstanceLock` when packaged; `second-instance` → focus (`index.ts:107`, `2868`). | Extend to parse `--lookup-selection`. |
| Admin | `checkAdminPrivileges` runs `net session` (`index.ts:113`); warning is win32-gated. `start-admin` script uses `sudo`. | Linux needs no root. Leave `start-admin` documented as Windows-only. |
| Paths | `app.getPath('userData')` → `~/.config/phevere`. README says `%APPDATA%\phevere`. | Doc only. |
| Dev box | Xiaomi Pad (SM8250) · Armbian 26.8 / Ubuntu 26.04 · **aarch64** · KDE Plasma **Wayland** + Xwayland (`DISPLAY=:1`) · gcc 15.2 · **no Node** · at-spi2-core 2.60 runtime, no `-dev` · `org.freedesktop.a11y.Manager` served by `kwin_wayland` · `org.a11y.Status IsEnabled=false` · MPRIS live (kdeconnect) · no `fakeroot`, `rpmbuild`, `wl-clipboard`. | This is the **arm64 test rig**. x64 = CI runner + one VM. |

## Slice 0 — build, boot, package on Linux

Goal: `npm install && npm start` shows the tray and main window; manual search, vocabulary, and clipboard OCR work; `electron-forge package --platform linux` passes `verify-ocr-pack`.

Dev box once:

```bash
sudo apt install nodejs npm build-essential python3 fakeroot rpm wl-clipboard
# slice 2 only:
sudo apt install libatspi2.0-dev libglib2.0-dev libx11-dev libxfixes-dev
```

Ubuntu 26.04 ships Node 22.22 (matches CI `node-version: '22'`).

Changes:

1. `webpack.main.config.js` — `IgnorePlugin` list per host: win32 ignores mac+linux `.node`, darwin ignores win+linux, linux ignores win+mac (linux binding does not exist until slice 2; ignoring a missing file is fine).
2. `native-addon/index.js` — `loadMonitorClass()` returns `null` on linux (or the linux binding when present). `NativeSelectionMonitor` must not throw on construct; `AddonBackedNativeSelectionService.loadNativeAddon` already catches.
3. `scripts/ocr-pack-layout.js` — add `'linux/x64'` and `'linux/arm64'` to `SHARP_PLATFORM` (glibc only; no musl).
4. `.npmrc` — `onnxruntime-node-install=skip`. Also set `ONNXRUNTIME_NODE_INSTALL=skip` in CI env for clarity.
5. `forge.config.js` — `extraResource`: add `packaging/icon.png` when `process.platform === 'linux'`. `prePackage`: linux → no-op rebuild (slice 2 adds `rebuildLinuxAtspi`). Makers: gate `MakerRpm` on `rpmbuild` in `PATH` and `MakerDeb` on `dpkg` + `fakeroot` (electron/forge#3772 pattern) so a KDE dev box without `rpm` can still `make`.
6. `src/index.ts:504-512` — icon candidates: add `icon.png` under `resourcesPath` and `packaging/`.
7. `scripts/rebuild-native-arch.js` — linux branch logs "skip" instead of `fail`.
8. `src/services/accelerator-key-state.ts:400-408` — linux → `false`.
9. `package.json` — `"make:linux": "electron-forge make --platform linux"` (arch follows host; no cross-compile, same as Windows arm64 today).

Acceptance: boots on this box (arm64, Xwayland) and in an x64 VM; `verify-ocr-pack` ok for `out/phevere-linux-arm64`; clipboard OCR returns text from a Spectacle screenshot.

## Slice 1 — select-to-lookup without native code

New file `src/services/linux-selection.ts`, class `LinuxPrimarySelectionService implements NativeSelectionService`. `createNativeSelectionService()` returns it on linux.

Producers (pick one at start, env override `PHEVERE_LINUX_SELECTION=poll|wlpaste|auto`):

| Producer | When | How |
|---|---|---|
| `PrimaryPoller` | always available | `clipboard.readText('selection')` every 150 ms while monitoring is On or Shortcut. One X round trip; negligible. |
| `WlPasteWatcher` | `WAYLAND_DISPLAY` set **and** `wl-paste` on `PATH` **and** compositor has `ext-data-control-v1` / `wlr-data-control` (KDE, wlroots; not GNOME) | spawn `wl-paste --primary --watch sh -c 'cat; printf "\0"'`, split on NUL, restart with backoff on exit. Event-driven; sees native Wayland apps directly. |

`auto` = watcher if it starts and stays alive 2 s, else poller.

Shared rules (refactor first): pull the typing / rate-limit / dedupe logic out of `AddonBackedNativeSelectionService.handleSelection` (`native-selection.ts:160-249`) into a base or helper so Linux applies **identical** filters. Then add Linux-only rules:

- 500 ms settle before emit (matches the native debounce on Win/Mac).
- Skip when `BrowserWindow.getFocusedWindow()` is ours (in-app selection already has its own path).
- Skip when text equals the previous PRIMARY (PRIMARY persists after deselect; plain click must not re-fire).
- Max 2000 chars, `isLookupWorthy`, as today.

Coordinates: `screen.getCursorScreenPoint()` (`coordSpace: 'dip'`). If the point has not moved since the last emit and the event came from the watcher, treat it as unknown → `popup-placement.ts` anchor fallback. New monitor setting `linuxPopupAnchor: 'cursor' | 'last' | 'top-right'` (GoldenDict's Wayland answer, made a setting).

CLI hook (the GNOME-Wayland path, also useful everywhere):

- `phevere --lookup-selection` → first instance: handle in `second-instance` argv; cold start: handle after `ready`. Read PRIMARY via Electron, fall back to `wl-paste -p -n`. Emit through the same path.
- README recipe: KDE System Settings → Shortcuts → Custom → command `phevere --lookup-selection`; GNOME Settings → Keyboard → Custom.

Shortcut mode: select-then-trigger only (`isAcceleratorPhysicallyHeld` = `false`). Hold-to-lookup returns in slice 2 via `XQueryKeymap` when `DISPLAY` is set.

Hover mode: without `getWordAtPoint`, `hover-lookup.ts` falls to OCR-under-cursor. Confirm that path runs with no native word; if not, hide hover on Linux until slice 2.

Docs: write `docs/LINUX_SELECTION.md` (build, producers, GNOME limits, debug env), README "Download (Linux)" + limits table, CHANGELOG.

Acceptance: drag-select in Kate, Konsole, Firefox (Wayland), Chromium (X11 and Wayland), LibreOffice, VS Code / Cursor, one GTK4 app → toolstrip within ~700 ms; a second selection follows; a Firefox password field never triggers; selecting inside Phevere does not double-fire; `--lookup-selection` from a KDE shortcut works with a native Wayland app focused.

## Slice 2 — native addon `atspi_selection_monitor` (optional)

Only after slice 1 ships. Time-box two weeks; keep the XFixes half even if AT-SPI coverage disappoints.

Adds:

1. **Event-driven PRIMARY** — own `XOpenDisplay`, `XFixesSelectSelectionInput(PRIMARY, SetSelectionOwnerNotifyMask)`, thread → `Napi::ThreadSafeFunction`. Replaces the poller.
2. **`getWordAtPoint(x, y)`** — `atspi_component_get_accessible_at_point` → `atspi_text_get_offset_at_point` → `atspi_text_get_string_at_offset(ATSPI_TEXT_GRANULARITY_WORD)` + `atspi_text_get_range_extents` for the anchor.
3. **Selection bounds** — focused accessible → `atspi_text_get_selection(0)` → `atspi_text_get_range_extents` → popup anchor even when the pointer is unknown.
4. **Guards** — `ATSPI_ROLE_PASSWORD_TEXT` chain skip, own-PID skip.
5. **A11y enable** — set `org.a11y.Status IsEnabled=true` on start (what Orca does). Side effect: toolkits connect to the a11y bus. Chromium / Electron targets may need it set **before** they launch (**verify item 6**).

Build: `binding.gyp` `OS=='linux'` target with `<!@(pkg-config --cflags --libs atspi-2 glib-2.0 gobject-2.0 x11 xfixes)`; `native-addon/index.js` linux branch; `IgnorePlugin` per platform; `rebuild-native-arch.js` → `rebuildLinuxAtspi(arch)` host-arch only. Same façade as AX: `start / stop / setCallback(text, x, y) / getCurrentSelection / getWordAtPoint / isTrusted → true`.

Coordinates: trust `ATSPI_COORD_TYPE_SCREEN` only when `DISPLAY` is set and the target is an X11 client; otherwise return no bounds and let slice 1's anchor rule decide.

Not doing: XTEST / `ydotool` Ctrl+C (the Windows/Mac "step 5"). PRIMARY already covers what Ctrl+C would; Wayland forbids injection without `uinput` rights.

## Slice 3 — capture extras

| Feature | Linux implementation |
|---|---|
| Now playing | **MPRIS2**. `playerctl -a metadata --format '{{status}}\t{{title}}\t{{artist}}\t{{album}}'` if installed; else `busctl --user` (`ListNames` → `org.mpris.MediaPlayer2.*` → `Get … Player PlaybackStatus` / `Metadata`, parse `xesam:title` / `xesam:artist` / `xesam:album`). Prefer the first **Playing** player. Covers Firefox, Chromium, Spotify, VLC, Elisa, KDE Connect. Same `Title\tArtist\tAlbum` line as today. |
| Read this window | X11: `xdotool getactivewindow getwindowgeometry --shell` (or `xprop -root _NET_ACTIVE_WINDOW` + `xwininfo`), then `screen.screenToDipPoint`. X11 clients only. Wayland: `desktopCapturer.getSources({ types: ['window'] })` → portal picker → OCR the picked window. The user picking the window **is** read-this-window on Wayland. |
| Screen capture hint | First empty capture on a Wayland session → one-time hint "choose the screen in the system dialog" (twin of the Mac Screen Recording prompt). |
| IPA speech | `espeak-ng -m -v en-us|en-gb "<speak><phoneme alphabet='ipa' ph='…'>x</phoneme></speak>"` when installed; else renderer `speechSynthesis` (speech-dispatcher) for the headword; else the existing "no voice" hint. |
| Hints | Linux clipboard-OCR text: "copy a region with Spectacle (Print) or your screenshot tool". |
| Notifications | `Notification` works via libnotify / portal. `displayBalloon` stays win32-only (already guarded). |
| Autostart | If a launch-at-login setting exists, write `~/.config/autostart/phevere.desktop`; `setLoginItemSettings` is a no-op on Linux. |
| Permission menu items | Hide Accessibility / Screen Recording tray entries on Linux (no TCC). |

Package hints: `Recommends: wl-clipboard, espeak-ng, playerctl` in the deb/rpm.

## Slice 4 — packaging and CI

Makers (gated by host tools):

```js
new MakerDeb({ options: {
  name: 'phevere', productName: 'Phevere', genericName: 'Dictionary',
  description: 'Select-to-lookup dictionary', categories: ['Education', 'Dictionary'],
  icon: 'packaging/icon.png', homepage: 'https://github.com/thd2020/phevere',
  maintainer: 'thd2020', section: 'education',
  recommends: ['wl-clipboard', 'espeak-ng', 'playerctl'],
}})
new MakerRpm({ options: { /* same fields; `requires` auto */ } })
// @reforged/maker-appimage — x64 and arm64 (verify item 7)
```

- Desktop entry: `electron-installer-debian` writes `phevere.desktop` with `StartupWMClass=Phevere` → taskbar grouping (Linux twin of `setAppUserModelId`).
- Sandbox: deb/rpm postinst set `chrome-sandbox` 4755. **AppImage on Ubuntu ≥ 24.04** hits `kernel.apparmor_restrict_unprivileged_userns=1` → Electron aborts unless `--no-sandbox`. AppRun wrapper: detect the sysctl and add `--no-sandbox`; README note.
- Artifact names: `phevere_<ver>_amd64.deb`, `phevere_<ver>_arm64.deb`, `phevere-<ver>-1.x86_64.rpm`, `phevere-<ver>-1.aarch64.rpm`, `Phevere-<ver>-x86_64.AppImage`, `Phevere-<ver>-arm64.AppImage`.
- `ci.yml` job `linux-pack`, matrix `{ ubuntu-latest / x64, ubuntu-24.04-arm / arm64 }`: `apt-get install -y fakeroot rpm` (+ slice 2 `-dev` libs) → `npm ci` (`ELECTRON_MIRROR`, `ONNXRUNTIME_NODE_INSTALL=skip`) → `npx electron-forge package --platform linux --arch $arch` → `node scripts/verify-ocr-pack.js --dir out/phevere-linux-$arch` → upload. No display on runners: package only, like today. Optional later: `xvfb-run` smoke start.
- `release.yml` job `release-linux`, same matrix: `npm run make:linux` → locate `out/make/deb/$arch/*.deb`, `out/make/rpm/$arch/*.rpm`, AppImage → `./scripts/gh-delete-release-asset.ps1` per file → upload → `actions/attest`. Ten desktop artifacts per tag.
- Docs: README "Download (Linux)" (deb/rpm/AppImage, KDE shortcut recipe, GNOME Wayland limits, `~/.config/phevere`), PACKAGING.md Linux section, RELEASE.md artifact list, CHANGELOG.

Release test matrix: Ubuntu 24.04 GNOME Wayland x64 (shortcut path), KDE Wayland arm64 (this box, auto path), Fedora KDE X11 VM (full path), Debian 12 GNOME X11.

## Order and rough effort (one developer)

| Slice | Effort | Depends on |
|---|---|---|
| 0 | 1–2 days | Node on the dev box |
| 1 | 3–5 days incl. test matrix | 0 |
| 4 | 2–3 days incl. CI iterations; can run alongside 1 | 0 |
| 3 | 2–3 days | 1 |
| 2 | 1–2 weeks, optional | 1 shipped |

## Verify on this box first (first hour of slice 1)

1. KDE Wayland: does Electron (Xwayland) `clipboard.readText('selection')` return text selected in a native Wayland app (Konsole, Firefox-wayland)? Tests the KWin ↔ Xwayland PRIMARY bridge.
2. `wl-paste --primary --watch echo` fires on this KWin (`ext-data-control-v1`).
3. `screen.getCursorScreenPoint()` accuracy while the pointer is over a Wayland window.
4. `desktopCapturer` from Xwayland-hosted Electron → PipeWire portal (expected) or X11 grab (would miss Wayland windows).
5. `globalShortcut` under Xwayland while a Wayland window has focus (expected: no fire → CLI hook is required, not optional).
6. AT-SPI: does Chromium / Electron expose text after `IsEnabled=true` is set at runtime, or only when set before launch? (slice 2 gate)
7. `@reforged/maker-appimage` on `ubuntu-24.04-arm`.
8. deb `Depends` that `electron-installer-debian` computes for Electron 28 on Ubuntu 26.04 (`libasound2t64` rename etc.).

## Out of scope

Flatpak / Snap (revisit after slice 1 proves the shortcut path; Flathub wants portal-only designs), musl / Alpine, armhf, native Wayland ozone as default, `ydotool` injection, a GNOME Shell extension, Electron major upgrade.
