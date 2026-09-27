# Android build and selection-toolbar setup

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

## crDroid / Android 16: Phevere first

The same APK includes an optional LSPosed module. On a rooted phone with LSPosed:

1. Install the APK, then open **LSPosed → Modules → Phevere** and enable it.
2. Select the apps where you select text (browser, reader, etc.). Do not select
   System Framework; the hook runs inside the selected apps.
3. Force-stop and reopen those apps, or reboot. Select a word. Phevere's existing
   action should be the first visible button, outside the overflow menu.

The module promotes only an existing Phevere `PROCESS_TEXT` action and preserves
the relative order of other actions. No clipboard monitoring or accessibility
service is involved. Disable the module to restore the original ordering.
Apps with custom selection menus or which omit Phevere entirely are outside this
hook's scope. The setup dialog is shown once and can be reopened from Capture.

Source basis: crDroid's [Android 16 Editor](https://github.com/crdroidandroid/android_frameworks_base/blob/16.0/core/java/android/widget/Editor.java)
uses `SHOW_AS_ACTION_NEVER` for process-text actions. The
[FloatingToolbar](https://github.com/crdroidandroid/android_frameworks_base/blob/16.0/core/java/com/android/internal/widget/floatingtoolbar/FloatingToolbar.java)
sorts them before drawing the main and overflow panels. The hook changes both
the action flag and comparator; changing manifest priority alone does neither.
