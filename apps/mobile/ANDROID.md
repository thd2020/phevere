# Android build and selection-toolbar setup

**2026-09-28 (late night):** The APK now has a real version. The installer shows
`0.2.0-dev.<commits>+<sha>` for CI and local debug builds instead of `1.0`, and every
build from a newer commit installs as an upgrade. IPA uses the bundled Charis SIL font,
so letters the phone's fonts lack no longer show as boxes. A normal press of Phevere on
the LSPosed-managed bar now opens the pop-up beside the word, not in the middle.
The module also recognises Phevere on Jetpack Compose selection bars, which carry no
intent (X is the suspected case), and logs a bar's items once per app to the LSPosed log
when Phevere is missing from it. Settings → Capture is now plain Material 3 rows:
**Pop up on selection** and **Floating pop-up** are switches, the module state is a
pill on the Selection bar heading, and **Position on bar** is a System | Custom
segmented button.

**2026-09-28 (night):** Rooted phones use the LSPosed module instead of accessibility.
Settings → Capture shows two switches once the module is active: **Pop up as soon as text
is selected** (Phevere is pressed on the bar and the bar is never drawn) and **Phevere's
place on the bar** (system default, or drag it into a slot on a mock bar).

**2026-09-28 (evening):** Without root, instant pop-up now presses Phevere on the
system selection bar through the accessibility service (works in Chrome too).

**2026-09-28 (later):** With **Pop up as soon as text is selected** off (default),
selecting text anywhere in Phevere — main app, bottom sheet or floating pop-up — shows
the selection bar; its Phevere item looks the text up. The floating pop-up draws that bar
itself (an overlay window cannot show the system one) with the same actions. The pop-up
now defaults to about 360 × 460 dp and opens beside the selected word when its position
is known (selections inside Phevere, or other apps while the accessibility fallback is on).

**2026-09-28:** Tap outside the floating pop-up to close it (the tap still reaches
the app behind; typing on the keyboard does not close it). Drag the pop-up's left,
right or bottom margin to resize it; the bottom sheet resizes from its top handle.
The size is remembered. Selecting text inside Phevere opens the pop-up only when
**Pop up as soon as text is selected** is on. The pronunciation voice is now a
radio list in Settings → Audio, like the Translation engine list.

**2026-09-27 (later):** Selecting text inside Phevere opens the same pop-up as the
selection tray in other apps; inside the pop-up, a selection looks up in place. The
pop-up's From/To language lists are in-page pickers (a native `<select>` cannot open
in an overlay window). IPA chips no longer go silent on unstressed or `æ`/`ɑ` IPA.

**2026-09-27:** `libttsespeak.so` is now compiled from the pinned eSpeak NG source
with NDK r28, so the APK passes Android's 16 KB page-size check. IPA chips speak
their own IPA with the mechanical voice; the headword and notebook ▶ buttons play
the recorded human clip (mechanical only when no clip exists).

## Build

The APK embeds eSpeak NG 1.52.0 as its default mechanical voice. It works offline
without a system TTS engine, another app, or any voice download.

**Settings → Audio → Pronunciation voice** offers two optional Kokoro v1.0 neural
voices with the same speakers: **compact** (int8 weights, 132 MB download, 500 MB free
during setup) and **full quality** (350 MB, 1 GB free). Downloads are verified before
installation and run in the background if the dialog is dismissed. Select the voice
after it finishes. Mechanical remains the default, including after upgrading from a version
that bundled Kokoro. An existing unpacked Kokoro model is reused without downloading.
Failed/cancelled downloads leave mechanical speech available. Partial downloads
restart from the beginning. English and Mandarin are supported by both options.

CI verifies packaged data, builds the APK and tests real mechanical synthesis on an
Android 35 emulator (US/UK English, Mandarin and fallback with a missing neural model).
The neural runtime is still included, but its large model is excluded from the APK.

### Version

`versionName` is the `version` in `apps/mobile/package.json`; bump it there for a
release. `versionCode` is `git rev-list --count HEAD`, so it grows with every commit on
the branch and Android accepts each newer build as an upgrade. Debug builds add
`-dev.<commit count>+<short sha>` to the name, which is what the installer and Android's
app info show. CI checks out the full history (`fetch-depth: 0`) for the count; a build
without git falls back to code 1.

For a local Android build:

```sh
npm run mobile:build
python apps/mobile/scripts/prepare-speech.py
cd apps/mobile/android
./gradlew assembleDebug
```

Pinned upstream binaries, data and source checksums are in `scripts/prepare-speech.py`.
Generated files belong under `app/build/generated/speech-v2`; old `speech` output is
not packaged. Voice data comes from the official eSpeak Android APK, but its
prebuilt `libttsespeak.so` uses 4 KB pages, so Gradle builds that library from the
pinned eSpeak source (NDK r28, 16 KB pages). The only source change enables
`espeakPHONEMES`, so IPA chips can send `[[phonemes]]`. CI runs
`scripts/check-apk-16kb.py` on the built APK. Phevere supplies a small Java adapter
for the JNI ABI. The neural runtime is
sherpa-onnx 1.13.3. The optional model URL and hash are in `SpeechModels.java`.

The Android binary incorporating eSpeak NG is distributed under GPL-3.0-or-later.
Phevere's own source retains its MIT license. Third-party license texts are included
in APK assets/speech-notices. Each CI run publishes `phevere-android-sources` beside
the APK, containing this repository and the pinned eSpeak source with build scripts.

## Pop up as soon as text is selected

**Settings → Capture → Pop up as soon as text is selected** (off by default; the
default is selection menu → Phevere).

Without root, turn on **Settings → Accessibility → Phevere pop-up on selection** once.
When the selection bar appears in another app, the service presses its Phevere button
(opening the overflow first when Phevere sits there), so this also works in Chrome. The
bar still appears briefly. The pop-up opens beside the selection. The service acts only
while the switch is on and reads only the selection bar and the selected word's position.

## Rooted phones: LSPosed module

1. Install the APK, then open **LSPosed → Modules → Phevere** and enable it.
2. Select the apps where you select text (browser, reader, etc.). System Framework is
   not needed; the hook runs inside the selected apps.
3. Force-stop and reopen those apps, or reboot.

Phevere → Settings → Capture then shows **Selection bar · LSPosed** with two switches:

- **Pop up as soon as text is selected** — the module presses Phevere on the selection
  bar before it is drawn, so no bar appears; the pop-up opens beside the selection.
- **Phevere's place on the bar** — *System default* leaves Android's placement; *Custom*
  shows a mock bar where you drag Phevere into a slot on the main row.

Accessibility is not used while the module is active. The module ships two entries with
identical behaviour (`SelectionBar`): the modern libxposed API (`ModernSelectionHook`,
LSPosed API 101+) reads the switches from LSPosed remote preferences, private to the
module; the legacy entry (`SelectionToolbarHook`, older LSPosed) reads a world-readable
`phevere_hook` preferences file (`xposedsharedprefs`) holding only those two values. A
process-wide guard makes sure only one entry hooks an app. Apps with their own selection
menus are outside the hook's scope.

Source basis: crDroid's [Android 16 Editor](https://github.com/crdroidandroid/android_frameworks_base/blob/16.0/core/java/android/widget/Editor.java)
uses `SHOW_AS_ACTION_NEVER` for process-text actions. The
[FloatingToolbar](https://github.com/crdroidandroid/android_frameworks_base/blob/16.0/core/java/com/android/internal/widget/floatingtoolbar/FloatingToolbar.java)
sorts them before drawing the main and overflow panels. The hook changes both
the action flag and comparator; changing manifest priority alone does neither.
